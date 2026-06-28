// auth.service.ts — הלוגיקה של הרשמה, כניסה, ושליפת המשתמש המחובר.
// סיסמאות נשמרות תמיד מוצפנות (bcrypt) — אף פעם לא בטקסט גלוי.
import { Injectable, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { MailService } from '../mail/mail.service';
import { RolesService } from '../roles/roles.service';
import { ALL_PERMISSIONS, OWNER_ROLE_KEY, DEFAULT_ROLE_KEY } from './permissions';
import { randomInt } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly roles: RolesService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('משתמש עם המייל הזה כבר קיים');

    // המשתמש הראשון במערכת הופך אוטומטית ל"בעלים"; השאר מקבלים את התפקיד המצומצם ביותר
    // ("צופה פנימי") — לפי עקרון ההרשאה המינימלית. התפקידים נזרעים בעליית השרת.
    const userCount = await this.prisma.user.count();
    const roleKey = userCount === 0 ? OWNER_ROLE_KEY : DEFAULT_ROLE_KEY;
    let role = await this.roles.findByKey(roleKey);
    if (!role) {
      // ביטחון: אם משום מה התפקידים עוד לא נזרעו — זורעים עכשיו ומנסים שוב.
      await this.roles.seedSystemRoles();
      role = await this.roles.findByKey(roleKey);
    }
    if (!role) throw new BadRequestException('תפקיד ברירת המחדל חסר במערכת');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { email: dto.email, name: dto.name, passwordHash, roleId: role.id },
    });

    await this.audit('user.register', user.id, user.id);
    return this.tokenFor(user.id, user.email, role);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { role: true },
    });
    if (!user || user.deletedAt) throw new UnauthorizedException('פרטי כניסה שגויים');

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('פרטי כניסה שגויים');

    // התחברות מה-Reader (יש deviceId): המכשיר חייב להיות מאושר — אחרת חוסמים ומחזירים את מצבו.
    const isReader = !!dto.deviceId;
    if (isReader) {
      const st = await this.resolveReaderDevice(user.id, dto.deviceId as string, dto.deviceName);
      if (st !== 'approved') {
        await this.audit('device.login_blocked', user.id, user.id, { deviceStatus: st }, 'device');
        return { deviceStatus: st, email: user.email };
      }
    }

    // אם מופעל אימות דו-שלבי — שולחים קוד למייל ולא מחזירים טוקן עדיין.
    if (user.twoFactorEnabled) {
      const code = await this.issueOtp(user.id);
      await this.mail.sendOtp(user.email, code, 'login');
      await this.audit('user.login.2fa_sent', user.id, user.id);
      return { twoFactorRequired: true, email: user.email, reader: isReader };
    }

    await this.audit('user.login', user.id, user.id);
    return this.tokenFor(user.id, user.email, user.role, isReader ? { reader: true, device: dto.deviceId } : undefined);
  }

  // אימות הקוד שנשלח במייל בכניסה — מחזיר טוקן.
  async verifyLoginOtp(email: string, code: string, deviceId?: string) {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { role: true } });
    if (!user || user.deletedAt) throw new UnauthorizedException('פרטי כניסה שגויים');
    await this.consumeOtp(user, code);
    if (deviceId) {
      const st = await this.resolveReaderDevice(user.id, deviceId);
      if (st !== 'approved') return { deviceStatus: st };
    }
    await this.audit('user.login', user.id, user.id);
    return this.tokenFor(user.id, user.email, user.role, deviceId ? { reader: true, device: deviceId } : undefined);
  }

  // בקשת הפעלת 2FA — שולח קוד אישור למייל.
  async request2FAEnable(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (user.twoFactorEnabled) throw new BadRequestException('אימות דו-שלבי כבר מופעל');
    const code = await this.issueOtp(user.id);
    await this.mail.sendOtp(user.email, code, 'enable');
    return { sent: true };
  }

  // אישור הפעלת 2FA בעזרת הקוד שנשלח למייל.
  async confirm2FAEnable(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    await this.consumeOtp(user, code);
    await this.prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    await this.audit('user.2fa.enabled', user.id, user.id);
    return { twoFactorEnabled: true };
  }

  // כיבוי 2FA — דורש אישור סיסמה.
  async disable2FA(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('הסיסמה שגויה');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, otpCodeHash: null, otpExpiresAt: null },
    });
    await this.audit('user.2fa.disabled', user.id, user.id);
    return { twoFactorEnabled: false };
  }

  // מייצר קוד בן 6 ספרות, שומר אותו מוצפן עם תוקף 10 דקות, ומחזיר אותו (לשליחה במייל).
  private async issueOtp(userId: string): Promise<string> {
    const code = String(randomInt(100000, 1000000));
    const otpCodeHash = await bcrypt.hash(code, 10);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await this.prisma.user.update({ where: { id: userId }, data: { otpCodeHash, otpExpiresAt, otpAttempts: 0 } });
    return code;
  }

  // מאמת ומבטל קוד חד-פעמי. זורק שגיאה אם אין קוד, פג תוקף, או שגוי.
  private async consumeOtp(
    user: { id: string; otpCodeHash: string | null; otpExpiresAt: Date | null; otpAttempts?: number },
    code: string,
  ): Promise<void> {
    if (!user.otpCodeHash || !user.otpExpiresAt) throw new UnauthorizedException('לא נשלח קוד, בקש קוד חדש');
    if (user.otpExpiresAt.getTime() < Date.now()) {
      await this.prisma.user.update({ where: { id: user.id }, data: { otpCodeHash: null, otpExpiresAt: null, otpAttempts: 0 } });
      throw new UnauthorizedException('הקוד פג תוקף, בקש קוד חדש');
    }
    const ok = await bcrypt.compare(code, user.otpCodeHash);
    if (!ok) {
      const attempts = (user.otpAttempts ?? 0) + 1;
      if (attempts >= 5) {
        // יותר מדי ניסיונות שגויים — מבטלים את הקוד; צריך לבקש קוד חדש (מאט ניחוש בכוח).
        await this.prisma.user.update({ where: { id: user.id }, data: { otpCodeHash: null, otpExpiresAt: null, otpAttempts: 0 } });
        throw new UnauthorizedException('יותר מדי ניסיונות שגויים — בקש קוד חדש');
      }
      await this.prisma.user.update({ where: { id: user.id }, data: { otpAttempts: attempts } });
      throw new UnauthorizedException('קוד שגוי');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { otpCodeHash: null, otpExpiresAt: null, otpAttempts: 0 } });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.name,
      roleKey: user.role.key,
      isOwner: user.role.isOwner,
      // בעלים מקבל את כל ההרשאות; שאר התפקידים — רק מה שמוגדר להם.
      permissions: user.role.isOwner ? ALL_PERMISSIONS : user.role.permissions,
      twoFactorEnabled: user.twoFactorEnabled,
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const currentOk = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!currentOk) throw new UnauthorizedException('הסיסמה הנוכחית שגויה');

    const same = await bcrypt.compare(dto.newPassword, user.passwordHash);
    if (same) throw new BadRequestException('הסיסמה החדשה זהה לנוכחית');

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.audit('user.change_password', user.id, user.id);

    const role = await this.prisma.role.findUnique({ where: { id: user.roleId } });
    return this.tokenFor(user.id, user.email, role ?? { name: '', key: null });
  }

  // יוצר טוקן כניסה. בטוקן נשמרים שם התפקיד ומפתחו (להצגה); ההרשאות עצמן נטענות
  // תמיד מחדש מה-DB בכל בקשה מוגנת, כך ששינוי תפקיד נכנס לתוקף מיד.
  private tokenFor(id: string, email: string, role: { name: string; key: string | null }, opts?: { reader?: boolean; device?: string }) {
    const payload: any = { sub: id, email, role: role.name, roleKey: role.key };
    if (opts?.reader) { payload.reader = true; payload.device = opts.device; }
    const accessToken = this.jwt.sign(payload);
    return { accessToken, reader: !!opts?.reader, user: { id, email, role: role.name, roleKey: role.key } };
  }

  // בודק/יוצר מכשיר Reader ומחזיר את מצבו. מכשיר חדש נרשם כ"ממתין לאישור" וחוסם כניסה עד שמנהל יאשר.
  async resolveReaderDevice(userId: string, deviceId: string, name?: string): Promise<'approved' | 'pending' | 'revoked'> {
    let dev = await this.prisma.device.findUnique({ where: { userId_deviceId: { userId, deviceId } } });
    if (!dev) {
      dev = await this.prisma.device.create({ data: { userId, deviceId, name: (name || 'Archive Reader').slice(0, 80), lastSeenAt: new Date() } });
      await this.audit('device.registered', userId, dev.id, { deviceId }, 'device');
      return 'pending';
    }
    if (dev.revokedAt) return 'revoked';
    await this.prisma.device.update({ where: { id: dev.id }, data: { lastSeenAt: new Date() } });
    return dev.approved ? 'approved' : 'pending';
  }

  private async audit(action: string, userId: string | null, targetId: string | null, details?: any, targetType: string = 'user') {
    await this.prisma.auditEvent.create({
      data: { action, userId, targetType, targetId, details },
    });
  }
}

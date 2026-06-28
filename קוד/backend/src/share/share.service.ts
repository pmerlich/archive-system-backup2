// share.service.ts — קישורי צפייה חיצוניים (שלב 3.5).
// מאפשר לאדם מחוץ למערכת לצפות בקובץ (גרסת-צפייה ממוית-מים, לא המקור, ללא הורדה) דרך קישור עם token אקראי.
// כל התנאים נאכפים בשרת: תפוגה, מספר צפיות, מייל מסוים + קוד חד-פעמי, מכשיר אחד, חסימת IP, חסימה מחוץ לישראל,
// אישור ידני לפני הצפייה הראשונה, סימן מים, איסור הורדה, וביטול מיידי. אין כאן התחברות — הגישה נשענת על ה-token והתנאים.
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { WatermarkService } from '../watermark/watermark.service';
import { ViewingService } from '../viewing/viewing.service';
import { ScopeService } from '../scope/scope.service';

const SESSION_TTL_MS = 15 * 60 * 1000; // חלון הפעלת קישור: 15 דקות
const TOKEN_TTL_SEC = 120; // טוקן רינדור קצר-מועד
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
// תבנית ברירת מחדל לסימן מים לאורח חיצוני, כשאין תבנית פעילה במערכת (כדי שתמיד יהיה זיהוי).
const GUEST_WM = { text: '{email} · {datetime} · {viewid}', fontSize: 24, color: '#ffffff', opacity: 0.3, position: 'tiled', angle: 30, motion: false };

@Injectable()
export class ShareService {
  private readonly logger = new Logger('ShareService');
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly watermark: WatermarkService,
    private readonly viewing: ViewingService,
    private readonly scope: ScopeService,
    config: ConfigService,
  ) {
    this.secret = config.get<string>('jwtSecret') as string;
  }

  // ═══════════════ צד ניהול (דורש links.manage) ═══════════════

  async create(actorId: string, input: any) {
    const fileId = (input?.fileId || '').trim();
    if (!fileId) throw new BadRequestException('חסר מזהה קובץ');
    const file = await this.prisma.file.findFirst({ where: { id: fileId, deletedAt: null } });
    if (!file) throw new NotFoundException('הקובץ לא נמצא');
    if (this.viewing.classify(file.mimeType) === 'unsupported') throw new BadRequestException('אין צפייה מוגנת לסוג קובץ זה — לא ניתן לשתף');

    const email = input.email ? String(input.email).trim().toLowerCase().slice(0, 200) : null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('כתובת מייל לא תקינה');
    const link = await this.prisma.shareLink.create({
      data: {
        token: randomBytes(32).toString('base64url'),
        fileId,
        label: input.label ? String(input.label).slice(0, 120) : null,
        email,
        requireOtp: !!input.requireOtp || !!email, // מייל מסוים מחייב אימות בקוד
        requireApproval: !!input.requireApproval,
        maxViews: this.posIntOrNull(input.maxViews),
        expiresAt: this.futureDateOrNull(input.expiresAt),
        singleDevice: !!input.singleDevice,
        ipBlock: input.ipBlock ? String(input.ipBlock).slice(0, 1000) : null,
        israelOnly: !!input.israelOnly,
        watermark: input.watermark === undefined ? true : !!input.watermark,
        watermarkText: input.watermarkText ? String(input.watermarkText).slice(0, 120) : null,
        allowDownload: false, // איסור הורדה — קישור חיצוני לעולם לא מגיש מקור
        createdById: actorId,
      },
    });
    await this.audit('share.created', actorId, fileId, { linkId: link.id });
    return this.publicShape(link, file.name);
  }

  async listForFile(fileId: string) {
    const links = await this.prisma.shareLink.findMany({ where: { fileId }, orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] });
    return this.enrich(links);
  }

  async listAll() {
    const links = await this.prisma.shareLink.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] });
    return this.enrich(links);
  }

  // הפעלות שממתינות לאישור ידני (לכל הקישורים או לקישור מסוים).
  async pendingApprovals(linkId?: string) {
    const sessions = await this.prisma.shareSession.findMany({
      where: { approved: false, revokedAt: null, expiresAt: { gt: new Date() }, ...(linkId ? { linkId } : {}) },
      orderBy: { createdAt: 'desc' }, take: 500,
    });
    // רק הפעלות שהקישור שלהן דורש אישור, פעיל, ועברו אימות מייל (אם הקישור דורש קוד).
    const linkIds = [...new Set(sessions.map((s) => s.linkId))];
    const links = linkIds.length ? await this.prisma.shareLink.findMany({ where: { id: { in: linkIds }, requireApproval: true, active: true } }) : [];
    const okLinks = new Map(links.map((l) => [l.id, l]));
    return sessions.filter((s) => { const l = okLinks.get(s.linkId); return l && (!l.requireOtp || s.verified); }).map((s) => ({
      id: s.id, linkId: s.linkId, email: s.email, ip: s.ip, country: s.country,
      createdAt: s.createdAt, label: okLinks.get(s.linkId)?.label ?? null, fileId: s.fileId,
    }));
  }

  async approveSession(actorId: string, sessionId: string) {
    const s = await this.prisma.shareSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('ההפעלה לא נמצאה');
    const upd = await this.prisma.shareSession.update({ where: { id: sessionId }, data: { approved: true } });
    await this.audit('share.session.approved', actorId, s.fileId, { sessionId, linkId: s.linkId });
    return { id: upd.id, approved: upd.approved };
  }

  async revoke(actorId: string, id: string) {
    const link = await this.prisma.shareLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('הקישור לא נמצא');
    await this.prisma.shareLink.update({ where: { id }, data: { active: false, revokedAt: new Date(), revokedById: actorId } });
    // ביטול הקישור מבטל מיד גם את כל ההפעלות הפתוחות שלו.
    await this.prisma.shareSession.updateMany({ where: { linkId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit('share.revoked', actorId, link.fileId, { linkId: id });
    return { id, revoked: true };
  }

  // ═══════════════ צד ציבורי (ללא התחברות) ═══════════════

  // פתיחת קישור: בודק את כל תנאי-השער שלא תלויים בקלט המשתמש, ומחזיר מה נדרש (מייל/קוד/אישור) או טוקן צפייה.
  async start(token: string, deviceKey: string, ip?: string, userAgent?: string) {
    const link = await this.loadActiveLink(token);
    this.assertNotExpired(link);
    this.assertQuota(link);
    this.assertIpAllowed(link, ip);
    const country = await this.resolveCountry(ip);
    this.assertGeo(link, country);
    this.assertDevice(link, deviceKey);

    const session = await this.prisma.shareSession.create({
      data: {
        linkId: link.id, fileId: link.fileId, deviceKey: deviceKey ? String(deviceKey).slice(0, 200) : null,
        ip: ip ? String(ip).slice(0, 100) : null, country, userAgent: userAgent ? String(userAgent).slice(0, 400) : null,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });

    const needVerify = link.requireOtp; // (כולל המקרה של מייל-מסוים, שמסומן requireOtp בעת היצירה)
    const needApproval = link.requireApproval;
    if (!needVerify && !needApproval) {
      return this.finalizeOpen(link, session, deviceKey, ip);
    }
    return {
      ready: false, sid: session.id,
      needVerify, needApproval,
      emailLocked: !!link.email, emailHint: link.email ? this.maskEmail(link.email) : null,
    };
  }

  // שליחת קוד חד-פעמי למייל (אם הקישור מוגבל למייל מסוים — חייב להתאים).
  async requestOtp(token: string, sid: string, email: string) {
    const link = await this.loadActiveLink(token);
    const session = await this.loadSession(link, sid);
    if (!link.requireOtp) throw new BadRequestException('קישור זה אינו דורש קוד');
    const to = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new BadRequestException('כתובת מייל לא תקינה');
    if (link.email && to !== link.email) throw new ForbiddenException('המייל אינו תואם להזמנה');

    const code = String(randomInt(100000, 1000000));
    await this.prisma.shareSession.update({
      where: { id: session.id },
      data: { email: to, otpCodeHash: await bcrypt.hash(code, 10), otpExpiresAt: new Date(Date.now() + OTP_TTL_MS), otpAttempts: 0 },
    });
    await this.mail.sendOtp(to, code, 'share');
    await this.audit('share.otp_sent', null, link.fileId, { sessionId: session.id });
    return { sent: true };
  }

  // אימות הקוד; אם נדרש אישור ידני וטרם ניתן — מחזיר pendingApproval. אחרת — פותח (טוקן צפייה).
  async verify(token: string, sid: string, code: string, deviceKey: string, ip?: string) {
    const link = await this.loadActiveLink(token);
    const session = await this.loadSession(link, sid);
    if (link.requireOtp && !session.verified) {
      if (!session.otpCodeHash || !session.otpExpiresAt) throw new BadRequestException('לא נשלח קוד — בקש קוד תחילה');
      if (session.otpExpiresAt.getTime() < Date.now()) throw new ForbiddenException('הקוד פג תוקף — בקש קוד חדש');
      if (session.otpAttempts >= OTP_MAX_ATTEMPTS) throw new ForbiddenException('יותר מדי ניסיונות — בקש קוד חדש');
      const ok = await bcrypt.compare(String(code || ''), session.otpCodeHash);
      if (!ok) {
        await this.prisma.shareSession.update({ where: { id: session.id }, data: { otpAttempts: { increment: 1 } } });
        throw new ForbiddenException('קוד שגוי');
      }
      await this.prisma.shareSession.update({ where: { id: session.id }, data: { verified: true, otpCodeHash: null, otpExpiresAt: null } });
      session.verified = true;
    }
    if (link.requireApproval && !session.approved) {
      return { ready: false, pendingApproval: true, sid: session.id };
    }
    return this.finalizeOpen(link, session, deviceKey, ip);
  }

  // בדיקת מצב (פולינג) — לאחר שהמנהל אישר, מחזיר טוקן צפייה.
  async status(token: string, sid: string, deviceKey: string, ip?: string) {
    const link = await this.loadActiveLink(token);
    const session = await this.loadSession(link, sid);
    const needVerify = link.requireOtp && !session.verified;
    const needApproval = link.requireApproval && !session.approved;
    if (needVerify) return { ready: false, needVerify: true, needApproval: link.requireApproval && !session.approved };
    if (needApproval) return { ready: false, needApproval: true };
    return this.finalizeOpen(link, session, deviceKey, ip);
  }

  async refreshToken(token: string, sid: string, ip?: string, deviceKey?: string) {
    const { link, session } = await this.authorizeOpen(token, sid, ip, deviceKey);
    return { token: this.mintToken(link, session), tokenExpiresIn: TOKEN_TTL_SEC };
  }

  // אימות לפני הגשת גרסת צפייה: בודק את טוקן הרינדור ומאמת מחדש את כל התנאים (ביטול/תפוגה/מכשיר/IP/מדינה).
  async authorizeRendition(token: string, vt: string, ip?: string, deviceKey?: string) {
    if (!vt) throw new ForbiddenException('חסר טוקן צפייה');
    let payload: any;
    try { payload = this.jwt.verify(vt, { secret: this.secret, algorithms: ['HS256'] }); }
    catch { throw new ForbiddenException('טוקן צפייה לא תקין או שפג תוקפו'); }
    if (payload.purpose !== 'share' || payload.token !== token) throw new ForbiddenException('טוקן צפייה לא תואם');
    const { link, session } = await this.authorizeOpen(token, payload.sid, ip, deviceKey);
    await this.prisma.shareSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date(), viewCount: { increment: 1 } } });
    // אובייקט "הפעלה" סינתטי לצריבת סימן המים האישי לאורח (ללא משתמש מחובר).
    const s = { id: session.id, fileId: link.fileId, userId: null as any, ip: session.ip, subjectEmail: session.email || link.email || '', subjectName: 'אורח' };
    const layers: any[] = [];
    if (link.watermark) {
      const ctx = await this.scope.fileContext(link.fileId);
      const tpls = ctx ? await this.watermark.applicableFor(ctx) : [];
      layers.push(...(tpls.length ? tpls : [GUEST_WM])); // אם אין תבנית חלה — ברירת מחדל לאורח
    }
    if (link.watermarkText) layers.push({ ...GUEST_WM, text: link.watermarkText, position: 'tiled' }); // סימן מים מותאם לנמען
    const wm: any = layers.length ? layers : null;
    return { s, wm, kind: this.viewing.classify((await this.fileOf(link.fileId)).mimeType) };
  }

  // ═══════════════ פנימי ═══════════════

  // אימות שההפעלה והקישור עדיין תקפים ועומדים בכל התנאים — נקרא בכל רינדור/רענון (ביטול מיידי).
  private async authorizeOpen(token: string, sid: string, ip?: string, deviceKey?: string) {
    const link = await this.loadActiveLink(token);
    const session = await this.loadSession(link, sid);
    if (link.requireOtp && !session.verified) throw new ForbiddenException('נדרש אימות');
    if (link.requireApproval && !session.approved) throw new ForbiddenException('ממתין לאישור');
    this.assertNotExpired(link);
    this.assertIpAllowed(link, ip);
    this.assertGeo(link, session.country); // לפי המדינה שזוהתה בפתיחה
    this.assertDevice(link, deviceKey);
    return { link, session };
  }

  private async finalizeOpen(link: any, session: any, deviceKey: string, ip?: string) {
    this.assertNotExpired(link);
    this.assertIpAllowed(link, ip);
    this.assertGeo(link, session.country);
    this.assertDevice(link, deviceKey);
    // ספירת צפייה אטומית (אם יש מכסה)
    if (link.maxViews !== null && link.maxViews !== undefined) {
      const claim = await this.prisma.shareLink.updateMany({ where: { id: link.id, active: true, viewsUsed: { lt: link.maxViews } }, data: { viewsUsed: { increment: 1 } } });
      if (claim.count === 0) throw new ForbiddenException('מכסת הצפיות לקישור זה נוצלה');
    } else {
      await this.prisma.shareLink.update({ where: { id: link.id }, data: { viewsUsed: { increment: 1 } } });
    }
    // נעילת מכשיר בפתיחה הראשונה
    if (link.singleDevice && !link.boundDeviceKey && deviceKey) {
      await this.prisma.shareLink.update({ where: { id: link.id }, data: { boundDeviceKey: deviceKey } });
    }
    await this.prisma.shareSession.update({ where: { id: session.id }, data: { verified: true, lastUsedAt: new Date() } });
    const file = await this.fileOf(link.fileId);
    const kind = this.viewing.classify(file.mimeType);
    const pages = kind === 'pdf' ? await this.viewing.pdfPagesPublic(file.hash) : 0;
    await this.audit('share.opened', null, link.fileId, { linkId: link.id, sessionId: session.id, kind });
    return {
      ready: true, sid: session.id, kind, pages, name: file.name, mimeType: file.mimeType,
      watermark: link.watermark,
      token: this.mintToken(link, session), tokenExpiresIn: TOKEN_TTL_SEC,
    };
  }

  private mintToken(link: any, session: any): string {
    return this.jwt.sign({ purpose: 'share', token: link.token, sid: session.id, linkId: link.id }, { secret: this.secret, expiresIn: TOKEN_TTL_SEC });
  }

  private async loadActiveLink(token: string) {
    const link = token ? await this.prisma.shareLink.findUnique({ where: { token } }) : null;
    if (!link || !link.active || link.revokedAt) throw new NotFoundException('הקישור אינו זמין (בוטל או אינו קיים)');
    return link;
  }
  private async loadSession(link: any, sid: string) {
    const s = sid ? await this.prisma.shareSession.findUnique({ where: { id: sid } }) : null;
    if (!s || s.linkId !== link.id) throw new ForbiddenException('הפעלת הצפייה לא נמצאה');
    if (s.revokedAt) throw new ForbiddenException('הצפייה בוטלה');
    if (s.expiresAt.getTime() < Date.now()) throw new ForbiddenException('הפעלת הצפייה פגה — פתח את הקישור מחדש');
    return s;
  }
  private async fileOf(fileId: string) {
    const f = await this.prisma.file.findFirst({ where: { id: fileId, deletedAt: null } });
    if (!f) throw new NotFoundException('הקובץ לא נמצא');
    return f;
  }

  private assertNotExpired(link: any) { if (link.expiresAt && new Date(link.expiresAt).getTime() < Date.now()) throw new ForbiddenException('הקישור פג תוקף'); }
  private assertQuota(link: any) { if (link.maxViews !== null && link.maxViews !== undefined && link.viewsUsed >= link.maxViews) throw new ForbiddenException('מכסת הצפיות לקישור זה נוצלה'); }
  private assertDevice(link: any, deviceKey?: string) {
    if (!link.singleDevice) return;
    if (!deviceKey) throw new ForbiddenException('נדרש מזהה מכשיר לצפייה בקישור זה');
    if (link.boundDeviceKey && link.boundDeviceKey !== deviceKey) throw new ForbiddenException('הקישור ננעל למכשיר אחר');
  }
  private assertIpAllowed(link: any, ip?: string) {
    if (!link.ipBlock) return;
    const v = this.normIp(ip);
    const entries = String(link.ipBlock).split(',').map((x) => x.trim()).filter(Boolean);
    for (const e of entries) {
      if (e.endsWith('.') ? v.startsWith(e) : v === e) throw new ForbiddenException('הגישה חסומה מכתובת ה-IP שלך');
    }
  }
  private assertGeo(link: any, country?: string | null) {
    if (link.israelOnly && country !== 'IL') throw new ForbiddenException('צפייה בקישור זה מותרת מישראל בלבד');
  }

  // זיהוי מדינה לפי IP. כתובות פרטיות/מקומיות = ישראל (רשת הבעלים). ציבורי → שירות חיצוני (בשרת); אם לא זמין → לא ידוע.
  private async resolveCountry(ip?: string): Promise<string> {
    const v = this.normIp(ip);
    if (!v) return 'XX';
    if (this.isPrivate(v)) return 'IL';
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(`https://ipapi.co/${encodeURIComponent(v)}/country/`, { signal: ctrl.signal });
      clearTimeout(t);
      const c = (await res.text()).trim().toUpperCase();
      return /^[A-Z]{2}$/.test(c) ? c : 'XX';
    } catch { return 'XX'; }
  }
  private normIp(ip?: string): string { return String(ip || '').replace(/^::ffff:/, '').trim(); }
  private isPrivate(v: string): boolean {
    return v === '::1' || /^127\./.test(v) || /^10\./.test(v) || /^192\.168\./.test(v) || /^172\.(1[6-9]|2\d|3[01])\./.test(v) || /^169\.254\./.test(v) || /^f[cd]/i.test(v) || /^fe80/i.test(v);
  }
  private maskEmail(e: string): string { const [u, d] = e.split('@'); if (!d) return '***'; return `${u.slice(0, 1)}***@${d}`; }
  private posIntOrNull(v: any): number | null { if (v === undefined || v === null || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 100000) throw new BadRequestException('מספר הצפיות חייב להיות מספר שלם בין 1 ל-100000'); return n; }
  private futureDateOrNull(v: any): Date | null { if (!v) return null; const d = new Date(v); if (isNaN(d.getTime())) throw new BadRequestException('תאריך תפוגה לא תקין'); if (d.getTime() <= Date.now()) throw new BadRequestException('תאריך התפוגה חייב להיות בעתיד'); return d; }

  private async enrich(links: any[]) {
    const fileIds = [...new Set(links.map((l) => l.fileId))];
    const files = fileIds.length ? await this.prisma.file.findMany({ where: { id: { in: fileIds } }, select: { id: true, name: true } }) : [];
    const fMap = new Map(files.map((f) => [f.id, f.name]));
    const now = Date.now();
    const cand = links.length ? await this.prisma.shareSession.findMany({ where: { linkId: { in: links.map((l) => l.id) }, approved: false, revokedAt: null, expiresAt: { gt: new Date() } }, select: { linkId: true, verified: true } }) : [];
    const byId = new Map(links.map((l) => [l.id, l]));
    const pendMap = new Map<string, number>();
    for (const c of cand) { const lk = byId.get(c.linkId); if (!lk || !lk.requireApproval) continue; if (lk.requireOtp && !c.verified) continue; pendMap.set(c.linkId, (pendMap.get(c.linkId) ?? 0) + 1); }
    return links.map((l) => ({
      ...this.publicShape(l, fMap.get(l.fileId) ?? '(קובץ נמחק)'),
      pendingApprovals: l.requireApproval ? (pendMap.get(l.id) ?? 0) : 0,
      state: !l.active || l.revokedAt ? 'revoked'
        : l.expiresAt && new Date(l.expiresAt).getTime() < now ? 'expired'
        : l.maxViews !== null && l.viewsUsed >= l.maxViews ? 'exhausted'
        : 'active',
    }));
  }

  // הצורה שמוחזרת לניהול (כולל ה-token כדי לבנות את כתובת השיתוף).
  private publicShape(l: any, fileName: string) {
    return {
      id: l.id, token: l.token, fileId: l.fileId, fileName, label: l.label,
      email: l.email, requireOtp: l.requireOtp, requireApproval: l.requireApproval,
      maxViews: l.maxViews, viewsUsed: l.viewsUsed, expiresAt: l.expiresAt,
      singleDevice: l.singleDevice, boundDeviceKey: l.boundDeviceKey ? true : false,
      ipBlock: l.ipBlock, israelOnly: l.israelOnly, watermark: l.watermark, watermarkText: l.watermarkText,
      active: l.active, revokedAt: l.revokedAt, createdAt: l.createdAt,
    };
  }

  private async audit(action: string, userId: string | null, fileId: string, details: any) {
    await this.prisma.auditEvent.create({ data: { action, userId, targetType: 'file', targetId: fileId, details } });
  }
}

// users.service.ts — ניהול משתמשים: רשימה ושינוי תפקיד.
// כל שינוי תפקיד נרשם בלוג (מי שינה, למי, מתי, ומה היה התפקיד הקודם) — לפי דרישת האפיון.
// שתי הגנות חשובות: רק "בעלים" יכול לגעת בתפקיד בעלים, ואי אפשר להסיר את הבעלים האחרון.
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// תיאור מקוצר של תפקיד כפי שמוחזר עם משתמש.
type RoleLite = { key: string | null; name: string; isOwner: boolean };

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // ממיר משתמש + תפקיד לאובייקט תצוגה אחיד.
  private summary(
    user: { id: string; name: string; email: string; twoFactorEnabled: boolean; createdAt: Date },
    role: RoleLite,
  ) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: role.name,
      roleKey: role.key,
      isOwner: role.isOwner,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
    };
  }

  // רשימת כל המשתמשים הפעילים (לא מחוקים).
  async listUsers() {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { role: true },
    });
    return users.map((u) => this.summary(u, u.role));
  }

  // שינוי תפקיד של משתמש בידי actor (המשתמש שמבצע את הפעולה).
  async changeRole(actor: { id: string; isOwner: boolean }, targetId: string, roleKey: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      include: { role: true },
    });
    if (!target || target.deletedAt) throw new NotFoundException('המשתמש לא נמצא');

    const newRole = await this.prisma.role.findUnique({ where: { key: roleKey } });
    if (!newRole) throw new BadRequestException('התפקיד שנבחר אינו קיים');

    // רק בעלים רשאי להעניק תפקיד בעלים או לשנות תפקיד של בעלים קיים.
    if ((newRole.isOwner || target.role.isOwner) && !actor.isOwner) {
      throw new ForbiddenException('רק בעלים רשאי לשנות תפקיד בעלים');
    }

    // אסור להשאיר את המערכת בלי אף בעלים ("שבירת זכוכית").
    if (target.role.isOwner && !newRole.isOwner) {
      const owners = await this.prisma.user.count({
        where: { role: { isOwner: true }, deletedAt: null },
      });
      if (owners <= 1) throw new BadRequestException('אי אפשר להסיר את הבעלים האחרון במערכת');
    }

    // אין שינוי בפועל — מחזירים כמו שהוא.
    if (target.roleId === newRole.id) return this.summary(target, target.role);

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { roleId: newRole.id },
      include: { role: true },
    });

    // תיעוד מלא של השינוי בלוג הפעילות.
    await this.prisma.auditEvent.create({
      data: {
        action: 'user.role.changed',
        userId: actor.id,
        targetType: 'user',
        targetId: targetId,
        details: {
          from: target.role.key ?? target.role.name,
          to: newRole.key,
          targetEmail: target.email,
        },
      },
    });

    return this.summary(updated, updated.role);
  }
}

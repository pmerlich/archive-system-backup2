// restrictions.service.ts — הגבלות צפייה (שלב 3.4).
// הגבלה = "רשימת היתר" לקובץ: מי (משתמש/כולם), מאיזה מכשיר, עד מתי, וכמה פעמים מותר לצפות.
// אם לקובץ יש הגבלה פעילה אחת או יותר — צפייה מתאפשרת רק למי שעומד בתנאי אחת מהן (נאכף ב-ViewingService).
// כאן רק הניהול (יצירה/רשימה/עדכון/ביטול); האכיפה עצמה ב-viewing.service.ts. הכול נרשם בלוג הביקורת.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type CreateInput = {
  fileId?: string;
  userId?: string | null; // null/חסר = כל המשתמשים
  deviceId?: string | null; // null/חסר = כל מכשיר; אחרת deviceId של מכשיר מאושר
  expiresAt?: string | null; // ISO; חסר = ללא תפוגה
  maxViews?: number | null; // חסר = ללא הגבלת כמות
  note?: string | null;
};
type UpdateInput = { expiresAt?: string | null; maxViews?: number | null; note?: string | null };

@Injectable()
export class RestrictionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────── עזרי העשרה (שמות קובץ/משתמש/מכשיר לתצוגה) ─────────
  private async enrich(rows: any[]) {
    const fileIds = [...new Set(rows.map((r) => r.fileId))];
    const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean) as string[])];
    const devIds = [...new Set(rows.map((r) => r.deviceId).filter(Boolean) as string[])];
    const [files, users, devices] = await Promise.all([
      fileIds.length ? this.prisma.file.findMany({ where: { id: { in: fileIds } }, select: { id: true, name: true } }) : [],
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [],
      devIds.length ? this.prisma.device.findMany({ where: { deviceId: { in: devIds } }, select: { deviceId: true, name: true } }) : [],
    ]);
    const fMap = new Map(files.map((f) => [f.id, f.name]));
    const uMap = new Map(users.map((u) => [u.id, u]));
    const dMap = new Map(devices.map((d) => [d.deviceId, d.name]));
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      fileId: r.fileId,
      fileName: fMap.get(r.fileId) ?? '(קובץ נמחק)',
      scope: r.userId ? { userId: r.userId, userName: uMap.get(r.userId)?.name ?? r.userId, userEmail: uMap.get(r.userId)?.email ?? '' } : null,
      device: r.deviceId ? { deviceId: r.deviceId, deviceName: dMap.get(r.deviceId) ?? 'מכשיר' } : null,
      expiresAt: r.expiresAt,
      maxViews: r.maxViews,
      viewsUsed: r.viewsUsed,
      viewsLeft: r.maxViews === null ? null : Math.max(0, r.maxViews - r.viewsUsed),
      active: r.active,
      note: r.note,
      createdAt: r.createdAt,
      revokedAt: r.revokedAt,
      // מצב מחושב לתצוגה: פעיל / בוטל / פג / מוצה
      state: !r.active || r.revokedAt ? 'revoked'
        : r.expiresAt && new Date(r.expiresAt).getTime() < now ? 'expired'
        : r.maxViews !== null && r.viewsUsed >= r.maxViews ? 'exhausted'
        : 'active',
    }));
  }

  // כל ההגבלות (לריכוז במסך /restrictions) — פעילות תחילה, חדש→ישן.
  async listAll() {
    const rows = await this.prisma.viewRestriction.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] });
    return this.enrich(rows);
  }

  // ההגבלות של קובץ מסוים (לחלון "הגבלת גישה" של הקובץ).
  async listForFile(fileId: string) {
    const rows = await this.prisma.viewRestriction.findMany({ where: { fileId }, orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] });
    return this.enrich(rows);
  }

  // נתוני עזר לטופס: רשימת משתמשים + מכשירים מאושרים (כדי לבחור "למי" ו"לאיזה מכשיר").
  async meta() {
    const [users, devices] = await Promise.all([
      this.prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
      this.prisma.device.findMany({ where: { approved: true, revokedAt: null }, orderBy: { lastSeenAt: 'desc' } }),
    ]);
    const uMap = new Map(users.map((u) => [u.id, u]));
    return {
      users,
      devices: devices.map((d) => ({ deviceId: d.deviceId, name: d.name, user: uMap.get(d.userId) ?? null })),
    };
  }

  // ───────── יצירה ─────────
  async create(actorId: string, input: CreateInput) {
    const fileId = (input.fileId || '').trim();
    if (!fileId) throw new BadRequestException('חסר מזהה קובץ');
    const file = await this.prisma.file.findFirst({ where: { id: fileId, deletedAt: null } });
    if (!file) throw new NotFoundException('הקובץ לא נמצא');

    let userId: string | null = null;
    if (input.userId) {
      const u = await this.prisma.user.findFirst({ where: { id: input.userId, deletedAt: null } });
      if (!u) throw new BadRequestException('המשתמש שנבחר לא נמצא');
      userId = u.id;
    }

    let deviceId: string | null = null;
    if (input.deviceId) {
      const dev = await this.prisma.device.findFirst({ where: { deviceId: input.deviceId, approved: true, revokedAt: null } });
      if (!dev) throw new BadRequestException('המכשיר שנבחר אינו מאושר או לא נמצא');
      if (userId && dev.userId !== userId) throw new BadRequestException('המכשיר שנבחר שייך למשתמש אחר');
      deviceId = dev.deviceId;
    }

    const expiresAt = this.parseExpiry(input.expiresAt);
    const maxViews = this.parseMaxViews(input.maxViews);
    if (userId === null && deviceId === null && expiresAt === null && maxViews === null) {
      throw new BadRequestException('יש לבחור לפחות תנאי אחד: משתמש, מכשיר, תפוגה או מספר צפיות');
    }

    const r = await this.prisma.viewRestriction.create({
      data: { fileId, userId, deviceId, expiresAt, maxViews, note: (input.note || '').slice(0, 300) || null, createdById: actorId },
    });
    await this.audit('restriction.created', actorId, fileId, { restrictionId: r.id, userId, deviceId, expiresAt, maxViews });
    return (await this.enrich([r]))[0];
  }

  // ───────── עדכון תנאים (תפוגה/כמות/הערה) ─────────
  async update(actorId: string, id: string, input: UpdateInput) {
    const r = await this.prisma.viewRestriction.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('ההגבלה לא נמצאה');
    const data: any = {};
    if (input.expiresAt !== undefined) data.expiresAt = this.parseExpiry(input.expiresAt);
    if (input.maxViews !== undefined) data.maxViews = this.parseMaxViews(input.maxViews);
    if (input.note !== undefined) data.note = (input.note || '').slice(0, 300) || null;
    const upd = await this.prisma.viewRestriction.update({ where: { id }, data });
    await this.audit('restriction.updated', actorId, r.fileId, { restrictionId: id, ...data });
    return (await this.enrich([upd]))[0];
  }

  // ───────── ביטול מיידי ─────────
  async revoke(actorId: string, id: string) {
    const r = await this.prisma.viewRestriction.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('ההגבלה לא נמצאה');
    const upd = await this.prisma.viewRestriction.update({ where: { id }, data: { active: false, revokedAt: new Date(), revokedById: actorId } });
    await this.audit('restriction.revoked', actorId, r.fileId, { restrictionId: id });
    return (await this.enrich([upd]))[0];
  }

  // ───────── עזר ─────────
  private parseExpiry(v?: string | null): Date | null {
    if (v === undefined || v === null || v === '') return null;
    const d = new Date(v);
    if (isNaN(d.getTime())) throw new BadRequestException('תאריך תפוגה לא תקין');
    if (d.getTime() <= Date.now()) throw new BadRequestException('תאריך התפוגה חייב להיות בעתיד');
    return d;
  }
  private parseMaxViews(v?: number | null): number | null {
    if (v === undefined || v === null || (v as any) === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 100000) throw new BadRequestException('מספר הצפיות חייב להיות מספר שלם בין 1 ל-100000');
    return n;
  }
  private async audit(action: string, userId: string, fileId: string, details: any) {
    await this.prisma.auditEvent.create({ data: { action, userId, targetType: 'file', targetId: fileId, details } });
  }
}

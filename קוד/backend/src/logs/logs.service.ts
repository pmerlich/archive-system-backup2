// logs.service.ts — קריאת לוג הביקורת (שלב 2.6). קריאה בלבד — לעולם לא משנים/מוחקים אירועים.
// מחזיר אירועים עם תווית פעולה ידידותית בעברית ושם המשתמש שביצע, ממוין מהחדש לישן, בטעינה במנות.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const ACTION_LABELS: Record<string, string> = {
  'file.uploaded': 'קובץ הועלה',
  'file.downloaded': 'הורדת מקור',
  'file.deleted': 'קובץ נמחק (לסל המחזור)',
  'file.restored': 'קובץ שוחזר',
  'file.duplicates.merged': 'כפילויות מוזגו',
  'folder.created': 'תיקייה נוצרה',
  'folder.deleted': 'תיקייה נמחקה',
  'folder.restored': 'תיקייה שוחזרה',
  'tag.created': 'תגית נוצרה',
  'tag.updated': 'תגית עודכנה',
  'tag.moved': 'תגית הועברה',
  'tag.deleted': 'תגית נמחקה',
  'collection.created': 'אוסף נוצר',
  'collection.updated': 'אוסף עודכן',
  'collection.deleted': 'אוסף נמחק',
  'import.scan.created': 'סריקת ייבוא נוצרה',
  'import.scanned': 'סריקת ייבוא הושלמה',
  'import.started': 'ייבוא התחיל',
  'import.completed': 'ייבוא הושלם',
  'user.register': 'משתמש נרשם',
  'user.login': 'התחברות',
  'user.change_password': 'סיסמה שונתה',
  'user.role.changed': 'תפקיד שונה',
  'file.view.opened': 'צפייה מוגנת נפתחה',
  'device.registered': 'מכשיר נרשם',
  'device.approved': 'מכשיר אושר',
  'device.revoked': 'אישור מכשיר בוטל',
  'device.login_blocked': 'כניסת מכשיר נחסמה',
  'restriction.created': 'הגבלת צפייה נוצרה',
  'restriction.updated': 'הגבלת צפייה עודכנה',
  'restriction.revoked': 'הגבלת צפייה בוטלה',
  'share.created': 'קישור צפייה נוצר',
  'share.revoked': 'קישור צפייה בוטל',
  'share.opened': 'קישור צפייה נפתח',
  'share.otp_sent': 'נשלח קוד לקישור צפייה',
  'share.session.approved': 'צפייה בקישור אושרה',
  'watermark.created': 'סימן מים נוצר',
  'watermark.updated': 'סימן מים עודכן',
  'watermark.enabled': 'סימן מים הופעל',
  'watermark.disabled': 'סימן מים כובה',
  'watermark.logo': 'לוגו סימן מים עודכן',
  'watermark.deleted': 'סימן מים נמחק',
  'access.created': 'כלל הרשאה נוצר',
  'access.revoked': 'כלל הרשאה בוטל',
  'access.scoped_view': 'מצב צפייה מוגבלת שונה',
};
const TARGET_LABELS: Record<string, string> = {
  file: 'קובץ', folder: 'תיקייה', tag: 'תגית', collection: 'אוסף', import: 'ייבוא', user: 'משתמש', device: 'מכשיר', access: 'הרשאה', disk: 'דיסק', link: 'קישור',
};

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  async query(opts: { targetType?: string; targetId?: string; userId?: string; action?: string; page?: number; pageSize?: number }) {
    const where: any = {};
    if (opts.targetType) where.targetType = opts.targetType;
    if (opts.targetId) where.targetId = opts.targetId;
    if (opts.userId) where.userId = opts.userId;
    if (opts.action) where.action = opts.action;

    const pageSize = Math.min(Math.max(Number(opts.pageSize) || 50, 1), 200);
    const page = Math.max(Number(opts.page) || 1, 1);
    const skip = (page - 1) * pageSize;

    const [total, events] = await this.prisma.$transaction([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    ]);

    // שמות מבצעי הפעולות (שליפה אחת מרוכזת).
    const userIds = Array.from(new Set(events.map((e) => e.userId).filter(Boolean))) as string[];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    return {
      items: events.map((e) => {
        const u = e.userId ? byId.get(e.userId) : null;
        return {
          id: e.id,
          action: e.action,
          actionLabel: ACTION_LABELS[e.action] ?? e.action,
          targetType: e.targetType,
          targetTypeLabel: e.targetType ? (TARGET_LABELS[e.targetType] ?? e.targetType) : null,
          targetId: e.targetId,
          actorName: u ? (u.name ?? u.email) : (e.userId ? 'משתמש' : 'מערכת'),
          details: e.details ?? null,
          createdAt: e.createdAt,
        };
      }),
      total, page, pageSize, pages: Math.max(Math.ceil(total / pageSize), 1),
    };
  }
}

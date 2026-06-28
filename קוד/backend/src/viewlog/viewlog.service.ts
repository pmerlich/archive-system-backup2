// viewlog.service.ts — לוג צפיות מלא (שלב 3.6). קריאה בלבד — לעולם לא יוצרים/משנים/מוחקים רשומות צפייה כאן.
// מאחד שני מקורות אמת קיימים: ViewSession (צפייה מוגנת פנימית, 3.1) ו-ShareSession (פתיחת קישור חיצוני, 3.5),
// עם מטא-דאטה של ShareLink (מי יצר / למי נשלח / תנאים). מציג לכל צפייה: הקובץ, מי צפה, מתי נפתח, IP ומכשיר,
// כמה זמן נצפה, מספר הבקשות, והאם פעיל / פג / בוטל / חסום. אין כאן שום נתיב כתיבה (אין זיוף/מחיקה).
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// כמה רשומות נמשכות מכל מקור למיזוג בזיכרון (קנה-מידה פרטי — מספר ההפעלות מתון).
// בקנה-מידה ענק יוחלף בעימוד חוצה-טבלאות; תועד ב-archive-hardening-backlog.
const MERGE_CAP = 4000;

type Status = 'active' | 'expired' | 'revoked' | 'pending';
const STATUS_LABELS: Record<Status, string> = {
  active: 'פעילה',
  expired: 'פג תוקף',
  revoked: 'בוטלה',
  pending: 'ממתינה לאישור',
};

@Injectable()
export class ViewlogService {
  constructor(private readonly prisma: PrismaService) {}

  // משך הצפייה (שניות) — מרגע הפתיחה ועד הבקשה האחרונה שהוגשה בהפעלה. 0 אם לא הוגשה אף בקשה.
  private durationSeconds(createdAt: Date, lastUsedAt: Date | null): number {
    if (!lastUsedAt) return 0;
    const ms = lastUsedAt.getTime() - createdAt.getTime();
    return ms > 0 ? Math.round(ms / 1000) : 0;
  }

  private fmtUser(u?: { name: string | null; email: string } | null): string | null {
    if (!u) return null;
    return u.name ?? u.email;
  }

  // ── הלוג המאוחד של הפעלות צפייה (פנימיות + קישורים) ──
  async sessions(opts: {
    fileId?: string;
    userId?: string; // צופה פנימי
    linkId?: string;
    kind?: 'internal' | 'share';
    page?: number;
    pageSize?: number;
  }) {
    const now = Date.now();
    const pageSize = Math.min(Math.max(Number(opts.pageSize) || 50, 1), 200);
    const page = Math.max(Number(opts.page) || 1, 1);

    // אילו מקורות רלוונטיים לפי הסינון.
    const wantInternal = opts.kind !== 'share' && !opts.linkId;
    const wantShare = opts.kind !== 'internal' && !opts.userId;

    // שליפת ViewSession (צפייה פנימית).
    const internalWhere: any = {};
    if (opts.fileId) internalWhere.fileId = opts.fileId;
    if (opts.userId) internalWhere.userId = opts.userId;
    const internalRows = wantInternal
      ? await this.prisma.viewSession.findMany({ where: internalWhere, orderBy: { createdAt: 'desc' }, take: MERGE_CAP })
      : [];

    // שליפת ShareSession (קישור חיצוני).
    const shareWhere: any = {};
    if (opts.fileId) shareWhere.fileId = opts.fileId;
    if (opts.linkId) shareWhere.linkId = opts.linkId;
    const shareRows = wantShare
      ? await this.prisma.shareSession.findMany({ where: shareWhere, orderBy: { createdAt: 'desc' }, take: MERGE_CAP })
      : [];

    // שליפות מרוכזות לשמות: קבצים, משתמשים (צופים + יוצרי קישורים), וקישורים.
    const fileIds = new Set<string>();
    const userIds = new Set<string>();
    const linkIds = new Set<string>();
    for (const r of internalRows) { fileIds.add(r.fileId); userIds.add(r.userId); }
    for (const r of shareRows) { fileIds.add(r.fileId); linkIds.add(r.linkId); }

    const links = linkIds.size
      ? await this.prisma.shareLink.findMany({ where: { id: { in: [...linkIds] } }, select: { id: true, fileId: true, label: true, email: true, requireOtp: true, requireApproval: true, active: true, revokedAt: true, createdById: true } })
      : [];
    for (const l of links) { fileIds.add(l.fileId); if (l.createdById) userIds.add(l.createdById); }
    const linkById = new Map(links.map((l) => [l.id, l]));

    const [files, users] = await Promise.all([
      fileIds.size ? this.prisma.file.findMany({ where: { id: { in: [...fileIds] } }, select: { id: true, name: true } }) : Promise.resolve([]),
      userIds.size ? this.prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
    ]);
    const fileById = new Map(files.map((f) => [f.id, f]));
    const userById = new Map(users.map((u) => [u.id, u]));

    // מיפוי הפעלה פנימית → רשומת לוג.
    const internalItems = internalRows.map((r) => {
      let status: Status = 'active';
      if (r.revokedAt) status = 'revoked';
      else if (r.expiresAt && r.expiresAt.getTime() < now) status = 'expired';
      const viewer = userById.get(r.userId);
      return {
        id: r.id,
        kind: 'internal' as const,
        kindLabel: 'צפייה פנימית',
        fileId: r.fileId,
        fileName: fileById.get(r.fileId)?.name ?? '(קובץ נמחק)',
        contentKind: r.kind,
        viewerLabel: this.fmtUser(viewer) ?? 'משתמש',
        viewerType: 'user' as const,
        createdBy: null as string | null,
        sentTo: null as string | null,
        linkId: null as string | null,
        linkLabel: null as string | null,
        openedAt: r.createdAt,
        lastActivityAt: r.lastUsedAt,
        durationSeconds: this.durationSeconds(r.createdAt, r.lastUsedAt),
        ip: r.ip ?? null,
        userAgent: r.userAgent ?? null,
        country: null as string | null,
        viewCount: r.viewCount,
        status,
        statusLabel: STATUS_LABELS[status],
      };
    });

    // מיפוי הפעלת קישור → רשומת לוג.
    const shareItems = shareRows.map((r) => {
      const link = linkById.get(r.linkId);
      let status: Status = 'active';
      if (r.revokedAt || (link && (!link.active || link.revokedAt))) status = 'revoked';
      else if (r.expiresAt && r.expiresAt.getTime() < now) status = 'expired';
      else if (link && ((link.requireApproval && !r.approved) || (link.requireOtp && !r.verified))) status = 'pending';
      const creator = link?.createdById ? userById.get(link.createdById) : null;
      return {
        id: r.id,
        kind: 'share' as const,
        kindLabel: 'קישור חיצוני',
        fileId: r.fileId,
        fileName: fileById.get(r.fileId)?.name ?? '(קובץ נמחק)',
        contentKind: null as string | null,
        viewerLabel: r.email ?? 'אורח',
        viewerType: 'guest' as const,
        createdBy: this.fmtUser(creator),
        sentTo: link?.email ?? null,
        linkId: r.linkId,
        linkLabel: link?.label ?? null,
        openedAt: r.createdAt,
        lastActivityAt: r.lastUsedAt,
        durationSeconds: this.durationSeconds(r.createdAt, r.lastUsedAt),
        ip: r.ip ?? null,
        userAgent: r.userAgent ?? null,
        country: r.country ?? null,
        viewCount: r.viewCount,
        status,
        statusLabel: STATUS_LABELS[status],
      };
    });

    // מיזוג, מיון מהחדש לישן, ועימוד בזיכרון.
    const merged = [...internalItems, ...shareItems].sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
    const total = merged.length;
    const start = (page - 1) * pageSize;
    const items = merged.slice(start, start + pageSize);

    return { items, total, page, pageSize, pages: Math.max(Math.ceil(total / pageSize), 1) };
  }

  // ── סיכום לכל קישור צפייה: מי יצר, למי נשלח, תנאים, מספר פתיחות, וסטטוס ──
  async links(opts: { fileId?: string; page?: number; pageSize?: number }) {
    const now = Date.now();
    const pageSize = Math.min(Math.max(Number(opts.pageSize) || 50, 1), 200);
    const page = Math.max(Number(opts.page) || 1, 1);
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (opts.fileId) where.fileId = opts.fileId;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.shareLink.count({ where }),
      this.prisma.shareLink.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize, select: { id: true, fileId: true, label: true, email: true, requireOtp: true, requireApproval: true, maxViews: true, viewsUsed: true, expiresAt: true, singleDevice: true, ipBlock: true, israelOnly: true, watermark: true, allowDownload: true, active: true, revokedAt: true, createdById: true, createdAt: true } }),
    ]);

    // שמות: קבצים, יוצרים, ומספר הפעלות + פתיחה אחרונה לכל קישור.
    const fileIds = [...new Set(rows.map((l) => l.fileId))];
    const userIds = [...new Set(rows.map((l) => l.createdById).filter(Boolean))] as string[];
    const linkIds = rows.map((l) => l.id);

    const [files, users, grouped] = await Promise.all([
      fileIds.length ? this.prisma.file.findMany({ where: { id: { in: fileIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
      linkIds.length ? this.prisma.shareSession.groupBy({ by: ['linkId'], where: { linkId: { in: linkIds } }, _count: { _all: true }, _max: { createdAt: true } }) : Promise.resolve([] as any[]),
    ]);
    const fileById = new Map(files.map((f) => [f.id, f]));
    const userById = new Map(users.map((u) => [u.id, u]));
    const sessByLink = new Map<string, { count: number; last: Date | null }>(
      (grouped as any[]).map((g) => [g.linkId, { count: g._count._all, last: g._max.createdAt ?? null }]),
    );

    const items = rows.map((l) => {
      let status: Status = 'active';
      if (!l.active || l.revokedAt) status = 'revoked';
      else if (l.expiresAt && l.expiresAt.getTime() < now) status = 'expired';
      const creator = l.createdById ? userById.get(l.createdById) : null;
      const sess = sessByLink.get(l.id) ?? { count: 0, last: null };
      // תקציר התנאים בעברית.
      const conds: string[] = [];
      if (l.email) conds.push('מייל מסוים');
      if (l.requireOtp) conds.push('קוד חד-פעמי');
      if (l.requireApproval) conds.push('אישור ידני');
      if (l.maxViews != null) conds.push(`עד ${l.maxViews} צפיות`);
      if (l.expiresAt) conds.push('תפוגה');
      if (l.singleDevice) conds.push('מכשיר אחד');
      if (l.ipBlock) conds.push('חסימת IP');
      if (l.israelOnly) conds.push('ישראל בלבד');
      return {
        id: l.id,
        fileId: l.fileId,
        fileName: fileById.get(l.fileId)?.name ?? '(קובץ נמחק)',
        label: l.label ?? null,
        createdBy: this.fmtUser(creator),
        sentTo: l.email ?? null,
        conditions: conds,
        watermark: l.watermark,
        allowDownload: l.allowDownload,
        maxViews: l.maxViews ?? null,
        viewsUsed: l.viewsUsed,
        opensCount: sess.count,
        lastOpenedAt: sess.last,
        status,
        statusLabel: STATUS_LABELS[status],
        createdAt: l.createdAt,
        revokedAt: l.revokedAt,
      };
    });

    return { items, total, page, pageSize, pages: Math.max(Math.ceil(total / pageSize), 1) };
  }
}

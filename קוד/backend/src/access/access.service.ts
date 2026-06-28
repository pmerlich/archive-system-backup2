// access.service.ts — כללי הרשאות גישה גמישים (שלב 3.9): הגבלה (restrict) והענקה (grant) לפי טווח.
// טווח = תיקיות/תגיות/קבצים (OR) + מסנני סוג/רגישות (AND) — דרך ScopeService המשותף.
// GRANT: המשתמשים ב-userIds רשאים לצפות בטווח (רלוונטי במיוחד למשתמש "מוגבל-טווח" scopedView).
// RESTRICT: צפייה בטווח חסומה אלא אם מתקיים תנאי (מכשיר/זמן); userIds ריק = חל על כולם. בעלים עוקף הכול.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../scope/scope.service';

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  private scopeOf(r: any) {
    return { folderIds: r.folderIds, tagIds: r.tagIds, fileIds: r.fileIds, mimeTypes: r.mimeTypes, sensitivities: r.sensitivities, includeSubfolders: r.includeSubfolders, includeSubtags: r.includeSubtags };
  }

  // ───────── אכיפה ─────────

  // תנאי Prisma לסינון רשימת קבצים למה שהמשתמש רשאי לראות. null = ללא הגבלה (רואה הכול).
  async visibilityWhere(userId?: string): Promise<any | null> {
    if (!userId) return null;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (!user) return { id: '__none__' };
    if (user.role?.isOwner || !user.scopedView) return null; // בעלים/משתמש רגיל — רואה הכול
    const grants = await this.activeGrants(userId);
    if (!grants.length) return { id: '__none__' }; // מוגבל-טווח ללא הענקה → לא רואה כלום
    return this.scope.fileWhereForScopes(grants.map((g) => this.scopeOf(g))); // null = הענקה גלובלית
  }

  // זורק 403 אם המשתמש אינו רשאי לצפות בקובץ (הענקה למוגבלי-טווח + הגבלות לכולם). owner עוקף.
  async assertCanView(userId: string, fileId: string, auth?: { device?: string }) {
    const [user, ctx] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, include: { role: true } }),
      this.scope.fileContext(fileId),
    ]);
    if (!ctx) return; // קובץ חסר — מטופל במקום אחר
    if (user?.role?.isOwner) return;
    if (user?.scopedView) {
      const grants = await this.activeGrants(userId, auth);
      if (!grants.some((g) => this.scope.matches(this.scopeOf(g), ctx))) {
        throw new ForbiddenException('אין לך הרשאת צפייה בקובץ זה');
      }
    }
    const restricts = await this.prisma.accessRule.findMany({ where: { type: 'restrict', active: true } });
    for (const r of restricts) {
      if (!this.scope.matches(this.scopeOf(r), ctx)) continue;
      if (r.userIds.length && !r.userIds.includes(userId)) continue; // ההגבלה מכוונת לאחרים
      if (!(await this.restrictSatisfied(r, auth))) throw new ForbiddenException(this.restrictReason(r));
    }
  }

  private async restrictSatisfied(r: any, auth?: { device?: string }): Promise<boolean> {
    if (!r.deviceId && !r.expiresAt) return false; // הגבלה ללא תנאי = חסימה מלאה
    if (r.expiresAt && new Date(r.expiresAt).getTime() < Date.now()) return false;
    if (r.deviceId) {
      if (r.deviceId !== auth?.device) return false;
      // אימות מול ה-DB שהמכשיר עדיין מאושר ולא בוטל (ביטול מכשיר תופס מיד) — כמו ב-3.3.
      const ok = await this.prisma.device.findFirst({ where: { deviceId: r.deviceId, approved: true, revokedAt: null } });
      if (!ok) return false;
    }
    return true;
  }
  private restrictReason(r: any): string {
    if (r.expiresAt && new Date(r.expiresAt).getTime() < Date.now()) return 'הגישה לתוכן זה פגה';
    if (r.deviceId) return 'צפייה בתוכן זה מוגבלת למכשיר מאושר מסוים';
    return 'הגישה לתוכן זה חסומה';
  }
  private async activeGrants(userId: string, auth?: { device?: string }) {
    const now = Date.now();
    const grants = await this.prisma.accessRule.findMany({ where: { type: 'grant', active: true, userIds: { has: userId } } });
    const out: any[] = [];
    for (const g of grants) {
      if (g.expiresAt && new Date(g.expiresAt).getTime() <= now) continue;
      if (g.deviceId && auth) { // בנתיב הצפייה — אימות מכשיר מול ה-DB (מאושר ולא בוטל)
        if (g.deviceId !== auth.device) continue;
        const ok = await this.prisma.device.findFirst({ where: { deviceId: g.deviceId, approved: true, revokedAt: null } });
        if (!ok) continue;
      }
      out.push(g);
    }
    return out;
  }

  // ───────── ניהול (security.manage) ─────────

  async listAll() {
    const rows = await this.prisma.accessRule.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] });
    return this.enrich(rows);
  }

  async create(actorId: string, input: any) {
    const type = input?.type === 'grant' ? 'grant' : input?.type === 'restrict' ? 'restrict' : null;
    if (!type) throw new BadRequestException('סוג הכלל חייב להיות "הענקה" או "הגבלה"');
    const sc = this.scope.sanitize(input);
    const userIds = Array.isArray(input.userIds) ? [...new Set(input.userIds.filter((x: any) => typeof x === 'string' && x))].slice(0, 500) as string[] : [];
    if (type === 'grant' && userIds.length === 0) throw new BadRequestException('כלל הענקה חייב לכוון לפחות למשתמש אחד');
    if (type === 'grant' && this.scope.isEmpty(sc)) throw new BadRequestException('כלל הענקה חייב לכלול לפחות תיקייה / תגית / קובץ');
    if (type === 'restrict' && this.scope.isEmpty(sc)) throw new BadRequestException('כלל הגבלה חייב לכלול טווח (תיקייה / תגית / סוג / רגישות)');
    let expiresAt: Date | null = null;
    if (input.expiresAt) { const d = new Date(input.expiresAt); if (isNaN(d.getTime()) || d.getTime() <= Date.now()) throw new BadRequestException('תאריך תפוגה לא תקין'); expiresAt = d; }
    let deviceId: string | null = null;
    if (input.deviceId) { const dev = await this.prisma.device.findFirst({ where: { deviceId: input.deviceId, approved: true, revokedAt: null } }); if (!dev) throw new BadRequestException('המכשיר שנבחר אינו מאושר'); deviceId = dev.deviceId; }
    const r = await this.prisma.accessRule.create({ data: { type, label: input.label ? String(input.label).slice(0, 120) : null, ...sc, userIds, deviceId, expiresAt, note: input.note ? String(input.note).slice(0, 300) : null, createdById: actorId } });
    await this.audit('access.created', actorId, r.id, { type });
    return (await this.enrich([r]))[0];
  }

  async revoke(actorId: string, id: string) {
    const r = await this.prisma.accessRule.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('הכלל לא נמצא');
    const u = await this.prisma.accessRule.update({ where: { id }, data: { active: false, revokedAt: new Date(), revokedById: actorId } });
    await this.audit('access.revoked', actorId, id, {});
    return (await this.enrich([u]))[0];
  }

  async setScopedView(actorId: string, userId: string, scopedView: boolean) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundException('המשתמש לא נמצא');
    const upd = await this.prisma.user.update({ where: { id: userId }, data: { scopedView: !!scopedView } });
    await this.audit('access.scoped_view', actorId, userId, { scopedView: !!scopedView });
    return { id: upd.id, scopedView: upd.scopedView };
  }

  async meta() {
    const [users, devices] = await Promise.all([
      this.prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, name: true, email: true, scopedView: true }, orderBy: { name: 'asc' } }),
      this.prisma.device.findMany({ where: { approved: true, revokedAt: null } }),
    ]);
    const uMap = new Map(users.map((u) => [u.id, u]));
    return { users, devices: devices.map((d) => ({ deviceId: d.deviceId, name: d.name, user: uMap.get(d.userId) ?? null })) };
  }

  private async enrich(rows: any[]) {
    const uids = [...new Set(rows.flatMap((r) => r.userIds))];
    const fids = [...new Set(rows.flatMap((r) => r.folderIds))];
    const tids = [...new Set(rows.flatMap((r) => r.tagIds))];
    const [users, folders, tags] = await Promise.all([
      uids.length ? this.prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true, email: true } }) : [],
      fids.length ? this.prisma.folder.findMany({ where: { id: { in: fids } }, select: { id: true, name: true } }) : [],
      tids.length ? this.prisma.tag.findMany({ where: { id: { in: tids } }, select: { id: true, name: true } }) : [],
    ]);
    const uMap = new Map(users.map((u) => [u.id, u])), fMap = new Map(folders.map((f) => [f.id, f.name])), tMap = new Map(tags.map((t) => [t.id, t.name]));
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id, type: r.type, label: r.label,
      folderIds: r.folderIds, tagIds: r.tagIds, fileIds: r.fileIds, mimeTypes: r.mimeTypes, sensitivities: r.sensitivities,
      includeSubfolders: r.includeSubfolders, includeSubtags: r.includeSubtags,
      folderNames: r.folderIds.map((id: string) => fMap.get(id) ?? id), tagNames: r.tagIds.map((id: string) => tMap.get(id) ?? id), fileCount: r.fileIds.length,
      users: r.userIds.map((id: string) => uMap.get(id)).filter(Boolean),
      deviceId: r.deviceId, expiresAt: r.expiresAt, active: r.active, note: r.note, createdAt: r.createdAt, revokedAt: r.revokedAt,
      state: !r.active || r.revokedAt ? 'revoked' : r.expiresAt && new Date(r.expiresAt).getTime() < now ? 'expired' : 'active',
    }));
  }

  private async audit(action: string, userId: string, targetId: string, details: any) {
    await this.prisma.auditEvent.create({ data: { action, userId, targetType: 'access', targetId, details } });
  }
}

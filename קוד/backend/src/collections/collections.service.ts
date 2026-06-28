// collections.service.ts — אוספים חכמים (שלב 2.3). אוסף = שם + תנאי סינון (FileQuery) השמורים כ-JSON.
// עיקרון: שומרים תנאים בלבד, אף פעם לא קבצים → פתיחת אוסף מריצה את אותו חיפוש מסונן על המאגר העדכני,
// ולכן התוצאות תמיד מעודכנות, וההרשאות נאכפות (כי הפתיחה עוברת דרך GET /files המוגן).
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// המפתחות המותרים בתנאי הסינון — שומרים רק אותם (לא מאחסנים זבל/שדות לא מוכרים).
const FILTER_KEYS = [
  'q', 'folderId', 'tagId', 'withSub', 'tagIds', 'excludeTagIds', 'mimeTypes', 'ext',
  'sizeMin', 'sizeMax', 'createdFrom', 'createdTo', 'uploadedById', 'source', 'duplicate', 'backedUp', 'sort', 'order',
];

@Injectable()
export class CollectionsService {
  constructor(private readonly prisma: PrismaService) {}

  // מסנן את אובייקט התנאים לשדות מוכרים בלבד, ומשמיט ריקים.
  private sanitize(filters: any): any {
    const out: any = {};
    if (filters && typeof filters === 'object') {
      for (const k of FILTER_KEYS) {
        const v = filters[k];
        if (v === undefined || v === null || v === '') continue;
        if (Array.isArray(v) && v.length === 0) continue;
        out[k] = v;
      }
    }
    return out;
  }

  // רשימת כל האוספים (לא מחוקים) + שם היוצר. נגיש לכל מי שמורשה לצפות בקבצים.
  async list() {
    const rows = await this.prisma.smartCollection.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
    const ids = [...new Set(rows.map((r) => r.createdById).filter(Boolean))] as string[];
    const users = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      filters: r.filters,
      createdById: r.createdById,
      createdByName: r.createdById ? nameById.get(r.createdById) ?? 'משתמש' : null,
      createdAt: r.createdAt,
    }));
  }

  async get(id: string) {
    const c = await this.prisma.smartCollection.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundException('האוסף לא נמצא');
    return c;
  }

  async create(actorId: string, name: string, filters: any) {
    const nm = (name ?? '').trim();
    if (!nm) throw new BadRequestException('יש לתת שם לאוסף');
    const c = await this.prisma.smartCollection.create({
      data: { name: nm, filters: this.sanitize(filters), createdById: actorId },
    });
    await this.audit('collection.created', actorId, c.id, { name: nm });
    return c;
  }

  async update(actorId: string, id: string, data: { name?: string; filters?: any }) {
    const c = await this.get(id);
    await this.ensureCanManage(actorId, c);
    const patch: any = {};
    if (data.name !== undefined) {
      const nm = (data.name ?? '').trim();
      if (!nm) throw new BadRequestException('שם לא חוקי');
      patch.name = nm;
    }
    if (data.filters !== undefined) patch.filters = this.sanitize(data.filters);
    const updated = await this.prisma.smartCollection.update({ where: { id }, data: patch });
    await this.audit('collection.updated', actorId, id, { name: updated.name });
    return updated;
  }

  async remove(actorId: string, id: string) {
    const c = await this.get(id);
    await this.ensureCanManage(actorId, c);
    await this.prisma.smartCollection.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit('collection.deleted', actorId, id, { name: c.name });
    return { id, deleted: true };
  }

  // רק יוצר האוסף — או הבעלים — רשאי לערוך/למחוק.
  private async ensureCanManage(actorId: string, c: { createdById: string | null }) {
    if (c.createdById && c.createdById === actorId) return;
    const u = await this.prisma.user.findUnique({ where: { id: actorId }, include: { role: true } });
    if (u?.role?.isOwner) return;
    throw new ForbiddenException('רק יוצר האוסף או הבעלים יכולים לערוך או למחוק אותו');
  }

  private async audit(action: string, userId: string, targetId: string, details: any) {
    await this.prisma.auditEvent.create({ data: { action, userId, targetType: 'collection', targetId, details } });
  }
}

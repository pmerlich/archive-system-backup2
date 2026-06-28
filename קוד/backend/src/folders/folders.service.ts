// folders.service.ts — ניהול תיקיות: עץ (תיקיות ותת-תיקיות), יצירה, שינוי שם, העברה,
// מחיקה רכה ושחזור. עקרונות: לא מוחקים באמת (deletedAt), וכל פעולה נרשמת בלוג.
// הגנת מעגל: אי אפשר להעביר תיקייה לתוך עצמה או לתוך אחת מתת-התיקיות שלה.
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateFolderDto } from './dto/update-folder.dto';

@Injectable()
export class FoldersService {
  constructor(private readonly prisma: PrismaService) {}

  // עץ התיקיות הפעילות (לא מחוקות), כרשימת שורשים עם children מקוננים.
  async listTree() {
    const folders = await this.prisma.folder.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, parentId: true, createdAt: true },
    });
    type Node = (typeof folders)[number] & { children: Node[] };
    const byId = new Map<string, Node>();
    folders.forEach((f) => byId.set(f.id, { ...f, children: [] }));
    const roots: Node[] = [];
    byId.forEach((node) => {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node); // שורש, או שאביו מחוק
    });
    return roots;
  }

  // רשימת התיקיות שבסל המחזור (מחוקות) — להצגה ושחזור.
  async listDeleted() {
    return this.prisma.folder.findMany({
      where: { NOT: { deletedAt: null } },
      orderBy: { deletedAt: 'desc' },
      select: { id: true, name: true, parentId: true, deletedAt: true },
    });
  }

  async create(actorId: string, name: string, parentId: string | null) {
    if (parentId) {
      const parent = await this.prisma.folder.findFirst({ where: { id: parentId, deletedAt: null } });
      if (!parent) throw new BadRequestException('תיקיית האב לא נמצאה');
    }
    const folder = await this.prisma.folder.create({ data: { name, parentId: parentId ?? null } });
    await this.audit('folder.created', actorId, folder.id, { name, parentId: parentId ?? null });
    return folder;
  }

  // שינוי שם ו/או העברה. שולחים name לשינוי שם, parentId (כולל null=לשורש) להעברה.
  async update(actorId: string, id: string, dto: UpdateFolderDto) {
    const folder = await this.prisma.folder.findFirst({ where: { id, deletedAt: null } });
    if (!folder) throw new NotFoundException('התיקייה לא נמצאה');

    const data: { name?: string; parentId?: string | null } = {};
    const events: Array<[string, Record<string, unknown>]> = [];

    if (dto.name !== undefined && dto.name !== folder.name) {
      data.name = dto.name;
      events.push(['folder.renamed', { from: folder.name, to: dto.name }]);
    }

    if (dto.parentId !== undefined && dto.parentId !== folder.parentId) {
      const newParentId = dto.parentId; // יכול להיות null = העברה לשורש
      if (newParentId) {
        if (newParentId === id) throw new BadRequestException('אי אפשר להעביר תיקייה לתוך עצמה');
        const parent = await this.prisma.folder.findFirst({ where: { id: newParentId, deletedAt: null } });
        if (!parent) throw new BadRequestException('תיקיית היעד לא נמצאה');
        if (await this.isAncestor(id, newParentId)) {
          throw new BadRequestException('אי אפשר להעביר תיקייה לתוך תת-תיקייה של עצמה');
        }
      }
      data.parentId = newParentId;
      events.push(['folder.moved', { from: folder.parentId, to: newParentId }]);
    }

    if (Object.keys(data).length === 0) return folder; // אין שינוי בפועל

    const updated = await this.prisma.folder.update({ where: { id }, data });
    for (const [action, details] of events) await this.audit(action, actorId, id, details);
    return updated;
  }

  // מחיקה רכה. כדי להימנע מתת-תיקיות "יתומות" — חוסמים מחיקה אם יש תת-תיקיות פעילות.
  async softDelete(actorId: string, id: string) {
    const folder = await this.prisma.folder.findFirst({ where: { id, deletedAt: null } });
    if (!folder) throw new NotFoundException('התיקייה לא נמצאה');
    const children = await this.prisma.folder.count({ where: { parentId: id, deletedAt: null } });
    if (children > 0) throw new BadRequestException('יש קודם להעביר או למחוק את תת-התיקיות');
    await this.prisma.folder.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit('folder.deleted', actorId, id, { name: folder.name });
    return { id, deleted: true };
  }

  // שחזור מסל המחזור. אם האב מחוק — מחזירים לשורש כדי לא להישאר תחת אב מחוק.
  async restore(actorId: string, id: string) {
    const folder = await this.prisma.folder.findFirst({ where: { id, NOT: { deletedAt: null } } });
    if (!folder) throw new NotFoundException('התיקייה לא נמצאה בסל המחזור');
    let parentId = folder.parentId;
    if (parentId) {
      const parent = await this.prisma.folder.findFirst({ where: { id: parentId, deletedAt: null } });
      if (!parent) parentId = null;
    }
    const updated = await this.prisma.folder.update({ where: { id }, data: { deletedAt: null, parentId } });
    await this.audit('folder.restored', actorId, id, { name: folder.name });
    return updated;
  }

  // האם ancestorId הוא אב-קדמון של nodeId? מטפסים כלפי מעלה מ-nodeId.
  private async isAncestor(ancestorId: string, nodeId: string): Promise<boolean> {
    const seen = new Set<string>();
    let current = await this.prisma.folder.findUnique({ where: { id: nodeId }, select: { parentId: true } });
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      if (seen.has(current.parentId)) break; // הגנה מפני לולאה קיימת
      seen.add(current.parentId);
      current = await this.prisma.folder.findUnique({ where: { id: current.parentId }, select: { parentId: true } });
    }
    return false;
  }

  // details הוא JSON חופשי (Prisma Json) — מקבל any כדי לאפשר ערכי null (כמו parentId).
  private async audit(action: string, userId: string, targetId: string, details: any) {
    await this.prisma.auditEvent.create({
      data: { action, userId, targetType: 'folder', targetId, details },
    });
  }
}

// tags.service.ts — ניהול תגיות היררכיות (כמו תיקיות): כל תגית יכולה להיות תת-תגית של אחרת,
// ללא הגבלת עומק. הייחודיות לפי (אב, שם). תומך בעץ, בהעברת תת-עץ עם הגנת מעגל, ובחישוב צאצאים.
// שומר על השדות הקיימים (סוג, רמת רגישות) ועל התיעוד בלוג.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Sensitivity, Tag } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  private summary(t: Tag) {
    return { id: t.id, name: t.name, parentId: t.parentId, type: t.type, sensitivity: t.sensitivity };
  }

  // רשימה שטוחה (לתאימות לאחור / שימושים פשוטים), עם מספר הקבצים לכל תגית.
  async list() {
    const tags = await this.prisma.tag.findMany({
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { files: true } } },
    });
    const paths = await this.pathMap();
    return tags.map((t) => ({
      id: t.id, name: t.name, path: paths.get(t.id) ?? t.name, parentId: t.parentId,
      type: t.type, sensitivity: t.sensitivity, usage: t._count.files,
    }));
  }

  // עץ התגיות — רשימת שורשים עם children מקוננים, כולל סוג/רגישות/שימוש.
  async listTree() {
    const tags = await this.prisma.tag.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { files: true } } },
    });
    type Node = {
      id: string; name: string; parentId: string | null; type: string;
      sensitivity: Sensitivity; usage: number; children: Node[];
    };
    const byId = new Map<string, Node>();
    tags.forEach((t) =>
      byId.set(t.id, {
        id: t.id, name: t.name, parentId: t.parentId, type: t.type,
        sensitivity: t.sensitivity, usage: t._count.files, children: [],
      }),
    );
    const roots: Node[] = [];
    byId.forEach((node) => {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node); // שורש, או שאביו נמחק
    });
    return roots;
  }

  async create(actorId: string, dto: CreateTagDto) {
    const parentId = dto.parentId ?? null;
    if (parentId) {
      const parent = await this.prisma.tag.findUnique({ where: { id: parentId } });
      if (!parent) throw new BadRequestException('תגית האב לא נמצאה');
    }
    await this.assertNameFree(parentId, dto.name);
    try {
      const tag = await this.prisma.tag.create({
        data: {
          name: dto.name,
          parentId,
          type: dto.type ?? 'regular',
          sensitivity: (dto.sensitivity as Sensitivity) ?? 'NONE',
        },
      });
      await this.audit('tag.created', actorId, tag.id, {
        name: tag.name, parentId, type: tag.type, sensitivity: tag.sensitivity,
      });
      return this.summary(tag);
    } catch (e) {
      throw this.handle(e);
    }
  }

  // עדכון: שם / סוג / רגישות, ו/או העברה לתגית-אב אחרת (עם הגנת מעגל).
  async update(actorId: string, id: string, dto: UpdateTagDto) {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('התגית לא נמצאה');

    const data: { name?: string; type?: string; sensitivity?: Sensitivity; parentId?: string | null } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.sensitivity !== undefined) data.sensitivity = dto.sensitivity as Sensitivity;

    let moved = false;
    if (dto.parentId !== undefined && (dto.parentId ?? null) !== tag.parentId) {
      const newParentId = dto.parentId ?? null;
      if (newParentId) {
        if (newParentId === id) throw new BadRequestException('אי אפשר להפוך תגית לתת-תגית של עצמה');
        const parent = await this.prisma.tag.findUnique({ where: { id: newParentId } });
        if (!parent) throw new BadRequestException('תגית היעד לא נמצאה');
        if (await this.isAncestor(id, newParentId)) {
          throw new BadRequestException('אי אפשר להעביר תגית לתוך תת-תגית של עצמה');
        }
      }
      data.parentId = newParentId;
      moved = true;
    }

    if (Object.keys(data).length === 0) return this.summary(tag);

    // ייחודיות שם תחת האב הסופי
    if (data.name !== undefined || moved) {
      const finalName = data.name ?? tag.name;
      const finalParent = data.parentId !== undefined ? data.parentId : tag.parentId;
      await this.assertNameFree(finalParent, finalName, id);
    }

    try {
      const updated = await this.prisma.tag.update({ where: { id }, data });
      if (moved) {
        await this.audit('tag.moved', actorId, id, { from: tag.parentId, to: data.parentId });
      }
      if (data.name !== undefined || data.type !== undefined || data.sensitivity !== undefined) {
        await this.audit('tag.updated', actorId, id, {
          before: { name: tag.name, type: tag.type, sensitivity: tag.sensitivity },
          after: { name: data.name, type: data.type, sensitivity: data.sensitivity },
        });
      }
      return this.summary(updated);
    } catch (e) {
      throw this.handle(e);
    }
  }

  async remove(actorId: string, id: string) {
    const tag = await this.prisma.tag.findUnique({
      where: { id },
      include: { _count: { select: { files: true, children: true } } },
    });
    if (!tag) throw new NotFoundException('התגית לא נמצאה');
    if (tag._count.children > 0) throw new BadRequestException('יש קודם להעביר או למחוק את תת-התגיות');
    if (tag._count.files > 0) throw new BadRequestException('התגית בשימוש בקבצים — אי אפשר למחוק');
    await this.prisma.tag.delete({ where: { id } });
    await this.audit('tag.deleted', actorId, id, { name: tag.name });
    return { id, deleted: true };
  }

  // מזהי התגית + כל צאצאיה (לסינון קבצים "כולל תת-תגיות").
  async descendantIds(tagId: string): Promise<string[]> {
    const all = await this.prisma.tag.findMany({ select: { id: true, parentId: true } });
    const childrenOf = new Map<string, string[]>();
    all.forEach((t) => {
      if (t.parentId) {
        const a = childrenOf.get(t.parentId) ?? [];
        a.push(t.id);
        childrenOf.set(t.parentId, a);
      }
    });
    const result: string[] = [];
    const seen = new Set<string>();
    const stack = [tagId];
    while (stack.length) {
      const cur = stack.pop() as string;
      if (seen.has(cur)) continue;
      seen.add(cur);
      result.push(cur);
      for (const c of childrenOf.get(cur) ?? []) stack.push(c);
    }
    return result;
  }

  // מפת מזהה-תגית → נתיב מלא מהשורש: "אב / אב / תגית". להצגת ההקשר של תת-תגית.
  async pathMap(): Promise<Map<string, string>> {
    const all = await this.prisma.tag.findMany({ select: { id: true, name: true, parentId: true } });
    const byId = new Map(all.map((t) => [t.id, t]));
    const cache = new Map<string, string>();
    const build = (id: string, seen: Set<string>): string => {
      const cached = cache.get(id);
      if (cached !== undefined) return cached;
      const t = byId.get(id);
      if (!t) return '';
      if (seen.has(id)) return t.name; // הגנה מפני לולאה (לא אמור לקרות)
      seen.add(id);
      const p = t.parentId ? `${build(t.parentId, seen)} / ${t.name}` : t.name;
      cache.set(id, p);
      return p;
    };
    all.forEach((t) => build(t.id, new Set()));
    return cache;
  }

  // ───────── עזרי פנים ─────────

  // שם ייחודי תחת אותו אב. בודק גם תגיות שורש (שם null לא נתפס ע"י אילוץ ה-DB).
  private async assertNameFree(parentId: string | null, name: string, exceptId?: string) {
    const existing = await this.prisma.tag.findFirst({
      where: { parentId: parentId ?? null, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (existing) throw new ConflictException('כבר קיימת תגית בשם הזה תחת אותו אב');
  }

  // האם ancestorId הוא אב-קדמון של nodeId? מטפסים כלפי מעלה.
  private async isAncestor(ancestorId: string, nodeId: string): Promise<boolean> {
    const seen = new Set<string>();
    let current = await this.prisma.tag.findUnique({ where: { id: nodeId }, select: { parentId: true } });
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      if (seen.has(current.parentId)) break;
      seen.add(current.parentId);
      current = await this.prisma.tag.findUnique({ where: { id: current.parentId }, select: { parentId: true } });
    }
    return false;
  }

  private handle(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException('כבר קיימת תגית בשם הזה תחת אותו אב');
    }
    return e as Error;
  }

  private async audit(action: string, userId: string, targetId: string, details: any) {
    await this.prisma.auditEvent.create({
      data: { action, userId, targetType: 'tag', targetId, details },
    });
  }
}

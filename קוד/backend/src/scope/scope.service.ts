// scope.service.ts — תשתית משותפת: התאמת קובץ ל"טווח" (scope) לפי תיקיות / תגיות / סוג / רגישות.
// משמש גם את סימני המים הגמישים וגם את כללי ההרשאות. תומך בהכללת תת-תיקיות ותת-תגיות.
// סמנטיקה: "יעדים" = תיקיות או תגיות (OR ביניהן); "מסננים" = סוג(mime) ורגישות (AND, מצמצמים).
// טווח ריק לגמרי = חל על הכול (גלובלי).
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type Scope = {
  folderIds?: string[];
  tagIds?: string[];
  fileIds?: string[];
  mimeTypes?: string[];
  sensitivities?: string[];
  includeSubfolders?: boolean; // ברירת מחדל: true
  includeSubtags?: boolean; // ברירת מחדל: true
};

export type FileScopeContext = {
  fileId: string;
  folderId: string | null;
  folderChain: Set<string>; // התיקייה + כל האבות שלה
  directTags: Set<string>;
  tagChain: Set<string>; // התגיות + כל האבות שלהן
  mimeType: string | null;
  sensitivities: Set<string>;
};

@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  isEmpty(s?: Scope | null): boolean {
    return !s || !((s.folderIds?.length ?? 0) || (s.tagIds?.length ?? 0) || (s.fileIds?.length ?? 0) || (s.mimeTypes?.length ?? 0) || (s.sensitivities?.length ?? 0));
  }

  // מנקה/מנרמל אובייקט טווח שמגיע מהממשק (מערכים בלבד, בוליאנים).
  sanitize(raw: any): Scope {
    const arr = (v: any) => Array.isArray(v) ? [...new Set(v.filter((x: any) => typeof x === 'string' && x).map((x: string) => x))].slice(0, 500) : [];
    return {
      folderIds: arr(raw?.folderIds),
      tagIds: arr(raw?.tagIds),
      fileIds: arr(raw?.fileIds),
      mimeTypes: arr(raw?.mimeTypes),
      sensitivities: arr(raw?.sensitivities).filter((s: string) => ['NONE', 'LOW', 'MEDIUM', 'HIGH'].includes(s)),
      includeSubfolders: raw?.includeSubfolders !== false,
      includeSubtags: raw?.includeSubtags !== false,
    };
  }

  // ───────── התאמה לקובץ בודד ─────────

  async fileContext(fileId: string): Promise<FileScopeContext | null> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      select: { folderId: true, mimeType: true, tags: { select: { tagId: true, tag: { select: { sensitivity: true } } } } },
    });
    if (!file) return null;
    const [folderParents, tagParents] = await Promise.all([this.folderParentMap(), this.tagParentMap()]);
    const folderChain = new Set<string>();
    let f: string | null = file.folderId;
    while (f && !folderChain.has(f)) { folderChain.add(f); f = folderParents.get(f) ?? null; }
    const directTags = new Set(file.tags.map((t) => t.tagId));
    const tagChain = new Set<string>();
    for (const t of directTags) { let x: string | null = t; while (x && !tagChain.has(x)) { tagChain.add(x); x = tagParents.get(x) ?? null; } }
    const sensitivities = new Set(file.tags.map((t) => t.tag.sensitivity as string));
    return { fileId, folderId: file.folderId, folderChain, directTags, tagChain, mimeType: file.mimeType, sensitivities };
  }

  matches(scope: Scope | undefined | null, ctx: FileScopeContext): boolean {
    if (this.isEmpty(scope)) return true;
    const s = scope as Scope;
    const subF = s.includeSubfolders !== false, subT = s.includeSubtags !== false;
    const hasTargets = (s.folderIds?.length ?? 0) > 0 || (s.tagIds?.length ?? 0) > 0 || (s.fileIds?.length ?? 0) > 0;
    let targetOk = true;
    if (hasTargets) {
      const fSet = subF ? ctx.folderChain : new Set(ctx.folderId ? [ctx.folderId] : []);
      const tSet = subT ? ctx.tagChain : ctx.directTags;
      const folderOk = (s.folderIds?.length ?? 0) > 0 && (s.folderIds as string[]).some((id) => fSet.has(id));
      const tagOk = (s.tagIds?.length ?? 0) > 0 && (s.tagIds as string[]).some((id) => tSet.has(id));
      const fileOk = (s.fileIds?.length ?? 0) > 0 && (s.fileIds as string[]).includes(ctx.fileId);
      targetOk = folderOk || tagOk || fileOk; // OR בין תיקיות / תגיות / קבצים ספציפיים
    }
    let filterOk = true;
    if ((s.mimeTypes?.length ?? 0) > 0) filterOk = filterOk && !!ctx.mimeType && (s.mimeTypes as string[]).includes(ctx.mimeType);
    if ((s.sensitivities?.length ?? 0) > 0) filterOk = filterOk && (s.sensitivities as string[]).some((x) => ctx.sensitivities.has(x));
    return targetOk && filterOk;
  }

  // ───────── שאילתת רשימה: תנאי Prisma לקבצים שמתאימים לאחד מהטווחים ─────────

  async fileWhereForScopes(scopes: Scope[]): Promise<any | null> {
    const ors: any[] = [];
    for (const s of scopes) {
      if (this.isEmpty(s)) return null; // טווח גלובלי אחד → אין סינון (כל הקבצים)
      ors.push(await this.scopeWhere(s));
    }
    return ors.length ? { OR: ors } : { id: '__none__' };
  }

  private async scopeWhere(s: Scope): Promise<any> {
    const and: any[] = [];
    const hasTargets = (s.folderIds?.length ?? 0) > 0 || (s.tagIds?.length ?? 0) > 0 || (s.fileIds?.length ?? 0) > 0;
    if (hasTargets) {
      const targetOrs: any[] = [];
      if (s.folderIds?.length) {
        const ids = s.includeSubfolders !== false ? await this.expandFoldersDown(s.folderIds) : s.folderIds;
        targetOrs.push({ folderId: { in: ids } });
      }
      if (s.tagIds?.length) {
        const ids = s.includeSubtags !== false ? await this.expandTagsDown(s.tagIds) : s.tagIds;
        targetOrs.push({ tags: { some: { tagId: { in: ids } } } });
      }
      and.push(targetOrs.length === 1 ? targetOrs[0] : { OR: targetOrs });
    }
    if (s.mimeTypes?.length) and.push({ mimeType: { in: s.mimeTypes } });
    if (s.sensitivities?.length) and.push({ tags: { some: { tag: { sensitivity: { in: s.sensitivities } } } } });
    return and.length === 0 ? {} : and.length === 1 ? and[0] : { AND: and };
  }

  // ───────── עזרי עץ ─────────

  async expandFoldersDown(ids: string[]): Promise<string[]> {
    const all = await this.prisma.folder.findMany({ select: { id: true, parentId: true } });
    const children = new Map<string, string[]>();
    for (const f of all) if (f.parentId) { (children.get(f.parentId) ?? children.set(f.parentId, []).get(f.parentId)!).push(f.id); }
    const out = new Set<string>(); const stack = [...ids];
    while (stack.length) { const x = stack.pop()!; if (out.has(x)) continue; out.add(x); for (const c of children.get(x) ?? []) stack.push(c); }
    return [...out];
  }
  async expandTagsDown(ids: string[]): Promise<string[]> {
    const all = await this.prisma.tag.findMany({ select: { id: true, parentId: true } });
    const children = new Map<string, string[]>();
    for (const t of all) if (t.parentId) { (children.get(t.parentId) ?? children.set(t.parentId, []).get(t.parentId)!).push(t.id); }
    const out = new Set<string>(); const stack = [...ids];
    while (stack.length) { const x = stack.pop()!; if (out.has(x)) continue; out.add(x); for (const c of children.get(x) ?? []) stack.push(c); }
    return [...out];
  }
  private async folderParentMap(): Promise<Map<string, string | null>> {
    const all = await this.prisma.folder.findMany({ select: { id: true, parentId: true } });
    return new Map(all.map((f) => [f.id, f.parentId]));
  }
  private async tagParentMap(): Promise<Map<string, string | null>> {
    const all = await this.prisma.tag.findMany({ select: { id: true, parentId: true } });
    return new Map(all.map((t) => [t.id, t.parentId]));
  }
}

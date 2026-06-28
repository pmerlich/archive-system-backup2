// files.service.ts — קליטת קבצים (שלב 1.5): הסגר → בדיקת סוג וגודל → חישוב Hash → אחסון קבוע → רשומה.
// עקרונות אבטחה מהאפיון: המקור קדוש (לא משנים/מוחקים פיזית), אחסון לפי תוכן (hash) שמכין לזיהוי כפילויות,
// וכל פעולה נרשמת בלוג. הקובץ הפיזי נשמר מחוץ לקוד (volume), לא נגיש ישירות — רק דרך הורדה מורשית.
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { AccessService } from '../access/access.service';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

// גודל מקסימלי לקובץ בודד (אפשר להגדיל בעתיד). 5GB.
const MAX_SIZE = 5 * 1024 * 1024 * 1024;

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger('FilesService');
  private readonly storageDir: string;
  private readonly quarantineDir: string;
  private readonly filesDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tags: TagsService,
    private readonly access: AccessService,
    config: ConfigService,
  ) {
    this.storageDir = config.get<string>('storageDir') ?? '/data';
    this.quarantineDir = path.join(this.storageDir, 'quarantine');
    this.filesDir = path.join(this.storageDir, 'files');
  }

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.quarantineDir, { recursive: true });
    await fs.mkdir(this.filesDir, { recursive: true });
    this.logger.log(`אחסון קבצים: ${this.storageDir}`);
  }

  // קליטת קובץ שהועלה (כבר נמצא בהסגר ע"י Multer). מבצע את כל בדיקות הבטיחות לפני כניסה למאגר.
  async ingest(
    actorId: string,
    file: { path: string; size: number; originalname: string } | undefined,
    body: { folderId?: string; tagIds?: string },
  ) {
    if (!file) throw new BadRequestException('לא צורף קובץ');

    try {
      // 1) בדיקת גודל
      if (file.size > MAX_SIZE) {
        throw new BadRequestException('הקובץ גדול מדי (מעל 5GB)');
      }
      if (file.size === 0) throw new BadRequestException('הקובץ ריק');

      // 2) שם הקובץ — תיקון קידוד (Multer מפענח latin1; מחזירים לעברית/UTF-8)
      const name = Buffer.from(file.originalname, 'latin1').toString('utf8') || 'file';

      // 3) זיהוי סוג אמיתי לפי חתימת הבייטים (לא לפי הסיומת)
      const mimeType = await this.detectMime(file.path);

      // 4) חישוב Hash (SHA-256) בזרימה
      const hash = await this.hashFile(file.path);

      // 5) בדיקת תיקייה ותגיות
      let folderId: string | null = null;
      if (body.folderId) {
        const folder = await this.prisma.folder.findFirst({ where: { id: body.folderId, deletedAt: null } });
        if (!folder) throw new BadRequestException('התיקייה שנבחרה לא נמצאה');
        folderId = folder.id;
      }
      const tagIds = (body.tagIds ?? '').split(',').map((t) => t.trim()).filter(Boolean);
      if (tagIds.length) {
        const found = await this.prisma.tag.count({ where: { id: { in: tagIds } } });
        if (found !== tagIds.length) throw new BadRequestException('אחת התגיות שנבחרו לא קיימת');
      }

      // 6) האם כבר קיים קובץ פעיל עם אותו תוכן? (סימון כפילות — הטיפול המלא בשלב 1.6)
      const duplicate = await this.prisma.file.findFirst({ where: { hash, deletedAt: null } });

      // 7) אחסון קבוע לפי התוכן: files/<2 ספרות>/<hash>. אם כבר קיים — לא שומרים שוב (חיסכון).
      const destDir = path.join(this.filesDir, hash.slice(0, 2));
      const destPath = path.join(destDir, hash);
      await fs.mkdir(destDir, { recursive: true });
      if (await this.exists(destPath)) {
        await fs.rm(file.path, { force: true }); // התוכן כבר קיים — מוחקים את עותק ההסגר
      } else {
        await fs.rename(file.path, destPath);
      }

      // 8) יצירת הרשומה + שיוך תגיות
      const created = await this.prisma.file.create({
        data: {
          name,
          hash,
          sizeBytes: BigInt(file.size),
          mimeType,
          uploadedById: actorId, // מי שהעלה — לסינון
          source: 'upload',
          folderId,
          tags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
        },
        include: { tags: { include: { tag: true } }, folder: true },
      });

      await this.audit('file.uploaded', actorId, created.id, {
        name,
        hash,
        size: file.size,
        mimeType,
        folderId,
        duplicate: !!duplicate,
      });

      return {
        ...this.summary(created, await this.tags.pathMap()),
        duplicate: !!duplicate,
        duplicateOf: duplicate?.name ?? null, // שם הקובץ הקיים בעל תוכן זהה (אם יש)
      };
    } finally {
      // ניקיון ביטחון: אם נשאר עותק בהסגר (עקב שגיאה) — מסירים אותו
      await fs.rm(file.path, { force: true }).catch(() => undefined);
    }
  }

  // רשימת קבצים (לא מחוקים) — חיפוש, סינון מתקדם, מיון וטעינה במנות (עימוד). שלבים 2.1–2.2.
  //   q=חיפוש בשם · folderId · tagId(+withSub) או tagIds (לפחות-אחת) · excludeTagIds (החרגה)
  //   mimeTypes (סוגים) · ext (סיומת) · sizeMin/sizeMax (בייטים) · createdFrom/createdTo (תאריכים)
  //   uploadedById (מי העלה) · source (upload|import) · duplicate (only|unique) · backedUp (בוליאני)
  //   sort=createdAt|name|sizeBytes · order=asc|desc · page (מ-1) · pageSize
  // מחזיר { items, total, page, pageSize, pages }. כל הסינונים משתלבים יחד (AND).
  async list(
    opts: {
      q?: string;
      folderId?: string;
      tagId?: string;
      withSub?: boolean;
      untagged?: boolean;
      tagIds?: string[];
      excludeTagIds?: string[];
      mimeTypes?: string[];
      ext?: string;
      sizeMin?: number;
      sizeMax?: number;
      createdFrom?: string;
      createdTo?: string;
      uploadedById?: string;
      source?: string;
      duplicate?: string;
      backedUp?: boolean;
      sort?: string;
      order?: string;
      page?: number;
      pageSize?: number;
      userId?: string;
    } = {},
  ) {
    const where: any = { deletedAt: null };
    const and: any[] = []; // לתנאים שעלולים לדרוס זה את זה (כמה תנאים על אותו שדה, למשל name)

    if (opts.folderId) where.folderId = opts.folderId;

    // תגיות — "לפחות אחת מ": tagIds גובר; אחרת תאימות-לאחור ל-tagId (+ withSub לצאצאים).
    if (opts.untagged) {
      where.tags = { none: {} }; // רק קבצים ללא תגיות כלל (תצוגה מהירה "ללא תגית")
    } else {
      let anyOf: string[] | null = null;
      if (opts.tagIds && opts.tagIds.length) anyOf = opts.tagIds;
      else if (opts.tagId) anyOf = opts.withSub ? await this.tags.descendantIds(opts.tagId) : [opts.tagId];
      if (anyOf && anyOf.length) where.tags = { some: { tagId: { in: anyOf } } };
    }

    // החרגת תגיות — קובץ שיש לו אחת מאלה לא יוצג.
    if (opts.excludeTagIds && opts.excludeTagIds.length) {
      where.NOT = { tags: { some: { tagId: { in: opts.excludeTagIds } } } };
    }

    // חיפוש בשם + סיומת — שניהם על השדה name, לכן דרך AND כדי לא לדרוס.
    const q = (opts.q ?? '').trim();
    if (q) and.push({ name: { contains: q, mode: 'insensitive' } }); // נתמך באינדקס pg_trgm
    const ext = (opts.ext ?? '').trim().replace(/^\./, '');
    if (ext) and.push({ name: { endsWith: '.' + ext, mode: 'insensitive' } });

    // סוג (mime) — לפחות אחד מהרשימה.
    if (opts.mimeTypes && opts.mimeTypes.length) where.mimeType = { in: opts.mimeTypes };

    // טווח גדלים (בייטים).
    if (opts.sizeMin != null || opts.sizeMax != null) {
      const sz: any = {};
      if (opts.sizeMin != null && !Number.isNaN(opts.sizeMin)) sz.gte = BigInt(Math.floor(opts.sizeMin));
      if (opts.sizeMax != null && !Number.isNaN(opts.sizeMax)) sz.lte = BigInt(Math.floor(opts.sizeMax));
      if (Object.keys(sz).length) where.sizeBytes = sz;
    }

    // טווח תאריכים (createdAt). תאריך-בלבד (YYYY-MM-DD) → מ-00:00 עד 23:59:59.999 (UTC).
    const toDate = (v: string, end: boolean) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + (end ? 'T23:59:59.999Z' : 'T00:00:00.000Z')) : new Date(v);
    if (opts.createdFrom || opts.createdTo) {
      const ca: any = {};
      if (opts.createdFrom) { const d = toDate(opts.createdFrom, false); if (!isNaN(+d)) ca.gte = d; }
      if (opts.createdTo) { const d = toDate(opts.createdTo, true); if (!isNaN(+d)) ca.lte = d; }
      if (Object.keys(ca).length) where.createdAt = ca;
    }

    if (opts.uploadedById) where.uploadedById = opts.uploadedById;
    if (['upload', 'import', 'edit'].includes(opts.source ?? '')) where.source = opts.source;
    if (typeof opts.backedUp === 'boolean') where.backedUp = opts.backedUp;

    // מצב כפילות — לפי קבוצות תוכן זהה (hash שמופיע יותר מפעם אחת בין הקבצים הפעילים).
    if (opts.duplicate === 'only' || opts.duplicate === 'unique') {
      const groups = await this.prisma.file.groupBy({
        by: ['hash'], where: { deletedAt: null }, _count: { hash: true }, having: { hash: { _count: { gt: 1 } } },
      });
      const dupHashes = groups.map((g) => g.hash);
      if (opts.duplicate === 'only') where.hash = dupHashes.length ? { in: dupHashes } : { in: ['__none__'] };
      else if (dupHashes.length) where.hash = { notIn: dupHashes };
    }

    // הרשאות גישה לפי טווח (3.9): משתמש מוגבל-טווח רואה רק את מה שהוענק לו.
    const vis = await this.access.visibilityWhere(opts.userId);
    if (vis) and.push(vis);

    if (and.length) where.AND = and;

    // מיון בטוח — רק שדות מותרים. ברירת מחדל: לפי תאריך, חדש→ישן.
    const sortField = ['createdAt', 'name', 'sizeBytes'].includes(opts.sort ?? '') ? (opts.sort as string) : 'createdAt';
    const sortOrder = opts.order === 'asc' ? 'asc' : 'desc';
    const orderBy: any = { [sortField]: sortOrder };

    // עימוד — גבולות בטוחים (מנה 1..200, ברירת מחדל 50).
    const pageSize = Math.min(Math.max(Number(opts.pageSize) || 50, 1), 200);
    const page = Math.max(Number(opts.page) || 1, 1);
    const skip = (page - 1) * pageSize;

    const [total, files] = await this.prisma.$transaction([
      this.prisma.file.count({ where }),
      this.prisma.file.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: { tags: { include: { tag: true } }, folder: true },
      }),
    ]);
    const paths = await this.tags.pathMap();
    return {
      items: files.map((f) => this.summary(f, paths)),
      total,
      page,
      pageSize,
      pages: Math.max(Math.ceil(total / pageSize), 1),
    };
  }

  // סוגי הקבצים (mime) הקיימים כרגע במאגר — להזנת תפריט הסינון "סוג".
  async availableTypes(): Promise<string[]> {
    const rows = await this.prisma.file.findMany({
      where: { deletedAt: null, mimeType: { not: null } },
      distinct: ['mimeType'],
      select: { mimeType: true },
      orderBy: { mimeType: 'asc' },
    });
    return rows.map((r) => r.mimeType as string).filter(Boolean);
  }

  // מי שהעלה/ייבא קבצים (מזהה+שם) — לתפריט הסינון "מי שהעלה". נגיש לכל מי שרשאי לצפות.
  async uploaders(): Promise<{ id: string; name: string }[]> {
    const groups = await this.prisma.file.groupBy({
      by: ['uploadedById'],
      where: { deletedAt: null, uploadedById: { not: null } },
    });
    const ids = groups.map((g) => g.uploadedById as string).filter(Boolean);
    if (!ids.length) return [];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    return ids.map((id) => ({ id, name: nameById.get(id) ?? 'משתמש' }));
  }

  async listDeleted() {
    const files = await this.prisma.file.findMany({
      where: { NOT: { deletedAt: null } },
      orderBy: { deletedAt: 'desc' },
      include: { tags: { include: { tag: true } }, folder: true },
    });
    const paths = await this.tags.pathMap();
    return files.map((f) => this.summary(f, paths));
  }

  async meta(id: string) {
    const f = await this.prisma.file.findFirst({
      where: { id, deletedAt: null },
      include: { tags: { include: { tag: true } }, folder: true },
    });
    if (!f) throw new NotFoundException('הקובץ לא נמצא');
    return this.summary(f, await this.tags.pathMap());
  }

  // מחזיר את הנתיב הפיזי + רשומה, להורדה מאובטחת (הזרמה ע"י הקונטרולר).
  async getForDownload(id: string) {
    const f = await this.prisma.file.findFirst({ where: { id, deletedAt: null } });
    if (!f) throw new NotFoundException('הקובץ לא נמצא');
    // תוכן רגיש (תגית HIGH) — אין הורדת מקור כלל; ניתן לצפות בו רק דרך Archive Reader (שלב 3.3, גרסת צפייה ממוית-מים בלבד).
    const sensitive = (await this.prisma.fileTag.count({ where: { fileId: id, tag: { sensitivity: 'HIGH' } } })) > 0;
    if (sensitive) throw new ForbiddenException('קובץ רגיש — אין הורדת מקור; ניתן לצפות בו רק דרך Archive Reader');
    const filePath = path.join(this.filesDir, f.hash.slice(0, 2), f.hash);
    if (!(await this.exists(filePath))) throw new NotFoundException('הקובץ הפיזי חסר');
    return { file: f, filePath };
  }

  // כמו getForDownload — אך לתצוגה מקדימה. הנתיב הפיזי זהה; ההבדל הוא ההרשאה הנדרשת (files.view) והגשה inline.
  async getForPreview(id: string) {
    // תוכן רגיש (תגית HIGH) — אין תצוגה מקדימה רגילה בדפדפן; חייבים את הצופה המוגן / Archive Reader (שלב 3.3).
    const sensitive = (await this.prisma.fileTag.count({ where: { fileId: id, tag: { sensitivity: 'HIGH' } } })) > 0;
    if (sensitive) throw new ForbiddenException('קובץ רגיש — ניתן לצפות בו רק דרך הצופה המוגן / Archive Reader');
    return this.getForDownload(id);
  }

  // [שינוי 2026-06-25] רישום הורדת מקור — נקרא מהקונטרולר לאחר בדיקת הרשאה ושליפה מוצלחת.
  async recordDownload(userId: string, file: { id: string; name: string }, device?: string) {
    await this.audit('file.downloaded', userId, file.id, { name: file.name, device: device ?? null });
  }

  // פרטי-על מלאים של קובץ (שלב 2.5): סוג, גודל, תאריכים, מקור, מי העלה, חתימת Hash, תגיות, וכמה עותקים בעלי תוכן זהה.
  async details(id: string) {
    const f = await this.prisma.file.findFirst({
      where: { id, deletedAt: null },
      include: { tags: { include: { tag: true } }, folder: true },
    });
    if (!f) throw new NotFoundException('הקובץ לא נמצא');
    const base = this.summary(f, await this.tags.pathMap());
    const duplicateCount = await this.prisma.file.count({ where: { hash: f.hash, deletedAt: null } });
    let uploadedBy: { id: string; name: string; email: string } | null = null;
    if (f.uploadedById) {
      const u = await this.prisma.user.findUnique({
        where: { id: f.uploadedById },
        select: { id: true, name: true, email: true },
      });
      if (u) uploadedBy = u;
    }
    return { ...base, updatedAt: f.updatedAt, uploadedBy, duplicateCount };
  }

  async softDelete(actorId: string, id: string) {
    const f = await this.prisma.file.findFirst({ where: { id, deletedAt: null } });
    if (!f) throw new NotFoundException('הקובץ לא נמצא');
    await this.prisma.file.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit('file.deleted', actorId, id, { name: f.name });
    return { id, deleted: true };
  }

  async restore(actorId: string, id: string) {
    const f = await this.prisma.file.findFirst({ where: { id, NOT: { deletedAt: null } } });
    if (!f) throw new NotFoundException('הקובץ לא נמצא בסל המחזור');
    // אם התיקייה נמחקה — מחזירים לשורש (ללא תיקייה)
    let folderId = f.folderId;
    if (folderId) {
      const folder = await this.prisma.folder.findFirst({ where: { id: folderId, deletedAt: null } });
      if (!folder) folderId = null;
    }
    await this.prisma.file.update({ where: { id }, data: { deletedAt: null, folderId } });
    await this.audit('file.restored', actorId, id, { name: f.name });
    return { id, restored: true };
  }

  // קבוצות של קבצים פעילים עם אותו תוכן (אותו hash, count>1) — כפילויות מלאות.
  async duplicates(userId?: string) {
    // הרשאות גישה (3.9): משתמש מוגבל-טווח רואה כפילויות רק בין הקבצים שהוענקו לו.
    const vis = await this.access.visibilityWhere(userId);
    const base: any = vis ? { deletedAt: null, AND: [vis] } : { deletedAt: null };
    const groups = await this.prisma.file.groupBy({
      by: ['hash'],
      where: base,
      _count: { hash: true },
      having: { hash: { _count: { gt: 1 } } },
    });
    if (groups.length === 0) return [];
    const hashes = groups.map((g) => g.hash);
    const files = await this.prisma.file.findMany({
      where: { ...base, hash: { in: hashes } },
      orderBy: { createdAt: 'asc' },
      include: { tags: { include: { tag: true } }, folder: true },
    });
    const paths = await this.tags.pathMap();
    const byHash = new Map<string, ReturnType<typeof this.summary>[]>();
    for (const f of files) {
      const arr = byHash.get(f.hash) ?? [];
      arr.push(this.summary(f, paths));
      byHash.set(f.hash, arr);
    }
    return hashes.map((h) => {
      const arr = byHash.get(h) ?? [];
      return { hash: h, count: arr.length, sizeBytes: arr[0]?.sizeBytes ?? 0, files: arr };
    });
  }

  // מיזוג כפילויות: שומרים קובץ אחד, מאחדים אליו את התגיות של השאר, ומוחקים את השאר (מחיקה רכה).
  // בטיחות: כל הקבצים חייבים להיות בעלי אותו תוכן (hash) כמו הקובץ שנשמר. הבלוק הפיזי נשאר (משותף — לא נמחק).
  async mergeDuplicates(actorId: string, keepId: string, removeIds: string[]) {
    const ids = [...new Set(removeIds.filter((id) => id && id !== keepId))];
    if (ids.length === 0) throw new BadRequestException('יש לבחור קבצים אחרים להסרה');

    const keep = await this.prisma.file.findFirst({
      where: { id: keepId, deletedAt: null },
      include: { tags: true },
    });
    if (!keep) throw new NotFoundException('הקובץ שנשמר לא נמצא');

    const removals = await this.prisma.file.findMany({
      where: { id: { in: ids }, deletedAt: null },
      include: { tags: true },
    });
    if (removals.length !== ids.length) throw new BadRequestException('חלק מהקבצים לא נמצאו');
    if (removals.some((f) => f.hash !== keep.hash)) {
      throw new BadRequestException('אפשר למזג רק קבצים עם תוכן זהה');
    }

    const keepTagIds = new Set(keep.tags.map((t) => t.tagId));
    for (const r of removals) {
      // איחוד התגיות לקובץ שנשמר (בלי כפילויות) — כדי לא לאבד מידע
      for (const ft of r.tags) {
        if (!keepTagIds.has(ft.tagId)) {
          await this.prisma.fileTag.create({ data: { fileId: keepId, tagId: ft.tagId } });
          keepTagIds.add(ft.tagId);
        }
      }
      await this.prisma.file.update({ where: { id: r.id }, data: { deletedAt: new Date() } });
    }
    await this.audit('file.duplicates.merged', actorId, keepId, {
      hash: keep.hash, kept: keepId, removed: ids, removedNames: removals.map((r) => r.name),
    });
    return { keepId, removed: ids.length };
  }

  // ───────── ייבוא מדיסקים (שלב 1.7) ─────────

  // בדיקה בלבד (קריאה): מחשב Hash לקובץ שבמקור ומשווה למאגר — בלי להעתיק ובלי ליצור רשומה. למצב "סריקה בלבד".
  async inspectFile(sourcePath: string): Promise<{ hash: string; sizeBytes: number; existing: { id: string; name: string } | null }> {
    const st = await fs.stat(sourcePath);
    if (!st.isFile()) throw new BadRequestException('הנתיב אינו קובץ');
    const hash = await this.hashFile(sourcePath);
    const existing = await this.prisma.file.findFirst({ where: { hash, deletedAt: null }, select: { id: true, name: true } });
    return { hash, sizeBytes: st.size, existing };
  }

  // ייבוא קובץ בודד מנתיב בדיסק. קוראים בלבד מהמקור (לעולם לא משנים/מוחקים אותו):
  // אם התוכן כבר במאגר — מחזירים isNew=false (כפילות; לא יוצרים רשומה כפולה ולא מעתיקים שוב);
  // אם חדש — מעתיקים (copy) את הבלוק לאחסון-לפי-תוכן ויוצרים רשומת File. knownHash חוסך חישוב Hash חוזר.
  async importFile(opts: { sourcePath: string; name: string; folderId?: string | null; knownHash?: string; uploadedById?: string | null }): Promise<{ isNew: boolean; fileId: string; existingName: string | null; hash: string; sizeBytes: number }> {
    const st = await fs.stat(opts.sourcePath);
    if (!st.isFile()) throw new BadRequestException('הנתיב אינו קובץ');
    const sizeBytes = st.size;
    const hash = opts.knownHash ?? (await this.hashFile(opts.sourcePath));

    const existing = await this.prisma.file.findFirst({ where: { hash, deletedAt: null }, select: { id: true, name: true } });
    if (existing) {
      return { isNew: false, fileId: existing.id, existingName: existing.name, hash, sizeBytes };
    }

    const mimeType = await this.detectMime(opts.sourcePath);
    const destDir = path.join(this.filesDir, hash.slice(0, 2));
    const destPath = path.join(destDir, hash);
    await fs.mkdir(destDir, { recursive: true });
    if (!(await this.exists(destPath))) {
      await fs.copyFile(opts.sourcePath, destPath); // העתקה — המקור נשאר שלם
    }
    const created = await this.prisma.file.create({
      data: { name: opts.name, hash, sizeBytes: BigInt(sizeBytes), mimeType, uploadedById: opts.uploadedById ?? null, source: 'import', folderId: opts.folderId ?? null },
    });
    return { isNew: true, fileId: created.id, existingName: null, hash, sizeBytes };
  }

  // יצירת קובץ נגזר (גרסה ערוכה — שלב 4): מקבל נתיב לתוצר עריכה שכבר הופק,
  // שומר אותו באחסון-לפי-תוכן ויוצר רשומת File חדשה (source='edit'). המקור לא נוגע — זו רשומה חדשה ונפרדת.
  async createDerived(opts: { tmpPath: string; name: string; folderId?: string | null; uploadedById?: string | null; source?: string }): Promise<{ id: string; name: string; hash: string; sizeBytes: number; mimeType: string; duplicate: boolean }> {
    const st = await fs.stat(opts.tmpPath);
    if (!st.isFile() || st.size === 0) throw new BadRequestException('תוצר העריכה ריק');
    if (st.size > MAX_SIZE) throw new BadRequestException('תוצר העריכה גדול מדי');
    const hash = await this.hashFile(opts.tmpPath);
    const mimeType = await this.detectMime(opts.tmpPath);
    const destDir = path.join(this.filesDir, hash.slice(0, 2));
    const destPath = path.join(destDir, hash);
    await fs.mkdir(destDir, { recursive: true });
    const duplicate = await this.exists(destPath);
    if (duplicate) {
      await fs.rm(opts.tmpPath, { force: true }); // התוכן כבר קיים — לא שומרים שוב
    } else {
      try {
        await fs.rename(opts.tmpPath, destPath);
      } catch {
        await fs.copyFile(opts.tmpPath, destPath); // נפילה לעותק אם rename חוצה-volume נכשל
        await fs.rm(opts.tmpPath, { force: true });
      }
    }
    const created = await this.prisma.file.create({
      data: { name: opts.name, hash, sizeBytes: BigInt(st.size), mimeType, uploadedById: opts.uploadedById ?? null, source: opts.source ?? 'edit', folderId: opts.folderId ?? null },
    });
    return { id: created.id, name: created.name, hash, sizeBytes: Number(st.size), mimeType, duplicate };
  }

  // ───────── עזרי פנים ─────────

  // paths = מפת מזהה-תגית → נתיב מלא (אב/אב/תגית). אם סופקה, כל תגית תחזיר גם path.
  private summary(f: any, paths?: Map<string, string>) {
    return {
      id: f.id,
      name: f.name,
      hash: f.hash,
      sizeBytes: Number(f.sizeBytes), // BigInt → Number (עד ~9PB בטוח ל-JSON)
      mimeType: f.mimeType,
      uploadedById: f.uploadedById ?? null,
      source: f.source ?? 'upload',
      backedUp: f.backedUp ?? false,
      folderId: f.folderId,
      folderName: f.folder?.name ?? null,
      tags: (f.tags ?? []).map((ft: any) => ({
        id: ft.tag.id,
        name: ft.tag.name,
        path: paths?.get(ft.tag.id) ?? ft.tag.name, // נתיב מלא להבנת ההקשר
        sensitivity: ft.tag.sensitivity,
      })),
      createdAt: f.createdAt,
      deletedAt: f.deletedAt ?? null,
    };
  }

  private hashFile(p: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const h = createHash('sha256');
      const s = createReadStream(p);
      s.on('error', reject);
      s.on('data', (chunk) => h.update(chunk));
      s.on('end', () => resolve(h.digest('hex')));
    });
  }

  // זיהוי סוג לפי חתימת הבייטים הראשונים (magic numbers). נופל ל-octet-stream אם לא מזוהה.
  private async detectMime(p: string): Promise<string> {
    const fd = await fs.open(p, 'r');
    try {
      const buf = Buffer.alloc(16);
      await fd.read(buf, 0, 16, 0);
      const hex = buf.toString('hex').toUpperCase();
      const ascii = buf.toString('latin1');
      if (hex.startsWith('25504446')) return 'application/pdf'; // %PDF
      if (hex.startsWith('89504E47')) return 'image/png';
      if (hex.startsWith('FFD8FF')) return 'image/jpeg';
      if (hex.startsWith('47494638')) return 'image/gif';
      if (hex.startsWith('504B0304') || hex.startsWith('504B0506')) return 'application/zip'; // gם docx/xlsx/pptx
      if (hex.startsWith('1F8B')) return 'application/gzip';
      if (hex.startsWith('255045')) return 'application/postscript';
      if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
      if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'AVI ') return 'video/x-msvideo';
      if (buf.slice(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
      if (hex.startsWith('494433') || hex.startsWith('FFFB')) return 'audio/mpeg'; // ID3 / MP3
      return 'application/octet-stream';
    } finally {
      await fd.close();
    }
  }

  private exists(p: string): Promise<boolean> {
    return fs.access(p).then(() => true).catch(() => false);
  }

  private async audit(action: string, userId: string, targetId: string, details: any) {
    await this.prisma.auditEvent.create({
      data: { action, userId, targetType: 'file', targetId, details },
    });
  }
}

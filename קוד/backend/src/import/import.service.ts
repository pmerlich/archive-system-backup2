// import.service.ts — שלב 1.7: ייבוא מדיסקים קיימים. המקור קדוש (קריאה בלבד; לעולם לא משנים/מוחקים בדיסק).
// זרימה בטוחה וניתנת-לחזרה: סריקה (מניית קבצים) → חישוב Hash והשוואה למאגר (חדש/קיים) → ייבוא (העתקת חדשים בלבד).
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class ImportService {
  private readonly logger = new Logger('ImportService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  // יצירת סריקה: בדיקת נתיב (תיקייה/דיסק), יצירת עבודה, ומניית הקבצים (Manifest ראשוני). קריאה בלבד.
  async createScan(actorId: string, sourcePathRaw: string, label?: string) {
    const sourcePath = (sourcePathRaw ?? '').trim();
    if (!sourcePath || !path.isAbsolute(sourcePath)) {
      throw new BadRequestException('יש לציין נתיב מלא (absolute) לדיסק או לתיקייה');
    }
    let stat;
    try {
      stat = await fs.stat(sourcePath);
    } catch {
      throw new BadRequestException('הנתיב לא נמצא או אינו נגיש לשרת');
    }
    if (!stat.isDirectory()) throw new BadRequestException('הנתיב חייב להיות תיקייה או דיסק');

    const job = await this.prisma.importJob.create({
      data: {
        label: (label ?? '').trim() || path.basename(sourcePath) || 'ייבוא',
        sourcePath,
        status: 'scanning',
        createdById: actorId,
        startedAt: new Date(),
      },
    });

    let total = 0;
    let bytes = 0n;
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; // תיקייה לא נגישה — מדלגים (לא מפילים את כל הסריקה)
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isSymbolicLink()) continue; // מדלגים על קישורים סימבוליים (בטיחות: לא יוצאים מתחום המקור)
        if (e.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!e.isFile()) continue;
        let sz = 0;
        try {
          sz = (await fs.stat(full)).size;
        } catch {
          continue;
        }
        await this.prisma.importItem.create({
          data: {
            jobId: job.id,
            relativePath: path.relative(sourcePath, full),
            name: e.name,
            sizeBytes: BigInt(sz),
            status: 'pending',
          },
        });
        total++;
        bytes += BigInt(sz);
      }
    };
    await walk(sourcePath);

    const updated = await this.prisma.importJob.update({
      where: { id: job.id },
      data: { totalFiles: total, totalBytes: bytes },
    });
    await this.audit('import.scan.created', actorId, job.id, { label: updated.label, sourcePath, totalFiles: total });
    return this.summary(updated);
  }

  // שלב הסריקה (קריאה בלבד): מחשב Hash לכמה פריטים ממתינים ומסמן new/duplicate מול המאגר.
  // ניתן-לחזרה: קוראים שוב עד שאין pending. אינו מעתיק ואינו יוצר קבצים — "סריקה בלבד".
  async hashBatch(actorId: string, jobId: string, limit = 25) {
    const job = await this.requireJob(jobId);
    if (job.status === 'completed') return this.summary(job);

    const items = await this.prisma.importItem.findMany({
      where: { jobId, status: 'pending' },
      take: this.clamp(limit),
    });

    let hashed = 0, newF = 0, dup = 0, err = 0;
    let newB = 0n;
    for (const it of items) {
      const full = path.join(job.sourcePath, it.relativePath);
      try {
        const ins = await this.files.inspectFile(full);
        if (ins.existing) {
          await this.prisma.importItem.update({ where: { id: it.id }, data: { status: 'duplicate', hash: ins.hash, fileId: ins.existing.id } });
          dup++;
        } else {
          await this.prisma.importItem.update({ where: { id: it.id }, data: { status: 'new', hash: ins.hash } });
          newF++;
          newB += BigInt(ins.sizeBytes);
        }
        hashed++;
      } catch (e: any) {
        await this.prisma.importItem.update({ where: { id: it.id }, data: { status: 'error', error: String(e?.message ?? e) } });
        err++;
      }
    }

    await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        hashedFiles: { increment: hashed },
        newFiles: { increment: newF },
        newBytes: { increment: newB },
        duplicateFiles: { increment: dup },
        errorFiles: { increment: err },
      },
    });
    const remaining = await this.prisma.importItem.count({ where: { jobId, status: 'pending' } });
    const final = remaining === 0
      ? await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'scanned' } })
      : await this.requireJob(jobId);
    if (remaining === 0) await this.audit('import.scanned', actorId, jobId, { newFiles: final.newFiles, duplicateFiles: final.duplicateFiles });
    return this.summary(final);
  }

  // שלב הייבוא (אחרי אישור): מעתיק קבצים חדשים בלבד למאגר ויוצר רשומות File. ניתן-לחזרה ובטוח.
  async importBatch(actorId: string, jobId: string, limit = 25) {
    const job = await this.requireJob(jobId);
    if (job.status === 'completed') return this.summary(job);

    // תיקיית יעד לקבצים החדשים — נוצרת פעם אחת בתחילת הייבוא.
    let targetFolderId = job.targetFolderId;
    if (!targetFolderId) {
      const folder = await this.prisma.folder.create({ data: { name: `ייבוא: ${job.label}` } });
      targetFolderId = folder.id;
      await this.prisma.importJob.update({ where: { id: jobId }, data: { targetFolderId, status: 'importing' } });
      await this.audit('import.started', actorId, jobId, { targetFolderId });
    } else if (job.status !== 'importing') {
      await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'importing' } });
    }

    const items = await this.prisma.importItem.findMany({
      where: { jobId, status: 'new' },
      take: this.clamp(limit),
    });
    if (items.length === 0) {
      const done = await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'completed', finishedAt: new Date() } });
      await this.audit('import.completed', actorId, jobId, { importedFiles: done.importedFiles, duplicateFiles: done.duplicateFiles });
      return this.summary(done);
    }

    let imp = 0, dup = 0, err = 0;
    let impB = 0n;
    for (const it of items) {
      const full = path.join(job.sourcePath, it.relativePath);
      try {
        const res = await this.files.importFile({ sourcePath: full, name: it.name, folderId: targetFolderId, knownHash: it.hash ?? undefined, uploadedById: actorId });
        if (res.isNew) {
          await this.prisma.importItem.update({ where: { id: it.id }, data: { status: 'imported', fileId: res.fileId } });
          imp++;
          impB += BigInt(it.sizeBytes);
        } else {
          // התוכן כבר נכנס למאגר בינתיים (למשל קובץ זהה קודם באותה אצווה) → מסומן ככפילות.
          await this.prisma.importItem.update({ where: { id: it.id }, data: { status: 'duplicate', fileId: res.fileId } });
          dup++;
        }
      } catch (e: any) {
        await this.prisma.importItem.update({ where: { id: it.id }, data: { status: 'error', error: String(e?.message ?? e) } });
        err++;
      }
    }

    await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        importedFiles: { increment: imp },
        importedBytes: { increment: impB },
        duplicateFiles: { increment: dup },
        newFiles: { decrement: dup }, // פריטים שהתבררו ככפילות בעת הייבוא יורדים מ"חדש"
        errorFiles: { increment: err },
      },
    });
    const remaining = await this.prisma.importItem.count({ where: { jobId, status: 'new' } });
    const final = remaining === 0
      ? await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'completed', finishedAt: new Date() } })
      : await this.requireJob(jobId);
    if (remaining === 0) await this.audit('import.completed', actorId, jobId, { importedFiles: final.importedFiles });
    return this.summary(final);
  }

  async list() {
    const jobs = await this.prisma.importJob.findMany({ orderBy: { createdAt: 'desc' } });
    return jobs.map((j) => this.summary(j));
  }

  async get(jobId: string) {
    return this.summary(await this.requireJob(jobId));
  }

  // ה-Manifest: שורות הקבצים שנמצאו (מפת מיקום), עם סינון אופציונלי לפי מצב.
  async manifest(jobId: string, opts: { status?: string; skip?: number; take?: number } = {}) {
    await this.requireJob(jobId);
    const where: any = { jobId };
    if (opts.status) where.status = opts.status;
    const take = Math.min(Math.max(opts.take ?? 100, 1), 500);
    const skip = Math.max(opts.skip ?? 0, 0);
    const [total, rows] = await Promise.all([
      this.prisma.importItem.count({ where }),
      this.prisma.importItem.findMany({ where, orderBy: { relativePath: 'asc' }, skip, take }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        relativePath: r.relativePath,
        name: r.name,
        sizeBytes: Number(r.sizeBytes),
        hash: r.hash,
        status: r.status,
        fileId: r.fileId,
        error: r.error,
      })),
    };
  }

  // ───────── עזרי פנים ─────────

  private clamp(n: number) {
    return Math.min(Math.max(Math.floor(n) || 25, 1), 500);
  }

  private async requireJob(id: string) {
    const j = await this.prisma.importJob.findUnique({ where: { id } });
    if (!j) throw new NotFoundException('עבודת הייבוא לא נמצאה');
    return j;
  }

  private summary(j: any) {
    return {
      id: j.id,
      label: j.label,
      sourcePath: j.sourcePath,
      status: j.status,
      targetFolderId: j.targetFolderId,
      totalFiles: j.totalFiles,
      totalBytes: Number(j.totalBytes),
      hashedFiles: j.hashedFiles,
      newFiles: j.newFiles,
      newBytes: Number(j.newBytes),
      duplicateFiles: j.duplicateFiles,
      importedFiles: j.importedFiles,
      importedBytes: Number(j.importedBytes),
      errorFiles: j.errorFiles,
      createdAt: j.createdAt,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
    };
  }

  private async audit(action: string, userId: string, targetId: string, details: any) {
    await this.prisma.auditEvent.create({
      data: { action, userId, targetType: 'import', targetId, details },
    });
  }
}

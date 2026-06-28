// stats.service.ts — נתוני לוח הבקרה החי (שלב 2.7). חישוב מהיר של תמונת מצב הארכיון.
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { statfs } from 'fs';
import { promisify } from 'util';

const statfsAsync = promisify(statfs);

@Injectable()
export class StatsService {
  private readonly storageDir: string;
  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    this.storageDir = config.get<string>('storageDir') ?? '/data';
  }

  async dashboard() {
    const [files, byTypeRaw, notBackedUp, pendingImports, usedRow, dupRow] = await Promise.all([
      this.prisma.file.count({ where: { deletedAt: null } }),
      this.prisma.file.groupBy({ by: ['mimeType'], where: { deletedAt: null }, _count: { _all: true }, _sum: { sizeBytes: true } }),
      this.prisma.file.count({ where: { deletedAt: null, backedUp: false } }),
      this.prisma.importJob.count({ where: { status: { notIn: ['completed', 'failed'] } } }),
      // אחסון פיזי = סכום גדלים של תכנים ייחודיים (hash), מחושב במסד — לא טוענים מיליוני שורות לזיכרון.
      this.prisma.$queryRaw<{ used: string }[]>`SELECT COALESCE(SUM(s), 0)::text AS used FROM (SELECT DISTINCT "hash", "sizeBytes" AS s FROM "File" WHERE "deletedAt" IS NULL) d`,
      // מספר קבוצות תוכן-כפול (אותו hash ביותר מקובץ אחד) — נספר במסד.
      this.prisma.$queryRaw<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM (SELECT "hash" FROM "File" WHERE "deletedAt" IS NULL GROUP BY "hash" HAVING COUNT(*) > 1) g`,
    ]);

    const usedBytes = Number(usedRow?.[0]?.used ?? 0);
    const duplicateGroups = Number(dupRow?.[0]?.n ?? 0);

    let diskFreeBytes = 0, diskTotalBytes = 0;
    try {
      const st: any = await statfsAsync(this.storageDir);
      diskFreeBytes = Number(st.bavail) * Number(st.bsize);
      diskTotalBytes = Number(st.blocks) * Number(st.bsize);
    } catch { /* אם אין גישה ל-statfs — נחזיר 0 */ }

    const byType = byTypeRaw
      .map((g) => ({ mimeType: g.mimeType, count: g._count._all, bytes: Number(g._sum.sizeBytes ?? 0) }))
      .sort((a, b) => b.count - a.count);

    return {
      storage: { usedBytes, diskFreeBytes, diskTotalBytes },
      totals: { files, duplicateGroups, notBackedUp, pendingImports },
      byType,
    };
  }
}

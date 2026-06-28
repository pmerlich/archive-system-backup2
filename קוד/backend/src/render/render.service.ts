// render.service.ts — תור עיבוד ברקע (שלב 4.5).
// עבודות כבדות (עריכת תמונה כעת; וידאו ו-AI ב-4.6/4.7) נכנסות לתור ב-DB ורצות ברקע ע"י worker פנימי,
// כך שהאתר נשאר זמין. הסטטוס וההתקדמות נשמרים ב-RenderJob ונקראים ע"י הממשק.
// תור מבוסס-DB (לא Redis) — פשוט, עמיד (שורד restart), ושקוף ב-Postgres. מקביליות מוגבלת לריסון עומס ImageMagick/ffmpeg.
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';

const ALLOWED_TYPES = ['edit']; // וידאו/AI יתווספו ב-4.6/4.7
const MAX_CONCURRENCY = 1; // כמה משימות כבדות במקביל (ריסון עומס; אפשר להגדיל בשרת חזק)
const POLL_MS = 1500;

@Injectable()
export class RenderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('RenderService');
  private running = 0;
  private timer: any = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async onModuleInit(): Promise<void> {
    // התאוששות: משימות שנתקעו ב-'processing' (השרת נפל באמצע) — מוחזרות ל-'pending' כדי לרוץ שוב.
    try {
      const r = await this.prisma.renderJob.updateMany({ where: { status: 'processing' }, data: { status: 'pending', progress: 0, startedAt: null } });
      if (r.count) this.logger.log(`התאוששות תור: ${r.count} משימות הוחזרו לתור`);
    } catch { /* הטבלה אולי עדיין לא קיימת בעליית-ראשונה לפני מיגרציה */ }
    this.timer = setInterval(() => { this.tick().catch(() => undefined); }, POLL_MS);
    this.logger.log(`תור עיבוד ברקע פעיל (מקביליות ${MAX_CONCURRENCY})`);
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  // ───────────────────────── API ─────────────────────────

  async enqueue(userId: string, type: string, fileId: string | null, params: any) {
    if (!ALLOWED_TYPES.includes(type)) throw new BadRequestException('סוג משימה לא נתמך');
    const job = await this.prisma.renderJob.create({
      data: { type, fileId: fileId ?? null, params: params ?? {}, createdById: userId, status: 'pending' },
    });
    await this.audit('render.enqueued', userId, job.id, { type, fileId });
    return this.dto(job);
  }

  async get(id: string) {
    const j = await this.prisma.renderJob.findUnique({ where: { id } });
    if (!j) throw new NotFoundException('המשימה לא נמצאה');
    return this.dto(j);
  }

  async list(opts: { status?: string; mine?: boolean; userId?: string; page?: number; pageSize?: number } = {}) {
    const where: any = {};
    if (opts.status && ['pending', 'processing', 'done', 'failed', 'canceled'].includes(opts.status)) where.status = opts.status;
    if (opts.mine && opts.userId) where.createdById = opts.userId;
    const pageSize = Math.min(Math.max(Number(opts.pageSize) || 50, 1), 200);
    const page = Math.max(Number(opts.page) || 1, 1);
    const [total, jobs] = await this.prisma.$transaction([
      this.prisma.renderJob.count({ where }),
      this.prisma.renderJob.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const active = await this.prisma.renderJob.count({ where: { status: { in: ['pending', 'processing'] } } });
    return { items: jobs.map((j) => this.dto(j)), total, page, pageSize, pages: Math.max(Math.ceil(total / pageSize), 1), active };
  }

  // ביטול — רק משימה שעדיין ממתינה (לא ניתן לעצור עבודה שכבר רצה בבטחה).
  async cancel(userId: string, id: string) {
    const r = await this.prisma.renderJob.updateMany({ where: { id, status: 'pending' }, data: { status: 'canceled', finishedAt: new Date() } });
    if (r.count === 0) throw new BadRequestException('אפשר לבטל רק משימה שממתינה בתור');
    await this.audit('render.canceled', userId, id, {});
    return this.get(id);
  }

  // ───────────────────────── worker ─────────────────────────

  private async tick(): Promise<void> {
    if (this.running >= MAX_CONCURRENCY) return;
    const next = await this.prisma.renderJob.findFirst({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' } });
    if (!next) return;
    // תפיסה אטומית — רק אם עדיין pending (מונע מרוץ אם יהיו כמה worker-ים בעתיד).
    const claim = await this.prisma.renderJob.updateMany({ where: { id: next.id, status: 'pending' }, data: { status: 'processing', startedAt: new Date(), progress: 5 } });
    if (claim.count === 0) return;
    this.running++;
    this.process(next.id).catch(() => undefined).finally(() => { this.running--; });
  }

  private async process(id: string): Promise<void> {
    const job = await this.prisma.renderJob.findUnique({ where: { id } });
    if (!job) return;
    const setProgress = (n: number) =>
      this.prisma.renderJob.update({ where: { id }, data: { progress: Math.min(99, Math.max(1, Math.round(n))) } }).catch(() => undefined);
    try {
      let resultFileId: string | null = null;
      if (job.type === 'edit') {
        const p: any = job.params || {};
        await setProgress(25);
        // מריץ את אותו מנוע עריכה (saveVersion) — כולל בדיקות גישה/רגישות/לוג, עם משתמש-היוצר.
        const r = await this.media.saveVersion(job.createdById as string, job.fileId as string, p.recipe, p.label);
        resultFileId = r.result.id;
        await setProgress(95);
      } else {
        throw new Error('סוג משימה לא נתמך: ' + job.type);
      }
      await this.prisma.renderJob.update({ where: { id }, data: { status: 'done', progress: 100, resultFileId, finishedAt: new Date() } });
      await this.audit('render.done', job.createdById, id, { type: job.type, resultFileId });
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 500);
      await this.prisma.renderJob.update({ where: { id }, data: { status: 'failed', error: msg, finishedAt: new Date() } });
      await this.audit('render.failed', job.createdById, id, { type: job.type, error: msg.slice(0, 200) });
    }
  }

  // ───────────────────────── עזרי פנים ─────────────────────────

  private dto(j: any) {
    return {
      id: j.id, type: j.type, status: j.status, fileId: j.fileId, progress: j.progress,
      resultFileId: j.resultFileId, error: j.error, createdById: j.createdById,
      createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt,
    };
  }
  private async audit(action: string, userId: string | null, targetId: string, details: any) {
    await this.prisma.auditEvent.create({ data: { action, userId: userId ?? null, targetType: 'render', targetId, details } }).catch(() => undefined);
  }
}

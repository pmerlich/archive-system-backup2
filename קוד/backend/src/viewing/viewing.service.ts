// viewing.service.ts — תשתית צפייה מוגנת (שלב 3.1).
// העיקרון: לעולם לא מגישים את קובץ המקור לצפייה. במקום זה מפיקים "גרסת צפייה" נגזרת —
// תמונה מקודדת מחדש וממוזערת, PDF כעמודי-תמונה, וידאו/שמע מקודדים מחדש — ושומרים אותה במטמון לפי תוכן (hash).
// כל בקשת צפייה דורשת טוקן קצר-מועד (2 דק') שקשור לקובץ+למשתמש+להפעלה, ונבדק מחדש בכל פנייה.
// המקור נשאר נגיש להורדה רק דרך נתיב נפרד עם הרשאת files.download_source — לא דרך כאן.
import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { WatermarkService } from '../watermark/watermark.service';
import { ScopeService } from '../scope/scope.service';
import { AccessService } from '../access/access.service';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
// [שינוי 2026-06-25] bidi-js — סידור דו-כיווני (BiDi) נכון לעברית/מעורב בצריבת סימן המים.
import bidiFactory from 'bidi-js';

const pexec = promisify(execFile);
const bidi = bidiFactory();

const SESSION_TTL_MS = 10 * 60 * 1000; // חלון הפעלת צפייה: 10 דקות
const TOKEN_TTL_SEC = 120; // טוקן קצר-מועד: 2 דקות (נדרש רענון אחריו)
const RENDER_TIMEOUT_FAST = 60_000; // תמונה / עמוד PDF
const RENDER_TIMEOUT_MEDIA = 15 * 60_000; // וידאו / שמע (קידוד מחדש)
const MAX_IMAGE_DIM = 2000; // צד ארוך מרבי לגרסת צפייה של תמונה
const MAX_TEXT_BYTES = 1 << 20; // עד 1MB טקסט לצפייה
const FONT = '/usr/share/fonts/dejavu/DejaVuSans.ttf'; // גופן לצריבת סימן מים (font-dejavu)

export type ViewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'unsupported';

@Injectable()
export class ViewingService implements OnModuleInit {
  private readonly logger = new Logger('ViewingService');
  private readonly filesDir: string;
  private readonly cacheDir: string;
  private readonly secret: string;
  // נעילות בזיכרון כדי לא להפיק את אותה גרסת צפייה פעמיים במקביל
  private readonly inflight = new Map<string, Promise<{ path: string; type: string }>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly watermark: WatermarkService,
    private readonly scope: ScopeService,
    private readonly access: AccessService,
    config: ConfigService,
  ) {
    const storageDir = config.get<string>('storageDir') ?? '/data';
    this.filesDir = path.join(storageDir, 'files');
    this.cacheDir = path.join(storageDir, 'view-cache');
    this.secret = config.get<string>('jwtSecret') as string;
  }

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    this.logger.log(`מטמון צפייה מוגנת: ${this.cacheDir}`);
  }

  // ───────────────────────── סיווג והפעלות ─────────────────────────

  classify(mime?: string | null): ViewKind {
    if (!mime) return 'unsupported';
    if (mime === 'application/pdf') return 'pdf';
    if (mime === 'text/plain') return 'text';
    // SVG אינו עובר דרך מנוע הרינדור (וקטור הזרקה/קריאת-קבצים ידוע ב-ImageMagick) — לא לצפייה מוגנת.
    if (mime === 'image/svg+xml') return 'unsupported';
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'unsupported';
  }

  private blobPath(hash: string): string {
    return path.join(this.filesDir, hash.slice(0, 2), hash);
  }
  private async exists(p: string): Promise<boolean> {
    try { await fs.access(p); return true; } catch { return false; }
  }

  // יצירת הפעלת צפייה: בודק קובץ+הרשאה (בקונטרולר), מסווג, סופר עמודים ל-PDF, ומחזיר טוקן ראשון.
  async createSession(userId: string, fileId: string, ip?: string, userAgent?: string, auth?: { reader?: boolean; device?: string }) {
    const file = await this.prisma.file.findFirst({ where: { id: fileId, deletedAt: null } });
    if (!file) throw new NotFoundException('הקובץ לא נמצא');
    await this.access.assertCanView(userId, fileId, { device: auth?.device }); // הרשאות גישה לפי טווח (3.9)
    const kind = this.classify(file.mimeType);
    if (kind === 'unsupported') throw new BadRequestException('אין צפייה מוגנת לסוג קובץ זה');
    if (!(await this.exists(this.blobPath(file.hash)))) throw new NotFoundException('הקובץ הפיזי חסר');

    // תוכן רגיש (קובץ עם תגית ברמת רגישות HIGH) — ניתן לצפייה רק דרך Archive Reader ממכשיר מאושר.
    const sensitive = await this.isSensitive(fileId);
    await this.assertReaderForSensitive(userId, fileId, auth, sensitive);

    // שלב 3.4 — הגבלות צפייה (מכשיר / חלון זמן / מספר צפיות). אם לקובץ יש הגבלה פעילה — חייבים לעמוד באחת מהן.
    const restrictionId = await this.enforceRestrictionsOnOpen(userId, fileId, auth?.device);

    const pages = kind === 'pdf' ? await this.pdfPageCount(this.blobPath(file.hash)) : 0;

    const session = await this.prisma.viewSession.create({
      data: {
        fileId, userId, kind, pages, restrictionId,
        ip: ip ?? null, userAgent: userAgent ?? null,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        action: 'file.view.opened', userId, targetType: 'file', targetId: fileId,
        details: { sid: session.id, kind, reader: !!auth?.reader, sensitive, restrictionId }, ip: ip ?? null,
      },
    });
    return {
      sid: session.id, kind, pages,
      mimeType: file.mimeType, name: file.name,
      expiresAt: session.expiresAt,
      token: this.mintToken(session.id, fileId, userId),
      tokenExpiresIn: TOKEN_TTL_SEC,
    };
  }

  // רענון הטוקן הקצר — תקף רק כל עוד חלון ההפעלה לא פג/בוטל.
  async refreshToken(userId: string, sid: string, auth?: { reader?: boolean; device?: string }) {
    const s = await this.loadValidSession(userId, sid);
    // ביטול / תפוגה / נעילת-מכשיר תופסים מיד גם ברענון הטוקן (לא רק בבקשת רינדור).
    await this.assertReaderForSensitive(userId, s.fileId, auth);
    await this.recheckRestriction(s.restrictionId, auth?.device);
    return { token: this.mintToken(s.id, s.fileId, s.userId), tokenExpiresIn: TOKEN_TTL_SEC };
  }

  private mintToken(sid: string, fileId: string, userId: string): string {
    return this.jwt.sign(
      { purpose: 'view', sid, fileId, sub: userId },
      { secret: this.secret, expiresIn: TOKEN_TTL_SEC },
    );
  }

  // אימות טוקן צפייה לפני הגשת גרסת צפייה: חתימה תקפה, מטרה=view, תואם לקובץ+למשתמש, וההפעלה תקפה ב-DB.
  async authorizeRendition(userId: string, fileId: string, vt?: string, auth?: { reader?: boolean; device?: string }) {
    if (!vt) throw new ForbiddenException('חסר טוקן צפייה');
    let payload: any;
    try {
      payload = this.jwt.verify(vt, { secret: this.secret, algorithms: ['HS256'] });
    } catch {
      throw new ForbiddenException('טוקן צפייה לא תקין או שפג תוקפו');
    }
    if (payload.purpose !== 'view' || payload.fileId !== fileId || payload.sub !== userId) {
      throw new ForbiddenException('טוקן צפייה לא תואם');
    }
    const s = await this.loadValidSession(userId, payload.sid);
    if (s.fileId !== fileId) throw new ForbiddenException('טוקן צפייה לא תואם לקובץ');
    // בדיקה חוזרת בכל בקשת רינדור (לא רק בפתיחה) — סוגרת עקיפה שבה טוקן צפייה מועבר מ-Reader לדפדפן:
    // תוכן רגיש דורש Reader-ממכשיר-מאושר, והגבלת הצפייה (מכשיר/זמן/ביטול) נאכפת מיד.
    await this.assertReaderForSensitive(userId, fileId, auth);
    await this.recheckRestriction(s.restrictionId, auth?.device);
    await this.access.assertCanView(userId, fileId, { device: auth?.device }); // הרשאות 3.9 — נבדקות מחדש בכל רינדור כך שביטול הענקה/הגבלה נכנס לתוקף מיד
    await this.prisma.viewSession.update({
      where: { id: s.id },
      data: { lastUsedAt: new Date(), viewCount: { increment: 1 } },
    });
    return s;
  }

  // ───────────────────────── חסימת תוכן רגיש + הגבלות צפייה (3.3 + 3.4) ─────────────────────────

  private async isSensitive(fileId: string): Promise<boolean> {
    return (await this.prisma.fileTag.count({ where: { fileId, tag: { sensitivity: 'HIGH' } } })) > 0;
  }

  // תוכן רגיש: רק דרך Archive Reader ממכשיר מאושר. נבדק מול ה-DB בכל קריאה כך שביטול מכשיר תופס מיד.
  private async assertReaderForSensitive(userId: string, fileId: string, auth?: { reader?: boolean; device?: string }, known?: boolean): Promise<void> {
    const sensitive = known !== undefined ? known : await this.isSensitive(fileId);
    if (!sensitive) return;
    const ok = auth?.reader === true && !!auth.device &&
      !!(await this.prisma.device.findFirst({ where: { userId, deviceId: auth.device, approved: true, revokedAt: null } }));
    if (!ok) throw new ForbiddenException('קובץ זה מסומן כרגיש — ניתן לצפות בו רק דרך אפליקציית Archive Reader ממכשיר מאושר');
  }

  // אכיפת הגבלות צפייה בפתיחת הפעלה. מחזיר את מזהה ההגבלה שנוצלה (לספירה/ביטול), או null אם אין הגבלה פעילה לקובץ.
  // אם יש הגבלות אך אף אחת לא מתירה למשתמש/מכשיר כעת — חסום. כשיש מכסה, סופר צפייה אחת אטומית.
  private async enforceRestrictionsOnOpen(userId: string, fileId: string, device?: string): Promise<string | null> {
    const all = await this.prisma.viewRestriction.findMany({ where: { fileId, active: true } });
    if (all.length === 0) return null; // הקובץ אינו מוגבל — התנהגות רגילה
    const now = Date.now();

    // "קבוצת ההגבלות השולטת" — לפי הסקופ הספציפי ביותר שמכוון למשתמש הזה:
    // אם קיימת הגבלה אישית למשתמש — רק היא שולטת (הגבלה כללית לא "מרככת" מכסה אישית שמוצתה);
    // אחרת — ההגבלות הכלליות (userId=null) שולטות. הגבלה של משתמש אחר אינה חלה על משתמש זה.
    const userScoped = all.filter((r) => r.userId === userId);
    const governing = userScoped.length > 0 ? userScoped : all.filter((r) => r.userId === null);
    if (governing.length === 0) {
      throw new ForbiddenException('הגישה לקובץ זה מוגבלת — אין לך היתר צפייה בקובץ זה');
    }

    // בתוך הקבוצה השולטת — חייבים לעמוד בתנאי של לפחות הגבלה אחת (מכשיר + חלון זמן + מכסה).
    // הערה: deviceId=null פירושו "ללא הגבלת מכשיר" (כל מכשיר, כולל דפדפן); נעילה למכשיר נעשית בהצבת deviceId מפורש.
    const usable = (r: any) =>
      (r.expiresAt === null || new Date(r.expiresAt).getTime() > now) &&
      (r.deviceId === null || r.deviceId === device) &&
      (r.maxViews === null || r.viewsUsed < r.maxViews);
    const satisfiable = governing.filter(usable);
    if (satisfiable.length === 0) {
      throw new ForbiddenException('הגישה לקובץ זה מוגבלת — אינך עומד בתנאי הצפייה (מכשיר / חלון זמן / מספר צפיות), או שהגישה בוטלה');
    }

    // סופרים מול ההגבלה ההדוקה ביותר (הכי מעט צפיות שנותרו) כדי לכבד את המכסה הקטנה ביותר.
    satisfiable.sort((a, b) => {
      const ra = a.maxViews === null ? Number.POSITIVE_INFINITY : a.maxViews - a.viewsUsed;
      const rb = b.maxViews === null ? Number.POSITIVE_INFINITY : b.maxViews - b.viewsUsed;
      return ra - rb;
    });
    const chosen = satisfiable[0];
    if (chosen.maxViews !== null) {
      // ספירה אטומית: מגדילים רק אם עוד נשארה מכסה (מונע מרוץ של שתי פתיחות בו-זמנית).
      const claim = await this.prisma.viewRestriction.updateMany({
        where: { id: chosen.id, active: true, viewsUsed: { lt: chosen.maxViews } },
        data: { viewsUsed: { increment: 1 } },
      });
      if (claim.count === 0) throw new ForbiddenException('מכסת הצפיות לקובץ זה נוצלה');
    } else {
      await this.prisma.viewRestriction.update({ where: { id: chosen.id }, data: { viewsUsed: { increment: 1 } } });
    }
    return chosen.id;
  }

  // בדיקה חוזרת בכל בקשת רינדור של ההגבלה שתחתיה נפתחה ההפעלה — ביטול/תפוגה/נעילת-מכשיר תופסים מיד. לא מונה צפייה נוספת.
  private async recheckRestriction(restrictionId: string | null | undefined, device?: string): Promise<void> {
    if (!restrictionId) return;
    const r = await this.prisma.viewRestriction.findUnique({ where: { id: restrictionId } });
    if (!r || !r.active || r.revokedAt) throw new ForbiddenException('הגישה לקובץ זה בוטלה');
    if (r.expiresAt && new Date(r.expiresAt).getTime() < Date.now()) throw new ForbiddenException('חלון הזמן לצפייה בקובץ זה פג');
    if (r.deviceId && r.deviceId !== device) throw new ForbiddenException('צפייה בקובץ זה מוגבלת למכשיר אחר');
  }

  private async loadValidSession(userId: string, sid: string) {
    const s = sid ? await this.prisma.viewSession.findUnique({ where: { id: sid } }) : null;
    if (!s || s.userId !== userId) throw new ForbiddenException('הפעלת צפייה לא נמצאה');
    if (s.revokedAt) throw new ForbiddenException('הצפייה בוטלה');
    if (s.expiresAt.getTime() < Date.now()) throw new ForbiddenException('הפעלת הצפייה פגה');
    return s;
  }

  // ───────────────────────── הפקת גרסאות צפייה ─────────────────────────

  private async fileOrThrow(fileId: string) {
    const f = await this.prisma.file.findFirst({ where: { id: fileId, deletedAt: null } });
    if (!f) throw new NotFoundException('הקובץ לא נמצא');
    if (!(await this.exists(this.blobPath(f.hash)))) throw new NotFoundException('הקובץ הפיזי חסר');
    return f;
  }

  // מפיק-או-מחזיר-ממטמון, עם נעילה למניעת הפקה כפולה במקביל.
  private async cached(key: string, out: string, type: string, produce: (tmp: string) => Promise<void>) {
    if (await this.exists(out)) return { path: out, type };
    const existing = this.inflight.get(out);
    if (existing) return existing;
    const job = (async () => {
      await fs.mkdir(path.dirname(out), { recursive: true });
      const tmp = `${out}.tmp-${process.pid}-${Date.now()}`;
      try {
        await produce(tmp);
        await fs.rename(tmp, out);
      } finally {
        await fs.rm(tmp, { force: true }).catch(() => undefined);
      }
      return { path: out, type };
    })();
    this.inflight.set(out, job);
    try { return await job; } finally { this.inflight.delete(out); }
  }

  async renderImage(fileId: string) {
    const f = await this.fileOrThrow(fileId);
    if (this.classify(f.mimeType) !== 'image') throw new BadRequestException('הקובץ אינו תמונה');
    const out = path.join(this.cacheDir, f.hash, 'view.jpg');
    return this.cached('img', out, 'image/jpeg', async (tmp) => {
      // [0] = הפריים הראשון (GIF/TIFF מרובי-פריימים); -strip מסיר מטא-דאטה; ממוזער ומקודד מחדש ל-JPEG.
      await pexec('magick', [
        `${this.blobPath(f.hash)}[0]`, '-auto-orient',
        '-resize', `${MAX_IMAGE_DIM}x${MAX_IMAGE_DIM}>`, '-strip', '-quality', '82', `JPEG:${tmp}`,
      ], { timeout: RENDER_TIMEOUT_FAST });
    });
  }

  async renderPdfPage(fileId: string, n: number) {
    const f = await this.fileOrThrow(fileId);
    if (this.classify(f.mimeType) !== 'pdf') throw new BadRequestException('הקובץ אינו PDF');
    const total = await this.pdfPageCount(this.blobPath(f.hash));
    if (!Number.isInteger(n) || n < 1 || n > total) throw new BadRequestException('מספר עמוד לא תקין');
    const out = path.join(this.cacheDir, f.hash, `page-${n}.png`);
    return this.cached('pdf', out, 'image/png', async (tmp) => {
      const prefix = `${tmp}-pp`;
      // pdftoppm יוצר <prefix>.png; ממירים את העמוד הבודד לתמונה (לא חושף את ה-PDF המקורי).
      await pexec('pdftoppm', [
        '-png', '-r', '110', '-f', String(n), '-l', String(n), '-singlefile', this.blobPath(f.hash), prefix,
      ], { timeout: RENDER_TIMEOUT_FAST });
      await fs.rename(`${prefix}.png`, tmp);
    });
  }

  async renderVideo(fileId: string) {
    const f = await this.fileOrThrow(fileId);
    if (this.classify(f.mimeType) !== 'video') throw new BadRequestException('הקובץ אינו וידאו');
    const out = path.join(this.cacheDir, f.hash, 'view.mp4');
    return this.cached('video', out, 'video/mp4', async (tmp) => {
      await pexec('ffmpeg', [
        '-y', '-i', this.blobPath(f.hash),
        '-vf', "scale='min(854,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', tmp,
      ], { timeout: RENDER_TIMEOUT_MEDIA });
    });
  }

  async renderAudio(fileId: string) {
    const f = await this.fileOrThrow(fileId);
    if (this.classify(f.mimeType) !== 'audio') throw new BadRequestException('הקובץ אינו שמע');
    const out = path.join(this.cacheDir, f.hash, 'view.mp3');
    return this.cached('audio', out, 'audio/mpeg', async (tmp) => {
      await pexec('ffmpeg', [
        '-y', '-i', this.blobPath(f.hash), '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', tmp,
      ], { timeout: RENDER_TIMEOUT_MEDIA });
    });
  }

  async renderText(fileId: string): Promise<{ data: Buffer; type: string }> {
    const f = await this.fileOrThrow(fileId);
    if (this.classify(f.mimeType) !== 'text') throw new BadRequestException('הקובץ אינו טקסט');
    const buf = await fs.readFile(this.blobPath(f.hash));
    return { data: buf.subarray(0, MAX_TEXT_BYTES), type: 'text/plain; charset=utf-8' };
  }

  // ───────────────────────── צפייה עם צריבת סימן מים (שלב 3.2) ─────────────────────────
  // נקודות הכניסה שהקונטרולר קורא להן: מפיקות את גרסת-הבסיס (3.1) וצורבות עליה את סימן המים הפעיל.
  // אם אין תבנית פעילה — מוחזרת גרסת-הבסיס כמות שהיא (ללא סימן מים).

  async viewImage(s: any, wm?: any): Promise<{ buffer?: Buffer; path?: string; type: string }> {
    const base = await this.renderImage(s.fileId);
    return this.applyImageWatermark(base.path, base.type, s, wm);
  }

  async viewPdfPage(s: any, n: number, wm?: any): Promise<{ buffer?: Buffer; path?: string; type: string }> {
    const base = await this.renderPdfPage(s.fileId, n);
    return this.applyImageWatermark(base.path, base.type, s, wm);
  }

  async viewVideo(s: any, wm?: any): Promise<{ path: string; type: string }> {
    const base = await this.renderVideo(s.fileId);
    return this.applyVideoWatermark(base.path, s, wm);
  }

  async viewAudio(s: any): Promise<{ path: string; type: string }> {
    return this.renderAudio(s.fileId); // אין צריבה חזותית לשמע (אין תמונה)
  }

  async viewText(s: any): Promise<{ data: Buffer; type: string }> {
    return this.renderText(s.fileId);
  }

  // צריבת כל שכבות סימן המים החלות על הקובץ, על תמונה / עמוד-PDF. מוחזר Buffer (אישי, לא נשמר במטמון).
  private async applyImageWatermark(basePath: string, baseType: string, s: any, wm?: any): Promise<{ buffer?: Buffer; path?: string; type: string }> {
    const tpls = await this.resolveTemplates(s.fileId, wm);
    if (!tpls.length) return { path: basePath, type: baseType };
    const dim = await this.imageDims(basePath);
    const coder = baseType === 'image/png' ? 'PNG' : 'JPEG';
    const rnd = `${s.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const layer = path.join('/tmp', `wmlayer-${rnd}.png`);
    const outPath = path.join('/tmp', `wmout-${rnd}.${coder.toLowerCase()}`);
    try {
      await this.buildCombinedLayer(dim.w, dim.h, tpls, s, layer);
      await pexec('magick', [basePath, layer, '-compose', 'over', '-composite', `${coder}:${outPath}`], { timeout: RENDER_TIMEOUT_FAST });
      const buffer = await fs.readFile(outPath);
      return { buffer, type: baseType };
    } finally {
      await fs.rm(layer, { force: true }).catch(() => undefined);
      await fs.rm(outPath, { force: true }).catch(() => undefined);
    }
  }

  // צריבת שכבות סימן המים על וידאו (overlay). נשמר במטמון לפי הפעלה (sid) כי הוא אישי.
  private async applyVideoWatermark(basePath: string, s: any, wm?: any): Promise<{ path: string; type: string }> {
    const tpls = await this.resolveTemplates(s.fileId, wm);
    if (!tpls.length) return { path: basePath, type: 'video/mp4' };
    const out = path.join(this.cacheDir, 'wm', `${s.id}.mp4`);
    return this.cached('wmvideo', out, 'video/mp4', async (tmp) => {
      const dim = await this.videoDims(basePath);
      const layer = `${tmp}.wm.png`;
      try {
        // [שינוי 2026-06-25] תנועה גמישה (ציר/כיוון/מהירות) והבהוב (מחזור/משך) — לתבנית יחידה; אחרת שכבה מאוחדת סטטית.
        const t0 = tpls[0];
        if (tpls.length === 1 && t0.motion && t0.kind !== 'image') {
          await this.buildWatermarkLabel(await this.resolveText(t0, s), t0, layer);
          const sp = Math.min(2000, Math.max(10, Math.round(Number(t0.motionSpeed) || 120)));
          const dir = Number(t0.motionDir) < 0 ? -1 : 1;
          let xy: string;
          if (t0.motionAxis === 'y') {
            const ye = dir === 1 ? `mod(t*${sp}\\,main_h+overlay_h)-overlay_h` : `main_h-mod(t*${sp}\\,main_h+overlay_h)`;
            xy = `x=(main_w-overlay_w)/2:y='${ye}'`;
          } else {
            const xe = dir === 1 ? `mod(t*${sp}\\,main_w+overlay_w)-overlay_w` : `main_w-mod(t*${sp}\\,main_w+overlay_w)`;
            xy = `x='${xe}':y=(main_h-overlay_h)/2`;
          }
          await pexec('ffmpeg', ['-y', '-i', basePath, '-i', layer, '-filter_complex', `[0][1]overlay=${xy}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'copy', '-movflags', '+faststart', '-f', 'mp4', tmp], { timeout: RENDER_TIMEOUT_MEDIA });
        } else if (tpls.length === 1 && t0.blink) {
          await this.buildCombinedLayer(dim.w, dim.h, [t0], s, layer);
          const interval = Math.min(60, Math.max(0.5, Number(t0.blinkInterval) || 5));
          const on = Math.min(interval, Math.max(0.2, Number(t0.blinkOn) || 1.5));
          await pexec('ffmpeg', ['-y', '-i', basePath, '-i', layer, '-filter_complex', `[0][1]overlay=0:0:enable='lt(mod(t\\,${interval})\\,${on})'`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'copy', '-movflags', '+faststart', '-f', 'mp4', tmp], { timeout: RENDER_TIMEOUT_MEDIA });
        } else {
          await this.buildCombinedLayer(dim.w, dim.h, tpls, s, layer);
          await pexec('ffmpeg', ['-y', '-i', basePath, '-i', layer, '-filter_complex', '[0][1]overlay=0:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'copy', '-movflags', '+faststart', '-f', 'mp4', tmp], { timeout: RENDER_TIMEOUT_MEDIA });
        }
      } finally {
        await fs.rm(layer, { force: true }).catch(() => undefined);
      }
    });
  }

  // בוחר אילו תבניות לצרוב: null=ללא; מערך=השתמש בו (שיתוף); undefined=חשב לפי הטווח של הקובץ (פנימי).
  private async resolveTemplates(fileId: string, wm?: any): Promise<any[]> {
    if (wm === null) return [];
    if (Array.isArray(wm)) return wm;
    const ctx = await this.scope.fileContext(fileId);
    return ctx ? this.watermark.applicableFor(ctx) : [];
  }

  // מאחד את כל השכבות (טקסט/לוגו) לכדי תמונת-מים שקופה אחת בגודל WxH.
  private async buildCombinedLayer(W: number, H: number, tpls: any[], s: any, out: string): Promise<void> {
    const layers: string[] = [];
    try {
      for (const t of tpls) {
        const lp = `${out}.l${layers.length}.png`;
        if (t.kind === 'image' && t.imagePath) await this.buildLogoLayer(W, H, t, lp);
        else await this.buildWatermarkPng(W, H, await this.resolveText(t, s), t, lp);
        layers.push(lp);
      }
      const args: string[] = ['-size', `${W}x${H}`, 'xc:none'];
      for (const lp of layers) args.push(lp, '-composite');
      args.push(`PNG:${out}`);
      await pexec('magick', args, { timeout: RENDER_TIMEOUT_FAST });
    } finally {
      for (const lp of layers) await fs.rm(lp, { force: true }).catch(() => undefined);
    }
  }

  private gravity(position: string): string {
    switch (position) {
      case 'top-left': return 'NorthWest';
      case 'top-right': return 'NorthEast';
      case 'bottom-left': return 'SouthWest';
      case 'bottom-right': return 'SouthEast';
      default: return 'Center';
    }
  }

  // שכבת לוגו/תמונה בגודל WxH, ממוקמת לפי position בשקיפות opacity.
  private async buildLogoLayer(W: number, H: number, t: any, out: string): Promise<void> {
    const side = Math.max(8, Math.round(Math.min(W, H) * (Number(t.imageScale) || 0.25)));
    const op = Math.min(1, Math.max(0, Number(t.opacity)));
    await pexec('magick', [
      '-size', `${W}x${H}`, 'xc:none',
      '(', t.imagePath, '-resize', `${side}x${side}`, '-alpha', 'on', '-channel', 'A', '-evaluate', 'multiply', String(op), '+channel', ')',
      '-gravity', this.gravity(t.position), '-geometry', '+24+24', '-compose', 'over', '-composite', `PNG:${out}`,
    ], { timeout: RENDER_TIMEOUT_FAST });
  }

  // שכבת-טקסט שקופה בגודל WxH (tiled / center / פינות, עם זווית/שקיפות/צבע/קו-מתאר).
  private async buildWatermarkPng(W: number, H: number, text: string, t: any, outPng: string): Promise<void> {
    const rgba = this.hexToRgba(t.color, t.opacity);
    const size = String(t.fontSize);
    const fillStroke = ['-fill', rgba, ...(t.outline ? ['-stroke', '#000000', '-strokewidth', '1'] : [])];
    if (t.position === 'tiled') {
      const sideD = Math.ceil(Math.sqrt(W * W + H * H)) + 4;
      await pexec('magick', [
        '-background', 'none', '-font', FONT, '-pointsize', size, ...fillStroke,
        `label:${text}`, '-bordercolor', 'none', '-border', String(Math.min(400, Math.max(0, Math.round(Number(t.tileGap ?? 28))))), // [שינוי 2026-06-25] מרחק חזרות
        '-write', 'mpr:tile', '+delete',
        '-size', `${sideD}x${sideD}`, 'tile:mpr:tile',
        '-rotate', String(t.angle),
        '-gravity', 'center', '-background', 'none', '-extent', `${W}x${H}`,
        `PNG:${outPng}`,
      ], { timeout: RENDER_TIMEOUT_FAST });
    } else {
      await pexec('magick', [
        '-background', 'none', '-font', FONT, '-pointsize', size, ...fillStroke,
        `label:${text}`, '-rotate', String(t.angle), '-bordercolor', 'none', '-border', '18',
        '-background', 'none', '-gravity', this.gravity(t.position), '-extent', `${W}x${H}`,
        `PNG:${outPng}`,
      ], { timeout: RENDER_TIMEOUT_FAST });
    }
  }

  // תווית בודדת (לא במלוא הפריים) — לסימן מים נע בווידאו.
  private async buildWatermarkLabel(text: string, t: any, outPng: string): Promise<void> {
    const rgba = this.hexToRgba(t.color, Math.max(t.opacity, 0.35));
    await pexec('magick', [
      '-background', 'none', '-font', FONT, '-pointsize', String(t.fontSize), '-fill', rgba,
      `label:${text}`, '-rotate', String(t.angle), `PNG:${outPng}`,
    ], { timeout: RENDER_TIMEOUT_FAST });
  }

  // החלפת המשתנים האישיים בתבנית בערכים של ההפעלה הנוכחית.
  private async resolveText(t: any, s: any): Promise<string> {
    const u = s.userId ? await this.prisma.user.findUnique({ where: { id: s.userId }, select: { name: true, email: true } }) : null;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const map: Record<string, string> = {
      '{name}': u?.name ?? s.subjectName ?? '',
      '{email}': u?.email ?? s.subjectEmail ?? '',
      '{datetime}': `${date} ${time}`,
      '{date}': date,
      '{time}': time,
      '{viewid}': String(s.id).slice(0, 8),
      '{ip}': this.partialIp(s.ip),
    };
    let out = t.text || '{email} · {datetime}';
    for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
    out = out.slice(0, 200) || ' ';
    out = this.bidiVisual(out); // [שינוי 2026-06-25] סידור דו-כיווני נכון (bidi-js) במקום היפוך ידני שגוי
    // אבטחה: ב-label של ImageMagick, '@' בתחילת המחרוזת = קריאה מקובץ. מנטרלים בהוספת רווח מוביל.
    if (/^[@~]/.test(out)) out = ' ' + out;
    return out;
  }

  // [שינוי 2026-06-25] סידור דו-כיווני מלא (UAX#9) דרך bidi-js: מסדר לוגי -> סדר חזותי,
  // כך ש-label: (שמצייר משמאל-לימין) מציג עברית ומעורב (עברית+אנגלית+מספרים) נכון.
  private bidiVisual(s: string): string {
    try {
      const levels = bidi.getEmbeddingLevels(s);
      const segments = bidi.getReorderSegments(s, levels);
      const chars = [...s];
      for (const [start, end] of segments) {
        const slice = chars.slice(start, end + 1).reverse();
        for (let i = start; i <= end; i++) chars[i] = slice[i - start];
      }
      const mirror = bidi.getMirroredCharactersMap(s, levels);
      if (mirror) for (const [i, ch] of mirror) chars[i] = ch;
      return chars.join('');
    } catch {
      return s; // נפילה בטוחה: אם משהו משתבש, מחזירים את הטקסט כמות שהוא
    }
  }

  // IP חלקי (פרטיות): מסתיר את המנה האחרונה.
  private partialIp(ip: string | null): string {
    if (!ip) return '';
    const v = ip.replace(/^::ffff:/, '');
    if (v.includes('.')) { const p = v.split('.'); p[p.length - 1] = 'x'; return p.join('.'); }
    if (v.includes(':')) { const p = v.split(':').filter(Boolean); return p.slice(0, 3).join(':') + ':*'; }
    return v;
  }

  private hexToRgba(hex: string, opacity: number): string {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '#ffffff');
    const r = m ? parseInt(m[1], 16) : 255, g = m ? parseInt(m[2], 16) : 255, b = m ? parseInt(m[3], 16) : 255;
    const a = Math.min(1, Math.max(0, Number(opacity)));
    return `rgba(${r},${g},${b},${a})`;
  }

  private async imageDims(p: string): Promise<{ w: number; h: number }> {
    try { const { stdout } = await pexec('magick', ['identify', '-format', '%w %h', `${p}[0]`], { timeout: 30_000 }); const [w, h] = stdout.trim().split(/\s+/).map((x) => parseInt(x, 10)); return { w: w || 1000, h: h || 1000 }; } catch { return { w: 1000, h: 1000 }; }
  }

  private async videoDims(p: string): Promise<{ w: number; h: number }> {
    try { const { stdout } = await pexec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', p], { timeout: 30_000 }); const [w, h] = stdout.trim().split('x').map((n) => parseInt(n, 10)); return { w: w || 854, h: h || 480 }; } catch { return { w: 854, h: 480 }; }
  }

  // מספר עמודים ל-PDF לפי hash — לשימוש מודול השיתוף (שלב 3.5).
  async pdfPagesPublic(hash: string): Promise<number> {
    return this.pdfPageCount(this.blobPath(hash));
  }

  private async pdfPageCount(src: string): Promise<number> {
    try {
      const { stdout } = await pexec('pdfinfo', [src], { timeout: 30_000 });
      const m = stdout.match(/Pages:\s+(\d+)/);
      return m ? Math.max(1, parseInt(m[1], 10)) : 1;
    } catch {
      return 1;
    }
  }
}

// media.service.ts — מנוע עריכת תמונות לא-הרסנית (שלב 4.1).
// עיקרון-העל: המקור קדוש — קוראים את הבלוק של קובץ המקור בלבד, אף פעם לא כותבים עליו.
// כל עריכה נשמרת כ"מתכון" (רשימת פעולות מנוקה) + קובץ נגזר חדש (source='edit') המקושר למקור דרך MediaEditVersion.
// כל קריאה ל-ImageMagick נעשית דרך execFile עם מערך ארגומנטים (ללא shell) — אין הזרקת פקודות.
import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { ViewingService } from '../viewing/viewing.service';
import { AccessService } from '../access/access.service';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const pexec = promisify(execFile);
const RENDER_TIMEOUT = 60_000; // החלת מתכון על תמונה
const PREVIEW_DIM = 1400; // צד ארוך מרבי לתצוגה מקדימה (מהיר; לא נשמר)
const MAX_OUTPUT_DIM = 12000; // תקרת רוחב/גובה לתוצר (מונע פיצוץ זיכרון)
const MAX_RECIPE = 50; // תקרת מספר פעולות במתכון
const MAX_REDACT = 20; // תקרת מספר אזורי טשטוש/פיקסול/כיסוי
const MAX_OVERLAY = 60; // תקרת סך פעולות-שכבה (אזורים + סימונים)
// מפת פונטים מאובטחת: הלקוח שולח מַפְתֵּחַ בלבד (לא נתיב), והשרת ממפה לקובץ מרשימת-היתר קבועה → אין הזרקת-נתיב.
const FONTS: Record<string, string> = {
  sans: '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  bold: '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  serif: '/usr/share/fonts/dejavu/DejaVuSerif.ttf',
  mono: '/usr/share/fonts/dejavu/DejaVuSansMono.ttf',
  hebrew: '/usr/share/fonts/noto/NotoSansHebrew-Regular.ttf',
  'hebrew-bold': '/usr/share/fonts/noto/NotoSansHebrew-Bold.ttf',
  'hebrew-serif': '/usr/share/fonts/noto/NotoSerifHebrew-Regular.ttf',
};
const FONT = FONTS.sans; // ברירת מחדל (גם לסימן מים)

// סוג פעולה מנוקה במתכון.
type Op =
  | { op: 'crop'; x: number; y: number; w: number; h: number }
  | { op: 'rotate'; deg: 90 | 180 | 270 }
  | { op: 'flip'; axis: 'h' | 'v' }
  | { op: 'resize'; scalePct: number }
  | { op: 'brightness'; value: number }
  | { op: 'contrast'; value: number }
  | { op: 'sharpen'; value: number }
  | { op: 'grayscale' }
  | { op: 'redact'; shape: 'rect' | 'ellipse' | 'polygon'; mode: 'blur' | 'pixelate' | 'cover'; strength: number; color: string; feather: number; invert: boolean; x?: number; y?: number; w?: number; h?: number; points?: { x: number; y: number }[] }
  | { op: 'text'; x: number; y: number; value: string; color: string; size: number; font: string }
  | { op: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { op: 'frame'; x: number; y: number; w: number; h: number; color: string; width: number }
  | { op: 'watermark'; text: string }
  | { op: 'strip' };

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger('MediaService');
  private readonly filesDir: string;
  private readonly tmpDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly viewing: ViewingService,
    private readonly access: AccessService,
    config: ConfigService,
  ) {
    const storageDir = config.get<string>('storageDir') ?? '/data';
    this.filesDir = path.join(storageDir, 'files');
    this.tmpDir = path.join(storageDir, 'edit-tmp'); // באותו volume של files → rename מהיר לאחסון
  }

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.tmpDir, { recursive: true });
    this.logger.log(`עריכת מדיה — תיקיית עיבוד זמני: ${this.tmpDir}`);
  }

  private blobPath(hash: string): string {
    return path.join(this.filesDir, hash.slice(0, 2), hash);
  }
  private async exists(p: string): Promise<boolean> {
    try { await fs.access(p); return true; } catch { return false; }
  }

  // סוגי תמונה שמותר לערוך (תואם detectMime). רשימת-היתר מפורשת — SVG וכל סוג אחר נחסמים
  // (וקטור קריאת-קבצים/SSRF ב-ImageMagick), בלי להסתמך רק על classify().
  private static readonly EDITABLE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

  // תוכן רגיש (תגית HIGH) — אין עריכה/היסטוריית-עריכה בדפדפן (כמו צפייה: רק דרך Archive Reader). חוסם דליפת גרסת-מקור.
  private async assertNotSensitive(fileId: string): Promise<void> {
    const sensitive = (await this.prisma.fileTag.count({ where: { fileId, tag: { sensitivity: 'HIGH' } } })) > 0;
    if (sensitive) throw new ForbiddenException('קובץ רגיש — לא ניתן לעריכה בדפדפן בשלב זה');
  }

  // טוען קובץ מקור לעריכה: קיים, סוג-תמונה מותר, לא רגיש, ובטווח ההרשאה של המשתמש.
  private async imageFileOrThrow(userId: string, fileId: string) {
    const f = await this.prisma.file.findFirst({ where: { id: fileId, deletedAt: null } });
    if (!f) throw new NotFoundException('הקובץ לא נמצא');
    if (!MediaService.EDITABLE_MIME.includes(f.mimeType ?? '')) throw new BadRequestException('כרגע ניתן לערוך תמונות (PNG/JPEG/GIF/WebP) בלבד');
    if (!(await this.exists(this.blobPath(f.hash)))) throw new NotFoundException('הקובץ הפיזי חסר');
    await this.access.assertCanView(userId, fileId); // הרשאות גישה לפי טווח (3.9) — עורך מוגבל-טווח לא יערוך קובץ מחוץ להיתר שלו
    await this.assertNotSensitive(fileId);
    return f;
  }

  // ───────────────────────── ניקוי המתכון ─────────────────────────
  // כל פעולה מנוקה: שם-פעולה מרשימת-היתר + מספרים מוגבלים לטווח. לא-מוכר/לא-חוקי → מושמט.
  // אכיפה בסדר קנוני קבוע (חיתוך→סיבוב→היפוך→שינוי-גודל→בהירות→ניגודיות→חידוד→ש-ל), פעולה אחת מכל סוג (האחרונה).
  sanitizeRecipe(recipe: any): Op[] {
    if (!Array.isArray(recipe)) throw new BadRequestException('מתכון לא תקין');
    const raw = recipe.slice(0, MAX_RECIPE);
    const num = (v: any) => (typeof v === 'number' && isFinite(v) ? v : NaN);
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const byType = new Map<string, Op>();
    const redactList: Op[] = [];
    let stripMeta = false;
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      switch (item.op) {
        case 'crop': {
          let x = num(item.x), y = num(item.y), w = num(item.w), h = num(item.h);
          if ([x, y, w, h].some((n) => Number.isNaN(n))) break;
          x = clamp(x, 0, 1); y = clamp(y, 0, 1);
          w = clamp(w, 0, 1 - x); h = clamp(h, 0, 1 - y);
          if (w < 0.02 || h < 0.02) break; // חיתוך זעיר מדי — מתעלמים
          byType.set('crop', { op: 'crop', x, y, w, h });
          break;
        }
        case 'rotate': {
          const d = num(item.deg);
          if (d === 90 || d === 180 || d === 270) byType.set('rotate', { op: 'rotate', deg: d as 90 | 180 | 270 });
          break;
        }
        case 'flip': {
          if (item.axis === 'h' || item.axis === 'v') byType.set('flip:' + item.axis, { op: 'flip', axis: item.axis });
          break;
        }
        case 'resize': {
          const s = num(item.scalePct);
          if (!Number.isNaN(s)) { const sc = clamp(s, 1, 400); if (Math.abs(sc - 100) >= 1) byType.set('resize', { op: 'resize', scalePct: sc }); }
          break;
        }
        case 'brightness': {
          const v = num(item.value); if (!Number.isNaN(v)) { const c = clamp(v, -100, 100); if (c !== 0) byType.set('brightness', { op: 'brightness', value: c }); }
          break;
        }
        case 'contrast': {
          const v = num(item.value); if (!Number.isNaN(v)) { const c = clamp(v, -100, 100); if (c !== 0) byType.set('contrast', { op: 'contrast', value: c }); }
          break;
        }
        case 'sharpen': {
          const v = num(item.value); if (!Number.isNaN(v)) { const c = clamp(v, 0, 100); if (c > 0) byType.set('sharpen', { op: 'sharpen', value: c }); }
          break;
        }
        case 'grayscale': { byType.set('grayscale', { op: 'grayscale' }); break; }
        case 'redact': {
          if (redactList.length >= MAX_REDACT) break;
          const mode = ['blur', 'pixelate', 'cover'].includes(item.mode) ? item.mode : 'blur';
          const shape = ['rect', 'ellipse', 'polygon'].includes(item.shape) ? item.shape : 'rect';
          const sRaw = num(item.strength);
          const strength = clamp(Number.isNaN(sRaw) ? (mode === 'cover' ? 100 : 50) : sRaw, 1, 100);
          const color = /^#[0-9a-fA-F]{6}$/.test(item.color) ? String(item.color) : '#000000';
          // [שינוי 2026-06-25] ריכוך מדורג (feather) + היפוך בחירה (invert)
          const fRaw = num(item.feather);
          const feather = clamp(Number.isNaN(fRaw) ? 0 : fRaw, 0, 100);
          const invert = item.invert === true;
          if (shape === 'polygon') {
            const pts = Array.isArray(item.points)
              ? item.points.slice(0, 60).map((pt: any) => ({ x: clamp(num(pt?.x), 0, 1), y: clamp(num(pt?.y), 0, 1) })).filter((pt: any) => !Number.isNaN(pt.x) && !Number.isNaN(pt.y))
              : [];
            if (pts.length < 3) break;
            redactList.push({ op: 'redact', shape: 'polygon', mode: mode as any, strength, color, feather, invert, points: pts });
          } else {
            let x = num(item.x), y = num(item.y), w = num(item.w), h = num(item.h);
            if ([x, y, w, h].some((n) => Number.isNaN(n))) break;
            x = clamp(x, 0, 1); y = clamp(y, 0, 1); w = clamp(w, 0, 1 - x); h = clamp(h, 0, 1 - y);
            if (w < 0.01 || h < 0.01) break;
            redactList.push({ op: 'redact', shape: shape as any, mode: mode as any, strength, color, feather, invert, x, y, w, h });
          }
          break;
        }
        case 'text': {
          if (redactList.length >= MAX_OVERLAY) break;
          const value = this.cleanText(item.value);
          const x = clamp(num(item.x), 0, 1), y = clamp(num(item.y), 0, 1);
          if (!value || Number.isNaN(x) || Number.isNaN(y)) break;
          const color = /^#[0-9a-fA-F]{6}$/.test(item.color) ? String(item.color) : '#ff2d2d';
          const sz = num(item.size); const size = clamp(Number.isNaN(sz) ? 28 : sz, 8, 200);
          const font = (typeof item.font === 'string' && FONTS[item.font]) ? item.font : 'sans'; // מפתח מרשימת-היתר בלבד
          redactList.push({ op: 'text', x, y, value, color, size, font });
          break;
        }
        case 'arrow': {
          if (redactList.length >= MAX_OVERLAY) break;
          const x1 = clamp(num(item.x1), 0, 1), y1 = clamp(num(item.y1), 0, 1);
          const x2 = clamp(num(item.x2), 0, 1), y2 = clamp(num(item.y2), 0, 1);
          if ([x1, y1, x2, y2].some((n) => Number.isNaN(n))) break;
          if (Math.abs(x1 - x2) < 0.01 && Math.abs(y1 - y2) < 0.01) break;
          const color = /^#[0-9a-fA-F]{6}$/.test(item.color) ? String(item.color) : '#ff2d2d';
          const wn = num(item.width); const width = clamp(Number.isNaN(wn) ? 4 : wn, 1, 40);
          redactList.push({ op: 'arrow', x1, y1, x2, y2, color, width });
          break;
        }
        case 'frame': {
          if (redactList.length >= MAX_OVERLAY) break;
          let x = num(item.x), y = num(item.y), w = num(item.w), h = num(item.h);
          if ([x, y, w, h].some((n) => Number.isNaN(n))) break;
          x = clamp(x, 0, 1); y = clamp(y, 0, 1); w = clamp(w, 0, 1 - x); h = clamp(h, 0, 1 - y);
          if (w < 0.01 || h < 0.01) break;
          const color = /^#[0-9a-fA-F]{6}$/.test(item.color) ? String(item.color) : '#ff2d2d';
          const wn = num(item.width); const width = clamp(Number.isNaN(wn) ? 4 : wn, 1, 40);
          redactList.push({ op: 'frame', x, y, w, h, color, width });
          break;
        }
        case 'watermark': {
          if (redactList.length >= MAX_OVERLAY) break;
          const text = this.cleanText(item.text);
          if (text) redactList.push({ op: 'watermark', text });
          break;
        }
        case 'strip': { stripMeta = true; break; }
        default: break;
      }
    }
    const order = ['crop', 'rotate', 'flip:h', 'flip:v', 'resize', 'brightness', 'contrast', 'sharpen', 'grayscale'];
    const geom = order.filter((t) => byType.has(t)).map((t) => byType.get(t) as Op);
    return [...geom, ...redactList, ...(stripMeta ? [{ op: 'strip' } as Op] : [])];
  }

  // בונה את ארגומנטי ImageMagick מהמתכון. החיתוך מתורגם לפיקסלים לפי מידות המקור.
  private recipeArgs(ops: Op[], dim: { w: number; h: number }): string[] {
    const args: string[] = [];
    for (const op of ops) {
      switch (op.op) {
        case 'crop': {
          const pw = Math.max(1, Math.round(op.w * dim.w));
          const ph = Math.max(1, Math.round(op.h * dim.h));
          const px = Math.round(op.x * dim.w);
          const py = Math.round(op.y * dim.h);
          args.push('-crop', `${pw}x${ph}+${px}+${py}`, '+repage');
          break;
        }
        case 'rotate': args.push('-rotate', String(op.deg)); break;
        case 'flip': args.push(op.axis === 'h' ? '-flop' : '-flip'); break;
        case 'resize': args.push('-resize', `${op.scalePct}%`); break;
        case 'brightness': args.push('-brightness-contrast', `${op.value}x0`); break;
        case 'contrast': args.push('-brightness-contrast', `0x${op.value}`); break;
        case 'sharpen': args.push('-sharpen', `0x${(op.value / 100 * 3).toFixed(2)}`); break;
        case 'grayscale': args.push('-colorspace', 'Gray'); break;
      }
    }
    return args;
  }

  private coderFor(mime?: string | null): { coder: 'PNG' | 'JPEG'; ext: string } {
    return mime === 'image/png' || mime === 'image/gif' || mime === 'image/webp'
      ? { coder: 'PNG', ext: 'png' } : { coder: 'JPEG', ext: 'jpg' };
  }

  private async imageDims(p: string): Promise<{ w: number; h: number }> {
    try {
      const { stdout } = await pexec('magick', ['identify', '-format', '%w %h', `${p}[0]`], { timeout: 30_000 });
      const [w, h] = stdout.trim().split(/\s+/).map((x) => parseInt(x, 10));
      return { w: w || 1000, h: h || 1000 };
    } catch { return { w: 1000, h: 1000 }; }
  }

  // מחיל מתכון על קובץ המקור ומפיק תמונה ל-outPath. maxDim (אופציונלי) מקטין לתצוגה מקדימה.
  // אם יש פעולות טשטוש/פיקסול/כיסוי (4.2) — קודם צורבים אותן על בסיס מיושר-כיוון, ואז ממשיכים לגאומטריה,
  // כך שהאזור המוסתר נחתך/מסתובב יחד עם התמונה. הצריבה משנה את הפיקסלים בגרסה — בלתי-הפיכה (המקור לא נוגע).
  private async applyRecipe(file: any, ops: Op[], outPath: string, maxDim?: number): Promise<void> {
    const src = this.blobPath(file.hash);
    const GEOM = ['crop', 'rotate', 'flip', 'resize', 'brightness', 'contrast', 'sharpen', 'grayscale'];
    const OVERLAY = ['redact', 'text', 'arrow', 'frame', 'watermark'];
    const overlayOps = ops.filter((o) => OVERLAY.includes(o.op));
    const geomOps = ops.filter((o) => GEOM.includes(o.op));
    const strip = ops.some((o) => o.op === 'strip'); // מחיקת מטא-דאטה
    const { coder } = this.coderFor(file.mimeType);

    let input = `${src}[0]`;
    let overlayTmp: string | null = null;
    if (overlayOps.length) {
      overlayTmp = path.join(this.tmpDir, `ov-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
      await this.applyOverlays(src, overlayOps as any[], overlayTmp);
      input = overlayTmp;
    }
    try {
      const dim = await this.imageDims(overlayTmp ?? src);
      const args = [input, '-auto-orient', ...this.recipeArgs(geomOps, dim)];
      if (maxDim) args.push('-resize', `${maxDim}x${maxDim}>`);
      args.push('-resize', `${MAX_OUTPUT_DIM}x${MAX_OUTPUT_DIM}>`); // תקרת בטיחות
      if (strip) args.push('-strip'); // מחיקת מטא-דאטה (EXIF/GPS/מצלמה)
      if (coder === 'JPEG') args.push('-quality', '92');
      args.push(`${coder}:${outPath}`);
      await pexec('magick', args, { timeout: RENDER_TIMEOUT });
    } finally {
      if (overlayTmp) await fs.rm(overlayTmp, { force: true }).catch(() => undefined);
    }
  }

  // צריבת אזורי טשטוש/פיקסול/כיסוי (4.2) על בסיס מיושר-כיוון במלוא הגודל. הקואורדינטות הן שברים 0..1.
  // כל קריאה ב-execFile עם מערך ארגומנטים; מחרוזות -draw נבנות ממספרים שלמים מנוקים בלבד (אין shell/הזרקה).
  private async applyOverlays(srcBlob: string, overlayOps: any[], outPath: string): Promise<void> {
    const tmps: string[] = [];
    const mk = (suffix: string) => { const fp = path.join(this.tmpDir, `rd-${Date.now()}-${Math.random().toString(36).slice(2)}-${suffix}.png`); tmps.push(fp); return fp; };
    try {
      let running = mk('base');
      await pexec('magick', [`${srcBlob}[0]`, '-auto-orient', `PNG:${running}`], { timeout: RENDER_TIMEOUT });
      const { w: W, h: H } = await this.imageDims(running);

      for (const op of overlayOps) {
        const next = mk('step');
        if (op.op === 'text') { await this.textOnto(running, op, W, H, next, mk); running = next; continue; }
        if (op.op === 'arrow') { await this.arrowOnto(running, op, W, H, next); running = next; continue; }
        if (op.op === 'frame') { await this.frameOnto(running, op, W, H, next); running = next; continue; }
        if (op.op === 'watermark') { await this.watermarkOnto(running, op, W, H, next, mk); running = next; continue; }
        const draw = this.drawString(op, W, H);
        if (!draw) continue;
        // [שינוי 2026-06-25] מנגנון אחיד לכל המצבים: שכבת-אפקט במלוא הפריים + מסכת-צורה המוחלת כשקיפות (CopyOpacity).
        // מתקן באג IM7 שבו '-composite' עם 3 אופרנדים התעלם ממסכת האליפסה והחיל את האפקט על כל התמונה.
        const eff = mk('eff');
        if (op.mode === 'cover') {
          const color = /^#[0-9a-fA-F]{6}$/.test(op.color) ? op.color : '#000000';
          await pexec('magick', ['-size', `${W}x${H}`, `xc:${color}`, `PNG:${eff}`], { timeout: RENDER_TIMEOUT });
        } else if (op.mode === 'blur') {
          const sigma = Math.max(2, Math.round((op.strength / 100) * 25));
          await pexec('magick', [running, '-blur', `0x${sigma}`, `PNG:${eff}`], { timeout: RENDER_TIMEOUT });
        } else { // pixelate — הקטנה ואז הגדלה (בלוקים)
          const block = Math.max(2, Math.round(2 + (op.strength / 100) * 48));
          const downW = Math.max(1, Math.round(W / block));
          await pexec('magick', [running, '-scale', `${downW}x`, '-scale', `${W}x${H}!`, `PNG:${eff}`], { timeout: RENDER_TIMEOUT });
        }
        // מסכה: קנבס שחור + צורה לבנה. feather מטשטש את המסכה (קצוות מדורגים); invert מהפך (האפקט חל מסביב לאזור).
        const mask = mk('mask');
        const maskArgs: string[] = ['-size', `${W}x${H}`, 'xc:black', '-fill', 'white', '-draw', draw];
        const feather = Math.max(0, Math.min(100, Number(op.feather) || 0));
        if (feather > 0) maskArgs.push('-blur', `0x${Math.max(1, Math.round((feather / 100) * 40))}`);
        if (op.invert === true) maskArgs.push('-negate');
        maskArgs.push('-alpha', 'off', `PNG:${mask}`);
        await pexec('magick', maskArgs, { timeout: RENDER_TIMEOUT });
        // מעתיקים את עוצמת המסכה לערוץ השקיפות של האפקט, ואז מרכיבים מעל התמונה הרצה.
        const effA = mk('effA');
        await pexec('magick', [eff, mask, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', `PNG:${effA}`], { timeout: RENDER_TIMEOUT });
        await pexec('magick', [running, effA, '-compose', 'over', '-composite', `PNG:${next}`], { timeout: RENDER_TIMEOUT });
        running = next;
      }
      await fs.copyFile(running, outPath);
    } finally {
      for (const fp of tmps) await fs.rm(fp, { force: true }).catch(() => undefined);
    }
  }

  // ───────────────────────── סימונים (טקסט / חץ / מסגרת / סימן מים) — שלב 4.3 ─────────────────────────
  // ניקוי טקסט גולמי: הסרת תווי-בקרה וקיצור. נשמר קריא (ללא היפוך) במתכון. ASCII-only מקור (ללא regex unicode).
  private cleanText(v: any): string {
    const s0 = typeof v === 'string' ? v : (v == null ? '' : String(v));
    let out = '';
    for (const ch of s0) { const c = ch.codePointAt(0) || 0; out += (c < 32 || c === 127) ? ' ' : ch; }
    return out.slice(0, 200).trim();
  }
  // הכנה ל-label של ImageMagick בזמן רינדור: היפוך רצף עברי (אין BiDi) + נטרול '@'/'~' מוביל (קריאת-קובץ).
  private renderText(s0: string): string {
    const isHeb = (c: number) => (c >= 0x0590 && c <= 0x05ff) || (c >= 0xfb1d && c <= 0xfb4f);
    let out = ''; let run: string[] = [];
    for (const ch of (s0 || '')) {
      if (isHeb(ch.codePointAt(0) || 0)) { run.push(ch); }
      else { if (run.length) { out += run.reverse().join(''); run = []; } out += ch; }
    }
    if (run.length) out += run.reverse().join('');
    if (out.length && (out[0] === '@' || out[0] === '~')) out = ' ' + out;
    return out || ' ';
  }
  private clamp01(v: any): number { return Math.min(1, Math.max(0, Number(v) || 0)); }

  // טקסט: בונה תווית (label:) שקופה וממקם אותה. הטקסט נכנס רק כתוכן label — אין shell/הזרקה.
  private async textOnto(running: string, op: any, W: number, H: number, next: string, mk: (s: string) => string): Promise<void> {
    const label = mk('txt');
    const safe = this.renderText(op.value);
    await pexec('magick', ['-background', 'none', '-fill', op.color, '-stroke', 'rgba(0,0,0,0.55)', '-strokewidth', '1', '-font', (FONTS[op.font] || FONT), '-pointsize', String(op.size), `label:${safe}`, `PNG:${label}`], { timeout: RENDER_TIMEOUT });
    const px = Math.round(this.clamp01(op.x) * W), py = Math.round(this.clamp01(op.y) * H);
    await pexec('magick', [running, label, '-gravity', 'NorthWest', '-geometry', `+${px}+${py}`, '-compose', 'over', '-composite', `PNG:${next}`], { timeout: RENDER_TIMEOUT });
  }

  // חץ: קו + ראש-חץ. מחרוזת ה-draw נבנית ממספרים שלמים בלבד.
  private async arrowOnto(running: string, op: any, W: number, H: number, next: string): Promise<void> {
    const X1 = Math.round(this.clamp01(op.x1) * W), Y1 = Math.round(this.clamp01(op.y1) * H);
    const X2 = Math.round(this.clamp01(op.x2) * W), Y2 = Math.round(this.clamp01(op.y2) * H);
    const ang = Math.atan2(Y2 - Y1, X2 - X1);
    const head = Math.max(10, Number(op.width) * 4);
    const hx1 = Math.round(X2 + head * Math.cos(ang + Math.PI - Math.PI / 7)), hy1 = Math.round(Y2 + head * Math.sin(ang + Math.PI - Math.PI / 7));
    const hx2 = Math.round(X2 + head * Math.cos(ang + Math.PI + Math.PI / 7)), hy2 = Math.round(Y2 + head * Math.sin(ang + Math.PI + Math.PI / 7));
    const draw = `line ${X1},${Y1} ${X2},${Y2} line ${X2},${Y2} ${hx1},${hy1} line ${X2},${Y2} ${hx2},${hy2}`;
    await pexec('magick', [running, '-stroke', op.color, '-strokewidth', String(op.width), '-fill', op.color, '-draw', draw, `PNG:${next}`], { timeout: RENDER_TIMEOUT });
  }

  // מסגרת: מלבן ללא מילוי. מספרים שלמים בלבד.
  private async frameOnto(running: string, op: any, W: number, H: number, next: string): Promise<void> {
    const x1 = Math.round(this.clamp01(op.x) * W), y1 = Math.round(this.clamp01(op.y) * H);
    const x2 = Math.round(this.clamp01(op.x + op.w) * W), y2 = Math.round(this.clamp01(op.y + op.h) * H);
    await pexec('magick', [running, '-fill', 'none', '-stroke', op.color, '-strokewidth', String(op.width), '-draw', `rectangle ${x1},${y1} ${x2},${y2}`, `PNG:${next}`], { timeout: RENDER_TIMEOUT });
  }

  // סימן מים מרוצף ואלכסוני (לגרסת שיתוף). הטקסט נכנס רק כ-label.
  private async watermarkOnto(running: string, op: any, W: number, H: number, next: string, mk: (s: string) => string): Promise<void> {
    const layer = mk('wm');
    const safe = this.renderText(op.text);
    const sideD = Math.ceil(Math.sqrt(W * W + H * H)) + 4;
    await pexec('magick', ['-background', 'none', '-font', FONT, '-pointsize', '26', '-fill', 'rgba(255,255,255,0.34)', `label:${safe}`, '-bordercolor', 'none', '-border', '30', '-write', 'mpr:wmt', '+delete', '-size', `${sideD}x${sideD}`, 'tile:mpr:wmt', '-rotate', '30', '-gravity', 'center', '-background', 'none', '-extent', `${W}x${H}`, `PNG:${layer}`], { timeout: RENDER_TIMEOUT });
    await pexec('magick', [running, layer, '-compose', 'over', '-composite', `PNG:${next}`], { timeout: RENDER_TIMEOUT });
  }

  // בונה מחרוזת ImageMagick -draw ממספרים שלמים מנוקים בלבד (פיקסלים). לעולם לא מטקסט-משתמש.
  private drawString(op: any, W: number, H: number): string | null {
    const ix = (f: number) => Math.round(Math.min(1, Math.max(0, Number(f) || 0)) * W);
    const iy = (f: number) => Math.round(Math.min(1, Math.max(0, Number(f) || 0)) * H);
    if (op.shape === 'polygon') {
      const pts = (op.points || []).map((pt: any) => `${ix(pt.x)},${iy(pt.y)}`);
      if (pts.length < 3) return null;
      return `polygon ${pts.join(' ')}`;
    }
    const x1 = ix(op.x), y1 = iy(op.y), x2 = ix(op.x + op.w), y2 = iy(op.y + op.h);
    if (x2 - x1 < 1 || y2 - y1 < 1) return null;
    if (op.shape === 'ellipse') {
      const cx = Math.round((x1 + x2) / 2), cy = Math.round((y1 + y2) / 2);
      const rx = Math.max(1, Math.round((x2 - x1) / 2)), ry = Math.max(1, Math.round((y2 - y1) / 2));
      return `ellipse ${cx},${cy} ${rx},${ry} 0,360`;
    }
    return `rectangle ${x1},${y1} ${x2},${y2}`;
  }

  // ───────────────────────── נקודות קצה ─────────────────────────

  // תמונת בסיס לעורך: גרסת-צפייה ממוזערת ומקודדת מחדש של המקור (לא המקור עצמו) — בדיוק כמו הצופה המוגן.
  async base(userId: string, fileId: string): Promise<{ path: string; type: string }> {
    await this.imageFileOrThrow(userId, fileId);
    return this.viewing.renderImage(fileId);
  }

  // תצוגה מקדימה של מתכון — מוחל על עותק ממוזער ומוחזר כבייטים (לא נשמר, לא נוצר File/גרסה).
  async preview(userId: string, fileId: string, recipe: any): Promise<{ buffer: Buffer; type: string }> {
    const f = await this.imageFileOrThrow(userId, fileId);
    const ops = this.sanitizeRecipe(recipe);
    const { coder, ext } = this.coderFor(f.mimeType);
    const out = path.join('/tmp', `editprev-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
    try {
      await this.applyRecipe(f, ops, out, PREVIEW_DIM);
      const buffer = await fs.readFile(out);
      return { buffer, type: coder === 'PNG' ? 'image/png' : 'image/jpeg' };
    } finally {
      await fs.rm(out, { force: true }).catch(() => undefined);
    }
  }

  // שמירת גרסה — מחיל את המתכון על המקור במלוא הרזולוציה, יוצר קובץ נגזר חדש ורושם גרסה.
  async saveVersion(userId: string, fileId: string, recipe: any, label?: string, opts?: { share?: boolean; watermarkText?: string }) {
    const f = await this.imageFileOrThrow(userId, fileId);
    const ops = this.sanitizeRecipe(recipe);
    if (opts?.share) {
      // גרסת שיתוף: סימן מים מרוצף + מחיקת מטא-דאטה (ברירת מחדל), גם אם לא בוצעו עריכות אחרות.
      ops.push({ op: 'watermark', text: this.cleanText(opts.watermarkText) || 'לא להפצה' } as Op);
      if (!ops.some((o) => o.op === 'strip')) ops.push({ op: 'strip' } as Op);
    }
    if (ops.length === 0) throw new BadRequestException('אין פעולות עריכה לשמירה');

    // פרויקט עריכה לקובץ (משתמשים בקיים או יוצרים חדש).
    let edit = await this.prisma.mediaEdit.findFirst({ where: { fileId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    if (!edit) edit = await this.prisma.mediaEdit.create({ data: { fileId, name: 'עריכה', createdById: userId } });

    const agg = await this.prisma.mediaEditVersion.aggregate({ where: { editId: edit.id }, _max: { versionNo: true } });
    const versionNo = (agg._max.versionNo ?? 0) + 1;

    const { ext } = this.coderFor(f.mimeType);
    const out = path.join(this.tmpDir, `v-${edit.id}-${versionNo}-${Math.random().toString(36).slice(2)}.${ext}`);
    let result;
    try {
      await this.applyRecipe(f, ops, out); // מלוא הרזולוציה
      const baseName = f.name.replace(/\.[^.]+$/, '');
      const name = `${baseName} — ${opts?.share ? 'שיתוף' : 'גרסה'} ${versionNo}.${ext}`;
      result = await this.files.createDerived({ tmpPath: out, name, folderId: f.folderId, uploadedById: userId, source: 'edit' });
    } finally {
      await fs.rm(out, { force: true }).catch(() => undefined); // createDerived כבר העביר; ניקוי ביטחון
    }

    const version = await this.prisma.mediaEditVersion.create({
      data: { editId: edit.id, versionNo, label: ((label || (opts?.share ? 'גרסת שיתוף' : '')) || '').slice(0, 120) || null, recipe: ops as any, resultFileId: result.id, createdById: userId },
    });
    await this.prisma.auditEvent.create({
      data: {
        action: 'file.edited', userId, targetType: 'file', targetId: fileId,
        details: { editId: edit.id, versionId: version.id, versionNo, resultFileId: result.id, ops: ops.map((o) => o.op), share: !!opts?.share },
      },
    });
    return {
      editId: edit.id,
      version: { id: version.id, versionNo, label: version.label, recipe: ops, createdAt: version.createdAt },
      result,
    };
  }

  // רשימת פרויקטי העריכה והגרסאות של קובץ — עם פרטי הקובץ הנגזר של כל גרסה.
  async listForFile(userId: string, fileId: string) {
    await this.access.assertCanView(userId, fileId); // לא חושפים גרסאות של קובץ מחוץ לטווח המשתמש
    await this.assertNotSensitive(fileId); // עקביות עם חסימת עריכה — אין חשיפת היסטוריית עריכה לקובץ רגיש בדפדפן
    const edits = await this.prisma.mediaEdit.findMany({
      where: { fileId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { versions: { orderBy: { versionNo: 'asc' } } },
    });
    const resultIds = edits.flatMap((e) => e.versions.map((v) => v.resultFileId));
    const rows = resultIds.length
      ? await this.prisma.file.findMany({
          where: { id: { in: resultIds } },
          select: { id: true, name: true, sizeBytes: true, mimeType: true, hash: true, createdAt: true, deletedAt: true },
        })
      : [];
    const byId = new Map(rows.map((r) => [r.id, { ...r, sizeBytes: Number(r.sizeBytes) }]));
    return edits.map((e) => ({
      id: e.id,
      fileId: e.fileId,
      name: e.name,
      createdAt: e.createdAt,
      versions: e.versions.map((v) => ({
        id: v.id,
        versionNo: v.versionNo,
        label: v.label,
        recipe: v.recipe,
        createdAt: v.createdAt,
        result: byId.get(v.resultFileId) ?? null,
      })),
    }));
  }

  // ───────────────────────── ניהול גרסאות (שלב 4.4) ─────────────────────────

  // שכפול גרסה — מחיל מחדש את אותו "מתכון" על המקור ויוצר גרסה חדשה (הגרסה המקורית לא נוגעת).
  async duplicateVersion(userId: string, versionId: string) {
    const v = await this.prisma.mediaEditVersion.findUnique({ where: { id: versionId }, include: { edit: true } });
    if (!v || !v.edit || v.edit.deletedAt) throw new NotFoundException('הגרסה לא נמצאה');
    return this.saveVersion(userId, v.edit.fileId, v.recipe, `עותק של גרסה ${v.versionNo}`);
  }

  // הורדת גרסה ערוכה (הרשאת files.download_edited) — מחזיר נתיב פיזי + שם להזרמה כקובץ.
  async getVersionForDownload(userId: string, versionId: string, auth?: { device?: string }): Promise<{ filePath: string; name: string }> {
    const v = await this.prisma.mediaEditVersion.findUnique({ where: { id: versionId }, include: { edit: true } });
    if (!v || !v.edit || v.edit.deletedAt) throw new NotFoundException('הגרסה לא נמצאה');
    await this.access.assertCanView(userId, v.edit.fileId, { device: auth?.device }); // גישה לפי טווח (3.9) + הקשר מכשיר — מול קובץ המקור
    const result = await this.prisma.file.findFirst({ where: { id: v.resultFileId, deletedAt: null } });
    if (!result) throw new NotFoundException('הקובץ הערוך לא נמצא');
    const filePath = this.blobPath(result.hash);
    if (!(await this.exists(filePath))) throw new NotFoundException('הקובץ הפיזי חסר');
    // לוג הורדת גרסה ערוכה (אחריות/מעקב — כמו הורדת מקור).
    await this.prisma.auditEvent.create({ data: { action: 'file.downloaded_edited', userId, targetType: 'file', targetId: v.edit.fileId, details: { versionId, versionNo: v.versionNo, resultFileId: v.resultFileId } } });
    return { filePath, name: result.name };
  }
}

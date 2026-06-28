// watermark.service.ts — תבניות סימן מים גמישות (שלב 3.8, מרחיב את 3.2).
// כמה תבניות יכולות להיות פעילות יחד (שכבות), כל אחת טקסט או לוגו/תמונה, עם עיצוב מלא וטווח-החלה
// (תיקיות/תגיות/סוג/רגישות) — כך שנצרב אוטומטית סימן המים הנכון לכל קובץ. הצריבה עצמה במנוע הצפייה.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService, type FileScopeContext } from '../scope/scope.service';
import * as fs from 'fs/promises';
import * as path from 'path';

const POSITIONS = ['tiled', 'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const KINDS = ['text', 'image'];
const MOTION_AXES = ['x', 'y']; // [שינוי 2026-06-25] ציר תנועה בווידאו

@Injectable()
export class WatermarkService {
  private readonly logoDir: string;

  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, config: ConfigService) {
    this.logoDir = path.join(config.get<string>('storageDir') ?? '/data', 'watermarks');
  }

  list() {
    return this.prisma.watermarkTemplate.findMany({ where: { deletedAt: null }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
  }

  async get(id: string) {
    const t = await this.prisma.watermarkTemplate.findFirst({ where: { id, deletedAt: null } });
    if (!t) throw new NotFoundException('תבנית סימן המים לא נמצאה');
    return t;
  }

  // התבניות הפעילות שחלות על קובץ נתון (לפי הטווח), בסדר שכבות (priority עולה). נקרא ע"י מנוע הצפייה.
  async applicableFor(ctx: FileScopeContext) {
    const enabled = await this.prisma.watermarkTemplate.findMany({ where: { enabled: true, deletedAt: null }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
    return enabled.filter((t) => this.scope.matches(this.scopeOf(t), ctx));
  }
  private scopeOf(t: any) {
    return { folderIds: t.folderIds, tagIds: t.tagIds, fileIds: t.fileIds, mimeTypes: t.mimeTypes, sensitivities: t.sensitivities, includeSubfolders: t.includeSubfolders, includeSubtags: t.includeSubtags };
  }

  async create(actorId: string, dto: any) {
    const data = this.sanitize(dto, true);
    if (!data.name) throw new BadRequestException('חסר שם לתבנית');
    const created = await this.prisma.watermarkTemplate.create({ data: { ...data, createdById: actorId } });
    await this.audit('watermark.created', actorId, created.id, { name: created.name });
    return created;
  }

  async update(actorId: string, id: string, dto: any) {
    await this.get(id);
    const updated = await this.prisma.watermarkTemplate.update({ where: { id }, data: this.sanitize(dto, false) });
    await this.audit('watermark.updated', actorId, id, { name: updated.name });
    return updated;
  }

  // הפעלה/כיבוי תבנית (כמה יכולות להיות פעילות יחד — אין יותר "אחת בלבד").
  async setEnabled(actorId: string, id: string, enabled: boolean) {
    await this.get(id);
    const u = await this.prisma.watermarkTemplate.update({ where: { id }, data: { enabled: !!enabled } });
    await this.audit(enabled ? 'watermark.enabled' : 'watermark.disabled', actorId, id, {});
    return u;
  }

  async remove(actorId: string, id: string) {
    const t = await this.get(id);
    await this.prisma.watermarkTemplate.update({ where: { id }, data: { deletedAt: new Date(), enabled: false } });
    await this.audit('watermark.deleted', actorId, id, { name: t.name });
    return { id, deleted: true };
  }

  // העלאת לוגו: מאמת שזו תמונה (חתימת בייטים), שומר תחת /data/watermarks/<id>, ומסמן kind=image.
  async saveLogo(actorId: string, id: string, buf: Buffer) {
    await this.get(id);
    const mime = this.imageMime(buf);
    if (!mime) throw new BadRequestException('יש להעלות קובץ תמונה (PNG / JPG / GIF / WebP)');
    if (buf.length > 3 * 1024 * 1024) throw new BadRequestException('הלוגו גדול מדי (עד 3MB)');
    await fs.mkdir(this.logoDir, { recursive: true });
    const p = path.join(this.logoDir, id);
    await fs.writeFile(p, buf);
    const u = await this.prisma.watermarkTemplate.update({ where: { id }, data: { kind: 'image', imagePath: p } });
    await this.audit('watermark.logo', actorId, id, { mime, bytes: buf.length });
    return u;
  }

  private imageMime(b: Buffer): string | null {
    if (b.length < 12) return null;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
    if (b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    return null;
  }

  // משאיר רק שדות מותרים ומגביל ערכים. ב-create מאתחל ברירות-מחדל; ב-update נוגע רק במה שנשלח.
  private sanitize(dto: any, isCreate: boolean) {
    const out: any = {};
    const num = (v: any, d: number) => { const n = Number(v); return isNaN(n) ? d : n; };
    const clamp = (lo: number, hi: number, v: number) => Math.min(hi, Math.max(lo, v));
    if (dto.name !== undefined) out.name = String(dto.name).trim().slice(0, 100);
    if (dto.text !== undefined) out.text = String(dto.text).slice(0, 300);
    if (dto.fontSize !== undefined) out.fontSize = clamp(8, 200, Math.round(num(dto.fontSize, 28)));
    if (dto.color !== undefined) out.color = /^#[0-9a-fA-F]{6}$/.test(dto.color) ? dto.color : '#ffffff';
    if (dto.opacity !== undefined) out.opacity = clamp(0, 1, num(dto.opacity, 0.3));
    if (dto.position !== undefined) out.position = POSITIONS.includes(dto.position) ? dto.position : 'tiled';
    if (dto.angle !== undefined) out.angle = clamp(-180, 180, Math.round(num(dto.angle, 0)));
    if (dto.motion !== undefined) out.motion = !!dto.motion;
    if (dto.enabled !== undefined) out.enabled = !!dto.enabled;
    if (dto.priority !== undefined) out.priority = clamp(0, 9999, Math.round(num(dto.priority, 0)));
    if (dto.kind !== undefined) out.kind = KINDS.includes(dto.kind) ? dto.kind : 'text';
    if (dto.imageScale !== undefined) out.imageScale = clamp(0.02, 1, num(dto.imageScale, 0.25));
    if (dto.outline !== undefined) out.outline = !!dto.outline;
    // [שינוי 2026-06-25] שדות גמישות חדשים: מרחק חזרות, תנועה (ציר/כיוון/מהירות), הבהוב (מחזור/משך)
    if (dto.tileGap !== undefined) out.tileGap = clamp(0, 400, Math.round(num(dto.tileGap, 28)));
    if (dto.motionAxis !== undefined) out.motionAxis = MOTION_AXES.includes(dto.motionAxis) ? dto.motionAxis : 'x';
    if (dto.motionDir !== undefined) out.motionDir = num(dto.motionDir, 1) < 0 ? -1 : 1;
    if (dto.motionSpeed !== undefined) out.motionSpeed = clamp(10, 2000, Math.round(num(dto.motionSpeed, 120)));
    if (dto.blink !== undefined) out.blink = !!dto.blink;
    if (dto.blinkInterval !== undefined) out.blinkInterval = clamp(0.5, 60, num(dto.blinkInterval, 5));
    if (dto.blinkOn !== undefined) out.blinkOn = clamp(0.2, 30, num(dto.blinkOn, 1.5));
    const scopeKeys = ['folderIds', 'tagIds', 'fileIds', 'mimeTypes', 'sensitivities', 'includeSubfolders', 'includeSubtags'];
    if (isCreate || scopeKeys.some((k) => dto[k] !== undefined)) {
      const sc = this.scope.sanitize(dto);
      out.folderIds = sc.folderIds; out.tagIds = sc.tagIds; out.fileIds = sc.fileIds; out.mimeTypes = sc.mimeTypes; out.sensitivities = sc.sensitivities;
      out.includeSubfolders = sc.includeSubfolders; out.includeSubtags = sc.includeSubtags;
    }
    return out;
  }

  private async audit(action: string, userId: string, targetId: string, details: any) {
    await this.prisma.auditEvent.create({ data: { action, userId, targetType: 'watermark', targetId, details } });
  }
}

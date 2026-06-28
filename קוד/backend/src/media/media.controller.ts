// media.controller.ts — נקודות קצה לעריכת תמונות (שלב 4.1). כל הנתיבים דורשים התחברות + הרשאת media.edit.
// GET  /media/edits/:fileId   — רשימת פרויקטי עריכה וגרסאות לקובץ
// GET  /media/base/:fileId    — תמונת בסיס לעורך (גרסת-צפייה ממוזערת — לא המקור)
// POST /media/preview         — תצוגה מקדימה של מתכון (בייטים, לא נשמר)   { fileId, recipe }
// POST /media/edits           — שמירת גרסה (מחיל מתכון, יוצר קובץ נגזר)   { fileId, recipe, label? }
// אף נתיב אינו מגיש את קובץ המקור; הבסיס/התצוגה הם תמונה מקודדת-מחדש בלבד.
import { BadRequestException, Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { createReadStream } from 'fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { MediaService } from './media.service';

@Controller('media')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  // כותרות אבטחה אחידות לתמונה (כמו הצופה המוגן): סוג מדויק, ללא ניחוש-סוג/מטמון, inline עם שם כללי, CSP מחמיר.
  private secureHeaders(res: any, type: string): void {
    res.setHeader('Content-Type', type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline; filename="edit"');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; object-src 'none'; style-src 'unsafe-inline'; sandbox");
  }

  @Get('edits/:fileId')
  @RequirePermissions(PERMISSIONS.MEDIA_EDIT)
  list(@Req() req: any, @Param('fileId') fileId: string) {
    return this.media.listForFile(req.user.sub, fileId);
  }

  @Get('base/:fileId')
  @RequirePermissions(PERMISSIONS.MEDIA_EDIT)
  async base(@Req() req: any, @Param('fileId') fileId: string, @Res() res: any) {
    const r = await this.media.base(req.user.sub, fileId);
    this.secureHeaders(res, r.type);
    createReadStream(r.path).pipe(res);
  }

  @Post('preview')
  @RequirePermissions(PERMISSIONS.MEDIA_EDIT)
  async preview(@Req() req: any, @Body() body: any, @Res() res: any) {
    if (!body?.fileId) throw new BadRequestException('חסר מזהה קובץ');
    const r = await this.media.preview(req.user.sub, body.fileId, body.recipe);
    this.secureHeaders(res, r.type);
    res.status(200).end(r.buffer); // רינדור חולף — 200 (לא נוצר משאב), לא 201 ברירת-המחדל של POST
  }

  @Post('edits')
  @RequirePermissions(PERMISSIONS.MEDIA_EDIT)
  save(@Req() req: any, @Body() body: any) {
    if (!body?.fileId) throw new BadRequestException('חסר מזהה קובץ');
    return this.media.saveVersion(req.user.sub, body.fileId, body.recipe, body.label, { share: body.share === true, watermarkText: body.watermarkText });
  }

  // שכפול גרסה (שלב 4.4) — יוצר גרסה חדשה מאותו מתכון.
  @Post('versions/:id/duplicate')
  @RequirePermissions(PERMISSIONS.MEDIA_EDIT)
  duplicate(@Req() req: any, @Param('id') id: string) {
    return this.media.duplicateVersion(req.user.sub, id);
  }

  // הורדת גרסה ערוכה כקובץ (שלב 4.4) — הרשאה נפרדת files.download_edited; תמיד attachment + nosniff.
  @Get('versions/:id/download')
  @RequirePermissions(PERMISSIONS.FILES_DOWNLOAD_EDITED)
  async download(@Req() req: any, @Param('id') id: string, @Res() res: any) {
    const { filePath, name } = await this.media.getVersionForDownload(req.user.sub, id, { device: req.user.device });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    createReadStream(filePath).pipe(res);
  }
}

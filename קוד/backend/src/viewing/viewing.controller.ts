// viewing.controller.ts — נקודות הקצה לצפייה מוגנת (שלב 3.1).
// POST /view/sessions            — פתיחת הפעלת צפייה לקובץ (מחזיר sid, סוג, מס' עמודים, טוקן ראשון)
// POST /view/sessions/:sid/token — רענון הטוקן הקצר כל עוד ההפעלה תקפה
// GET  /view/:fileId/image       — גרסת צפייה לתמונה (JPEG מקודד מחדש)
// GET  /view/:fileId/page/:n     — עמוד PDF כתמונה (PNG)
// GET  /view/:fileId/video       — וידאו מקודד מחדש לצפייה (MP4)
// GET  /view/:fileId/audio       — שמע מקודד מחדש לצפייה (MP3)
// GET  /view/:fileId/text        — טקסט לצפייה
// כל הנתיבים דורשים התחברות + הרשאת files.view; נתיבי הגרסאות דורשים גם טוקן צפייה תקף (?vt=).
// אף נתיב כאן אינו מגיש את קובץ המקור — המקור זמין רק דרך /files/:id/download (הרשאת files.download_source).
import {
  BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { ViewingService } from './viewing.service';

@Controller('view')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ViewingController {
  constructor(private readonly viewing: ViewingService) {}

  private clientIp(req: any): string | undefined {
    const xf = (req.headers['x-forwarded-for'] as string) || '';
    return xf.split(',')[0].trim() || req.ip || req.socket?.remoteAddress || undefined;
  }

  // כותרות אבטחה אחידות לכל גרסת צפייה: סוג מדויק, ללא ניחוש-סוג, ללא שמירה במטמון, inline עם שם כללי, ו-CSP מחמיר.
  private secureHeaders(res: any, type: string): void {
    res.setHeader('Content-Type', type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline; filename="view"');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self' data:; media-src 'self'; object-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  }

  // משדר את גרסת הצפייה: Buffer (תמונה ממוית מים) או הזרמת קובץ (וידאו/שמע מהמטמון).
  private send(res: any, r: { buffer?: Buffer; path?: string }): void {
    if (r.buffer) { res.end(r.buffer); return; }
    createReadStream(r.path as string).pipe(res);
  }

  @Post('sessions')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  createSession(@Req() req: any, @Body('fileId') fileId: string) {
    if (!fileId) throw new BadRequestException('חסר מזהה קובץ');
    return this.viewing.createSession(req.user.sub, fileId, this.clientIp(req), req.headers['user-agent'], { reader: req.user.reader, device: req.user.device });
  }

  @Post('sessions/:sid/token')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  refresh(@Req() req: any, @Param('sid') sid: string) {
    return this.viewing.refreshToken(req.user.sub, sid, { reader: req.user.reader, device: req.user.device });
  }

  @Get(':fileId/image')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  async image(@Req() req: any, @Param('fileId') fileId: string, @Query('vt') vt: string, @Res() res: any) {
    const s = await this.viewing.authorizeRendition(req.user.sub, fileId, vt, { reader: req.user.reader, device: req.user.device });
    const r = await this.viewing.viewImage(s);
    this.secureHeaders(res, r.type);
    this.send(res, r);
  }

  @Get(':fileId/page/:n')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  async page(@Req() req: any, @Param('fileId') fileId: string, @Param('n') n: string, @Query('vt') vt: string, @Res() res: any) {
    const s = await this.viewing.authorizeRendition(req.user.sub, fileId, vt, { reader: req.user.reader, device: req.user.device });
    const r = await this.viewing.viewPdfPage(s, Number(n));
    this.secureHeaders(res, r.type);
    this.send(res, r);
  }

  @Get(':fileId/video')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  async video(@Req() req: any, @Param('fileId') fileId: string, @Query('vt') vt: string, @Res() res: any) {
    const s = await this.viewing.authorizeRendition(req.user.sub, fileId, vt, { reader: req.user.reader, device: req.user.device });
    const r = await this.viewing.viewVideo(s);
    this.secureHeaders(res, r.type);
    this.send(res, r);
  }

  @Get(':fileId/audio')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  async audio(@Req() req: any, @Param('fileId') fileId: string, @Query('vt') vt: string, @Res() res: any) {
    const s = await this.viewing.authorizeRendition(req.user.sub, fileId, vt, { reader: req.user.reader, device: req.user.device });
    const r = await this.viewing.viewAudio(s);
    this.secureHeaders(res, r.type);
    this.send(res, r);
  }

  @Get(':fileId/text')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  async text(@Req() req: any, @Param('fileId') fileId: string, @Query('vt') vt: string, @Res() res: any) {
    const s = await this.viewing.authorizeRendition(req.user.sub, fileId, vt, { reader: req.user.reader, device: req.user.device });
    const r = await this.viewing.viewText(s);
    this.secureHeaders(res, r.type);
    res.send(r.data);
  }
}

// share-public.controller.ts — נקודות הקצה הציבוריות של קישורי הצפייה (שלב 3.5). ללא התחברות!
// הגישה נשענת על ה-token שב-URL ועל אימות התנאים בשרת (מייל/קוד/אישור/מכשיר/IP/מדינה/תפוגה/מכסה).
// אף נתיב אינו מגיש את קובץ המקור — רק גרסת-צפייה ממוית-מים. הכול נבדק מחדש בכל בקשה (ביטול מיידי).
import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { createReadStream } from 'fs';
import { ShareService } from './share.service';
import { ViewingService } from '../viewing/viewing.service';

@Controller('share')
export class SharePublicController {
  constructor(private readonly share: ShareService, private readonly viewing: ViewingService) {}

  private clientIp(req: any): string | undefined {
    const xf = (req.headers['x-forwarded-for'] as string) || '';
    return xf.split(',')[0].trim() || req.ip || req.socket?.remoteAddress || undefined;
  }
  private secureHeaders(res: any, type: string): void {
    res.setHeader('Content-Type', type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline; filename="view"');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; object-src 'none'; style-src 'unsafe-inline'; sandbox");
  }
  private send(res: any, r: { buffer?: Buffer; path?: string }): void {
    if (r.buffer) { res.end(r.buffer); return; }
    createReadStream(r.path as string).pipe(res);
  }

  @Post(':token/start')
  start(@Req() req: any, @Param('token') token: string, @Body('deviceKey') deviceKey: string) {
    return this.share.start(token, deviceKey, this.clientIp(req), req.headers['user-agent']);
  }

  @Post(':token/otp')
  otp(@Param('token') token: string, @Body() body: any) {
    return this.share.requestOtp(token, body?.sid, body?.email);
  }

  @Post(':token/verify')
  verify(@Req() req: any, @Param('token') token: string, @Body() body: any) {
    return this.share.verify(token, body?.sid, body?.code, body?.deviceKey, this.clientIp(req));
  }

  @Post(':token/status')
  status(@Req() req: any, @Param('token') token: string, @Body() body: any) {
    return this.share.status(token, body?.sid, body?.deviceKey, this.clientIp(req));
  }

  @Post(':token/token')
  refresh(@Req() req: any, @Param('token') token: string, @Body() body: any) {
    return this.share.refreshToken(token, body?.sid, this.clientIp(req), body?.deviceKey);
  }

  @Get(':token/view/image')
  async image(@Req() req: any, @Param('token') token: string, @Query('vt') vt: string, @Query('dk') dk: string, @Res() res: any) {
    const { s, wm } = await this.share.authorizeRendition(token, vt, this.clientIp(req), dk);
    const r = await this.viewing.viewImage(s, wm);
    this.secureHeaders(res, r.type); this.send(res, r);
  }

  @Get(':token/view/page/:n')
  async page(@Req() req: any, @Param('token') token: string, @Param('n') n: string, @Query('vt') vt: string, @Query('dk') dk: string, @Res() res: any) {
    const { s, wm } = await this.share.authorizeRendition(token, vt, this.clientIp(req), dk);
    const r = await this.viewing.viewPdfPage(s, Number(n), wm);
    this.secureHeaders(res, r.type); this.send(res, r);
  }

  @Get(':token/view/video')
  async video(@Req() req: any, @Param('token') token: string, @Query('vt') vt: string, @Query('dk') dk: string, @Res() res: any) {
    const { s, wm } = await this.share.authorizeRendition(token, vt, this.clientIp(req), dk);
    const r = await this.viewing.viewVideo(s, wm);
    this.secureHeaders(res, r.type); this.send(res, r);
  }

  @Get(':token/view/audio')
  async audio(@Req() req: any, @Param('token') token: string, @Query('vt') vt: string, @Query('dk') dk: string, @Res() res: any) {
    const { s } = await this.share.authorizeRendition(token, vt, this.clientIp(req), dk);
    const r = await this.viewing.viewAudio(s);
    this.secureHeaders(res, r.type); this.send(res, r);
  }

  @Get(':token/view/text')
  async text(@Req() req: any, @Param('token') token: string, @Query('vt') vt: string, @Query('dk') dk: string, @Res() res: any) {
    const { s } = await this.share.authorizeRendition(token, vt, this.clientIp(req), dk);
    const r = await this.viewing.viewText(s);
    this.secureHeaders(res, r.type); res.send(r.data);
  }
}

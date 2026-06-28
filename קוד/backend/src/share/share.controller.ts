// share.controller.ts — ניהול קישורי צפייה חיצוניים (שלב 3.5). דורש הרשאת links.manage.
// GET /share-links · GET /share-links/pending · GET /share-links/file/:fileId
// POST /share-links · POST /share-links/:id/revoke · POST /share-links/sessions/:sid/approve
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { ShareService } from './share.service';

@Controller('share-links')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.LINKS_MANAGE)
  list() { return this.share.listAll(); }

  @Get('pending')
  @RequirePermissions(PERMISSIONS.LINKS_MANAGE)
  pending() { return this.share.pendingApprovals(); }

  @Get('file/:fileId')
  @RequirePermissions(PERMISSIONS.LINKS_MANAGE)
  forFile(@Param('fileId') fileId: string) { return this.share.listForFile(fileId); }

  @Post()
  @RequirePermissions(PERMISSIONS.LINKS_MANAGE)
  create(@Req() req: any, @Body() body: any) { return this.share.create(req.user.sub, body); }

  @Post(':id/revoke')
  @RequirePermissions(PERMISSIONS.LINKS_MANAGE)
  revoke(@Req() req: any, @Param('id') id: string) { return this.share.revoke(req.user.sub, id); }

  @Post('sessions/:sid/approve')
  @RequirePermissions(PERMISSIONS.LINKS_MANAGE)
  approve(@Req() req: any, @Param('sid') sid: string) { return this.share.approveSession(req.user.sub, sid); }
}

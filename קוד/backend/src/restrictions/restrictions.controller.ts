// restrictions.controller.ts — ניהול הגבלות צפייה (שלב 3.4). דורש הרשאת security.manage.
// GET  /restrictions            — כל ההגבלות (ריכוז)
// GET  /restrictions/meta       — משתמשים + מכשירים מאושרים לטופס
// GET  /restrictions/file/:id   — ההגבלות של קובץ מסוים
// POST /restrictions            — יצירת הגבלה
// PATCH /restrictions/:id        — עדכון תנאים (תפוגה/כמות/הערה)
// POST /restrictions/:id/revoke — ביטול מיידי
import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { RestrictionsService } from './restrictions.service';

@Controller('restrictions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RestrictionsController {
  constructor(private readonly restrictions: RestrictionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SECURITY_MANAGE)
  list() { return this.restrictions.listAll(); }

  @Get('meta')
  @RequirePermissions(PERMISSIONS.SECURITY_MANAGE)
  meta() { return this.restrictions.meta(); }

  @Get('file/:fileId')
  @RequirePermissions(PERMISSIONS.SECURITY_MANAGE)
  forFile(@Param('fileId') fileId: string) { return this.restrictions.listForFile(fileId); }

  @Post()
  @RequirePermissions(PERMISSIONS.SECURITY_MANAGE)
  create(@Req() req: any, @Body() body: any) { return this.restrictions.create(req.user.sub, body); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SECURITY_MANAGE)
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.restrictions.update(req.user.sub, id, body); }

  @Post(':id/revoke')
  @RequirePermissions(PERMISSIONS.SECURITY_MANAGE)
  revoke(@Req() req: any, @Param('id') id: string) { return this.restrictions.revoke(req.user.sub, id); }
}

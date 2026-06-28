// watermark.controller.ts — ניהול תבניות סימן מים גמישות (שלב 3.8). דורש הרשאת watermark.create.
// GET /watermarks · POST /watermarks · PATCH /watermarks/:id · POST /watermarks/:id/enable|disable
// POST /watermarks/:id/logo (העלאת לוגו) · DELETE /watermarks/:id
import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { WatermarkService } from './watermark.service';

@Controller('watermarks')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WatermarkController {
  constructor(private readonly wm: WatermarkService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WATERMARK_CREATE)
  list() { return this.wm.list(); }

  @Post()
  @RequirePermissions(PERMISSIONS.WATERMARK_CREATE)
  create(@Req() req: any, @Body() body: any) {
    if (!body?.name) throw new BadRequestException('חסר שם לתבנית');
    return this.wm.create(req.user.sub, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.WATERMARK_CREATE)
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.wm.update(req.user.sub, id, body); }

  @Post(':id/enable')
  @RequirePermissions(PERMISSIONS.WATERMARK_CREATE)
  enable(@Req() req: any, @Param('id') id: string) { return this.wm.setEnabled(req.user.sub, id, true); }

  @Post(':id/disable')
  @RequirePermissions(PERMISSIONS.WATERMARK_CREATE)
  disable(@Req() req: any, @Param('id') id: string) { return this.wm.setEnabled(req.user.sub, id, false); }

  @Post(':id/logo')
  @RequirePermissions(PERMISSIONS.WATERMARK_CREATE)
  @UseInterceptors(FileInterceptor('file'))
  logo(@Req() req: any, @Param('id') id: string, @UploadedFile() file: any) {
    if (!file?.buffer) throw new BadRequestException('לא הועלה קובץ');
    return this.wm.saveLogo(req.user.sub, id, file.buffer);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.WATERMARK_CREATE)
  remove(@Req() req: any, @Param('id') id: string) { return this.wm.remove(req.user.sub, id); }
}

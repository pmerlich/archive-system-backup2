// render.controller.ts — נקודות קצה לתור העיבוד (שלב 4.5).
// GET  /render/jobs        — רשימת משימות (סטטוס/התקדמות)            (files.view)
// GET  /render/jobs/:id    — סטטוס משימה בודדת                       (files.view)
// POST /render/jobs/edit   — הוספת עריכת-תמונה לתור { fileId, recipe, label? }  (media.edit)
// POST /render/jobs/:id/cancel — ביטול משימה ממתינה                  (media.edit)
import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { RenderService } from './render.service';

@Controller('render')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RenderController {
  constructor(private readonly render: RenderService) {}

  @Get('jobs')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  list(@Req() req: any, @Query() q: any) {
    return this.render.list({ status: q.status, mine: q.mine === 'true' || q.mine === '1', userId: req.user.sub, page: Number(q.page), pageSize: Number(q.pageSize) });
  }

  @Get('jobs/:id')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  get(@Param('id') id: string) {
    return this.render.get(id);
  }

  @Post('jobs/edit')
  @RequirePermissions(PERMISSIONS.MEDIA_EDIT)
  enqueueEdit(@Req() req: any, @Body() body: any) {
    if (!body?.fileId) throw new BadRequestException('חסר מזהה קובץ');
    return this.render.enqueue(req.user.sub, 'edit', body.fileId, { recipe: body.recipe, label: body.label });
  }

  @Post('jobs/:id/cancel')
  @RequirePermissions(PERMISSIONS.MEDIA_EDIT)
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.render.cancel(req.user.sub, id);
  }
}

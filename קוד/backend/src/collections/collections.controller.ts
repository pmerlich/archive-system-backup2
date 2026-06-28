// collections.controller.ts — נקודות הקצה לאוספים חכמים (שלב 2.3).
// GET /collections · GET /collections/:id · POST /collections · PATCH /collections/:id · DELETE /collections/:id
// צפייה/יצירה דורשות files.view; עריכה/מחיקה נבדקות בשירות (יוצר או בעלים בלבד).
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { CollectionsService } from './collections.service';

@Controller('collections')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  list() {
    return this.collections.list();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  get(@Param('id') id: string) {
    return this.collections.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  create(@Req() req: any, @Body() body: any) {
    return this.collections.create(req.user.sub, body?.name, body?.filters);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.collections.update(req.user.sub, id, { name: body?.name, filters: body?.filters });
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  remove(@Req() req: any, @Param('id') id: string) {
    return this.collections.remove(req.user.sub, id);
  }
}

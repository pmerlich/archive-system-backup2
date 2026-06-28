// tags.controller.ts — נקודות הקצה לניהול תגיות.
// GET /tags · GET /tags/meta · POST /tags · PATCH /tags/:id · DELETE /tags/:id
// צפייה דורשת "צפייה בקבצים"; יצירה/עריכה/מחיקה דורשות "תגיות" (files.tag).
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { TAG_TYPES, SENSITIVITY_LEVELS } from './tag-catalog';

@Controller('tags')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  list() {
    return this.tags.list();
  }

  // עץ התגיות (תגיות ותת-תגיות מקוננות).
  @Get('tree')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  tree() {
    return this.tags.listTree();
  }

  // סוגי התגיות ורמות הרגישות הזמינים — לטעינת התפריטים במסך.
  @Get('meta')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  meta() {
    return { types: TAG_TYPES, sensitivities: SENSITIVITY_LEVELS };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FILES_TAG)
  create(@Req() req: any, @Body() dto: CreateTagDto) {
    return this.tags.create(req.user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.FILES_TAG)
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTagDto) {
    return this.tags.update(req.user.sub, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.FILES_TAG)
  remove(@Req() req: any, @Param('id') id: string) {
    return this.tags.remove(req.user.sub, id);
  }
}

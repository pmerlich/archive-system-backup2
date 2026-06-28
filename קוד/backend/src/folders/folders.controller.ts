// folders.controller.ts — נקודות הקצה לניהול תיקיות.
// GET /folders (עץ) · GET /folders/trash · POST /folders · PATCH /folders/:id · DELETE /folders/:id · POST /folders/:id/restore
// כל פעולה דורשת הרשאה מתאימה (ברירת מחדל: אין גישה).
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { FoldersService } from './folders.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';

@Controller('folders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  // עץ התיקיות — לכל מי שמורשה לצפות בקבצים.
  @Get()
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  tree() {
    return this.folders.listTree();
  }

  // סל המחזור (תיקיות מחוקות) — למי שמורשה לשחזר.
  @Get('trash')
  @RequirePermissions(PERMISSIONS.FILES_RESTORE)
  trash() {
    return this.folders.listDeleted();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FOLDERS_MANAGE)
  create(@Req() req: any, @Body() dto: CreateFolderDto) {
    return this.folders.create(req.user.sub, dto.name, dto.parentId ?? null);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.FOLDERS_MANAGE)
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateFolderDto) {
    return this.folders.update(req.user.sub, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.FILES_DELETE)
  remove(@Req() req: any, @Param('id') id: string) {
    return this.folders.softDelete(req.user.sub, id);
  }

  @Post(':id/restore')
  @RequirePermissions(PERMISSIONS.FILES_RESTORE)
  restore(@Req() req: any, @Param('id') id: string) {
    return this.folders.restore(req.user.sub, id);
  }
}

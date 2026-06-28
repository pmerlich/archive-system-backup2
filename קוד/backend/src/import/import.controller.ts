// import.controller.ts — נקודות הקצה לייבוא מדיסקים (שלב 1.7). הכול דורש הרשאת files.import.
// POST /import/scan · POST /import/:id/hash · POST /import/:id/import · GET /import · GET /import/:id · GET /import/:id/items
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { ImportService } from './import.service';
import { ScanImportDto } from './dto/scan-import.dto';

@Controller('import')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  // יצירת סריקה (מונה קבצים בדיסק; קריאה בלבד).
  @Post('scan')
  @RequirePermissions(PERMISSIONS.FILES_IMPORT)
  scan(@Req() req: any, @Body() dto: ScanImportDto) {
    return this.imports.createScan(req.user.sub, dto.sourcePath, dto.label);
  }

  // אצוות חישוב Hash + השוואה למאגר (סריקה בלבד). קוראים שוב עד status='scanned'.
  @Post(':id/hash')
  @RequirePermissions(PERMISSIONS.FILES_IMPORT)
  hash(@Req() req: any, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.imports.hashBatch(req.user.sub, id, limit ? parseInt(limit, 10) : 25);
  }

  // אצוות ייבוא בפועל (העתקת חדשים). קוראים שוב עד status='completed'.
  @Post(':id/import')
  @RequirePermissions(PERMISSIONS.FILES_IMPORT)
  run(@Req() req: any, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.imports.importBatch(req.user.sub, id, limit ? parseInt(limit, 10) : 25);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.FILES_IMPORT)
  list() {
    return this.imports.list();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FILES_IMPORT)
  get(@Param('id') id: string) {
    return this.imports.get(id);
  }

  // ה-Manifest (שורות הקבצים). סינון לפי מצב: ?status=new|duplicate|imported|error
  @Get(':id/items')
  @RequirePermissions(PERMISSIONS.FILES_IMPORT)
  items(@Param('id') id: string, @Query('status') status?: string, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.imports.manifest(id, { status, skip: skip ? parseInt(skip, 10) : 0, take: take ? parseInt(take, 10) : 100 });
  }
}

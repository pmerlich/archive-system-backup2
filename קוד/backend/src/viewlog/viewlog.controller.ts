// viewlog.controller.ts — נקודות קצה ללוג הצפיות (שלב 3.6). קריאה בלבד; דורש logs.view.
// אין כאן שום פעולת כתיבה — אי אפשר ליצור/לשנות/למחוק רשומות צפייה (מניעת זיוף/מחיקה).
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { ViewlogService } from './viewlog.service';

@Controller('view-log')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ViewlogController {
  constructor(private readonly viewlog: ViewlogService) {}

  // הלוג המאוחד של הפעלות צפייה (פנימיות + קישורים).
  @Get()
  @RequirePermissions(PERMISSIONS.LOGS_VIEW)
  sessions(
    @Query('fileId') fileId?: string,
    @Query('userId') userId?: string,
    @Query('linkId') linkId?: string,
    @Query('kind') kind?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.viewlog.sessions({
      fileId,
      userId,
      linkId,
      kind: kind === 'internal' || kind === 'share' ? kind : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  // סיכום לכל קישור צפייה (מי יצר / למי נשלח / תנאים / פתיחות / סטטוס).
  @Get('links')
  @RequirePermissions(PERMISSIONS.LOGS_VIEW)
  links(
    @Query('fileId') fileId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.viewlog.links({
      fileId,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}

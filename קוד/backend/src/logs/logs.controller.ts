// logs.controller.ts — נקודת קצה לקריאת לוג הביקורת (שלב 2.6). קריאה בלבד; דורש logs.view.
// סינון אופציונלי לפי יעד (targetType+targetId — קובץ/תיקייה/משתמש), מבצע (userId), או סוג פעולה (action).
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { LogsService } from './logs.service';

@Controller('logs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.LOGS_VIEW)
  query(
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.logs.query({
      targetType,
      targetId,
      userId,
      action,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}

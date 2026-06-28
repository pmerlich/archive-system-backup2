// stats.controller.ts — נקודת קצה ללוח הבקרה החי (שלב 2.7). דורש הרשאת צפייה בקבצים.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { StatsService } from './stats.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  dashboard() {
    return this.stats.dashboard();
  }
}

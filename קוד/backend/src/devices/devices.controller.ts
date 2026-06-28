// devices.controller.ts — ניהול מכשירים מאושרים (שלב 3.3). דורש הרשאת security.manage.
// GET /devices · POST /devices/:id/approve · POST /devices/:id/revoke
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { DevicesService } from './devices.service';

@Controller('devices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SECURITY_MANAGE)
  list() { return this.devices.list(); }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.SECURITY_MANAGE)
  approve(@Req() req: any, @Param('id') id: string) { return this.devices.approve(req.user.sub, id); }

  @Post(':id/revoke')
  @RequirePermissions(PERMISSIONS.SECURITY_MANAGE)
  revoke(@Req() req: any, @Param('id') id: string) { return this.devices.revoke(req.user.sub, id); }
}

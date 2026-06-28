// access.controller.ts — ניהול כללי הרשאות גישה (שלב 3.9). דורש security.manage.
// GET /access · GET /access/meta · POST /access · POST /access/:id/revoke · POST /access/users/:id/scoped-view
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { AccessService } from './access.service';

@Controller('access')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SECURITY_MANAGE)
  list() { return this.access.listAll(); }

  @Get('meta')
  @RequirePermissions(PERMISSIONS.SECURITY_MANAGE)
  meta() { return this.access.meta(); }

  @Post()
  @RequirePermissions(PERMISSIONS.SECURITY_MANAGE)
  create(@Req() req: any, @Body() body: any) { return this.access.create(req.user.sub, body); }

  @Post(':id/revoke')
  @RequirePermissions(PERMISSIONS.SECURITY_MANAGE)
  revoke(@Req() req: any, @Param('id') id: string) { return this.access.revoke(req.user.sub, id); }

  @Post('users/:id/scoped-view')
  @RequirePermissions(PERMISSIONS.SECURITY_MANAGE)
  scopedView(@Req() req: any, @Param('id') id: string, @Body('scopedView') scopedView: boolean) { return this.access.setScopedView(req.user.sub, id, scopedView); }
}

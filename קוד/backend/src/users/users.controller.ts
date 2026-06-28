// users.controller.ts — נקודות הקצה לניהול משתמשים והרשאות.
// כל הנתיבים כאן מוגנים בהרשאת "ניהול משתמשים והרשאות" (USERS_MANAGE) — ברירת מחדל: אין גישה.
// GET /users · GET /users/roles · PATCH /users/:id/role
import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS, PERMISSION_LABELS } from '../auth/permissions';
import { UsersService } from './users.service';
import { RolesService } from '../roles/roles.service';
import { ChangeRoleDto } from './dto/change-role.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.USERS_MANAGE)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly roles: RolesService,
  ) {}

  // רשימת כל המשתמשים והתפקיד של כל אחד.
  @Get()
  list() {
    return this.users.listUsers();
  }

  // רשימת התפקידים הזמינים + תוויות ההרשאות (להצגה במסך הניהול).
  @Get('roles')
  async listRoles() {
    const roles = await this.roles.listRoles();
    return { roles, labels: PERMISSION_LABELS };
  }

  // שינוי תפקיד למשתמש. הזהות של מבצע הפעולה נלקחת מהטוקן ומה-PermissionsGuard.
  @Patch(':id/role')
  changeRole(@Req() req: any, @Param('id') id: string, @Body() dto: ChangeRoleDto) {
    return this.users.changeRole({ id: req.user.sub, isOwner: !!req.isOwner }, id, dto.roleKey);
  }
}

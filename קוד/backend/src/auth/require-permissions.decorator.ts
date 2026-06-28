// require-permissions.decorator.ts — מסמן נתיב כדורש הרשאות מסוימות.
// שימוש: @RequirePermissions(PERMISSIONS.USERS_MANAGE) מעל פעולה בקונטרולר.
import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS_KEY, perms);

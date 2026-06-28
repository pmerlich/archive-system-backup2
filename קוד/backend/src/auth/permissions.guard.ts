// permissions.guard.ts — אוכף הרשאות לפי התפקיד של המשתמש.
// עיקרון: ברירת המחדל היא "אין גישה". התפקיד נטען מחדש מה-DB בכל בקשה,
// כך שביטול/שינוי תפקיד נכנס לתוקף מיד (בלי להמתין שהטוקן יפוג).
// חייב לרוץ אחרי JwtAuthGuard (שמגדיר req.user.sub).
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS_KEY } from './require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const req = context.switchToHttp().getRequest();
    const userId = req.user?.sub;
    if (!userId) throw new UnauthorizedException('נדרשת התחברות');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user || user.deletedAt) throw new UnauthorizedException('המשתמש אינו קיים');

    // מצרפים את פרטי המשתמש והתפקיד לבקשה — נוח לשימוש בהמשך השרשרת.
    req.dbUser = user;
    req.isOwner = user.role.isOwner;
    req.permissions = user.role.isOwner ? 'all' : user.role.permissions;

    if (required.length === 0) return true; // מוגן בלי דרישת הרשאה מסוימת — די בכך שמחובר
    if (user.role.isOwner) return true; // בעלים עוקף את כל הבדיקות

    const allowed = required.every((p) => user.role.permissions.includes(p));
    if (!allowed) throw new ForbiddenException('אין לך הרשאה לבצע את הפעולה הזו');
    return true;
  }
}

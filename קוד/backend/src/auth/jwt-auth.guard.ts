// jwt-auth.guard.ts — שומר שמוודא טוקן התחברות תקין (Bearer) לפני גישה לנתיב מוגן.
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('נדרשת התחברות');
    }
    try {
      const payload = this.jwt.verify(header.slice(7), { algorithms: ['HS256'] });
      // טוקני מטרה (purpose=view לצפייה מוגנת / purpose=share לשיתוף חיצוני) משמשים רק לנתיבים הייעודיים — לא כטוקן התחברות.
      if (payload && payload.purpose) {
        throw new UnauthorizedException('טוקן לא תקין');
      }
      req.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('טוקן לא תקין או פג תוקף');
    }
  }
}

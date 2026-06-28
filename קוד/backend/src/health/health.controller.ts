// health.controller.ts — נקודת קצה לבדיקת תקינות.
// מאשרת שהשרת חי ושיש חיבור תקין למסד הנתונים. כתובת: GET /health
import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: string; database: string; time: string }> {
    let database = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }
    return { status: 'ok', database, time: new Date().toISOString() };
  }
}

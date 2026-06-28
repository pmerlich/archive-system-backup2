// prisma.service.ts — שירות מרכזי לגישה למסד הנתונים.
// כל מודול שצריך גישה ל-DB מזריק (inject) את השירות הזה, במקום ליצור חיבור משלו.
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

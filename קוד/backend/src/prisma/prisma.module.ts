// prisma.module.ts — מודול גלובלי שמספק את PrismaService לכל המערכת.
// "גלובלי" = מספיק לייבא אותו פעם אחת, והוא זמין בכל מקום.
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

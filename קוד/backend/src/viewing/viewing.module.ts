// viewing.module.ts — מודול הצפייה המוגנת (שלב 3.1). מסתמך על AuthModule ל-JWT והשומרים, ועל Prisma.
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WatermarkModule } from '../watermark/watermark.module';
import { ViewingService } from './viewing.service';
import { ViewingController } from './viewing.controller';

@Module({
  imports: [AuthModule, WatermarkModule],
  controllers: [ViewingController],
  providers: [ViewingService],
  exports: [ViewingService],
})
export class ViewingModule {}

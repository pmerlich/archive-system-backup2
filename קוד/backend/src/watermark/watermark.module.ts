// watermark.module.ts — מודול תבניות סימן מים (שלב 3.2). מייצא את השירות כדי שמנוע הצפייה ישתמש בתבנית הפעילה.
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WatermarkService } from './watermark.service';
import { WatermarkController } from './watermark.controller';

@Module({
  imports: [AuthModule],
  controllers: [WatermarkController],
  providers: [WatermarkService],
  exports: [WatermarkService],
})
export class WatermarkModule {}

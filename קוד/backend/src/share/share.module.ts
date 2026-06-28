// share.module.ts — מודול קישורי הצפייה החיצוניים (שלב 3.5).
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { WatermarkModule } from '../watermark/watermark.module';
import { ViewingModule } from '../viewing/viewing.module';
import { ShareService } from './share.service';
import { ShareController } from './share.controller';
import { SharePublicController } from './share-public.controller';

@Module({
  imports: [AuthModule, MailModule, WatermarkModule, ViewingModule],
  controllers: [ShareController, SharePublicController],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}

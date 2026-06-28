// media.module.ts — מודול עריכת המדיה (שלב 4.1). נשען על AuthModule (שומרים), FilesModule (יצירת קובץ נגזר),
// ו-ViewingModule (תמונת בסיס ממוזערת). Prisma ו-AccessService זמינים גלובלית.
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { ViewingModule } from '../viewing/viewing.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [AuthModule, FilesModule, ViewingModule],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}

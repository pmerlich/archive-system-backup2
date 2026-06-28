// files.module.ts — מודול הקבצים (העלאה, רשימה, הורדה, מחיקה/שחזור).
import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { AuthModule } from '../auth/auth.module';
import { TagsModule } from '../tags/tags.module';

@Module({
  imports: [AuthModule, TagsModule], // TagsModule — לחישוב צאצאי תגית בסינון
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}

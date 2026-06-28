// import.module.ts — מודול הייבוא מדיסקים (שלב 1.7). משתמש ב-FilesService לאחסון לפי תוכן.
import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [AuthModule, FilesModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}

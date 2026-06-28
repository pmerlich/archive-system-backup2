// tags.module.ts — מודול ניהול התגיות.
import { Module } from '@nestjs/common';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [TagsController],
  providers: [TagsService],
  exports: [TagsService], // כדי שמודול הקבצים יוכל לחשב צאצאים לסינון
})
export class TagsModule {}

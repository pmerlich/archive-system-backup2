// render.module.ts — מודול תור העיבוד (שלב 4.5). מסתמך על AuthModule (שומרים) ו-MediaModule (מנוע העריכה).
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { RenderController } from './render.controller';
import { RenderService } from './render.service';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [RenderController],
  providers: [RenderService],
  exports: [RenderService],
})
export class RenderModule {}

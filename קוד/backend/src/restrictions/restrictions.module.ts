// restrictions.module.ts — מודול הגבלות הצפייה (שלב 3.4).
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RestrictionsService } from './restrictions.service';
import { RestrictionsController } from './restrictions.controller';

@Module({
  imports: [AuthModule],
  controllers: [RestrictionsController],
  providers: [RestrictionsService],
  exports: [RestrictionsService],
})
export class RestrictionsModule {}

// logs.module.ts — מודול לוג הביקורת (קריאה בלבד, שלב 2.6).
import { Module } from '@nestjs/common';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [LogsController],
  providers: [LogsService],
})
export class LogsModule {}

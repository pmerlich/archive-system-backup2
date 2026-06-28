// viewlog.module.ts — מודול לוג הצפיות (קריאה בלבד, שלב 3.6).
import { Module } from '@nestjs/common';
import { ViewlogController } from './viewlog.controller';
import { ViewlogService } from './viewlog.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ViewlogController],
  providers: [ViewlogService],
})
export class ViewlogModule {}

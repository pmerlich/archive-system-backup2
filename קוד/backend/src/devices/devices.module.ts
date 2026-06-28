// devices.module.ts — מודול ניהול מכשירים (שלב 3.3).
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';

@Module({
  imports: [AuthModule],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}

// users.module.ts — מודול ניהול המשתמשים.
// מייבא את AuthModule כדי לקבל את שומרי ההרשאות (JwtAuthGuard, PermissionsGuard) ו-JWT.
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}

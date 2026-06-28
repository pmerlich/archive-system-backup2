// auth.module.ts — מאגד את רכיבי ההתחברות, ומגדיר את חתימת ה-JWT מהתצורה.
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwtSecret'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, PermissionsGuard],
  // מייצאים את השומרים ואת JWT כדי שמודולים אחרים (כמו Users) יוכלו לאכוף הרשאות.
  exports: [JwtAuthGuard, PermissionsGuard, JwtModule],
})
export class AuthModule {}

// auth.controller.ts — נקודות הקצה של ההתחברות.
// POST /auth/register · POST /auth/login · GET /auth/me (מוגן בטוקן)
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ConfirmOtpDto } from './dto/confirm-otp.dto';
import { DisableTwoFactorDto } from './dto/disable-2fa.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.auth.me(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(req.user.sub, dto);
  }

  // אימות הקוד שנשלח למייל בעת כניסה (שלב שני) — מחזיר טוקן.
  @Post('2fa/login-verify')
  loginVerify(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyLoginOtp(dto.email, dto.code, dto.deviceId);
  }

  // הפעלת 2FA: שליחת קוד אישור למייל.
  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  enable2fa(@Req() req: any) {
    return this.auth.request2FAEnable(req.user.sub);
  }

  // אישור הפעלת 2FA עם הקוד.
  @UseGuards(JwtAuthGuard)
  @Post('2fa/confirm')
  confirm2fa(@Req() req: any, @Body() dto: ConfirmOtpDto) {
    return this.auth.confirm2FAEnable(req.user.sub, dto.code);
  }

  // כיבוי 2FA (דורש סיסמה).
  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  disable2fa(@Req() req: any, @Body() dto: DisableTwoFactorDto) {
    return this.auth.disable2FA(req.user.sub, dto.password);
  }
}

// verify-otp.dto.ts — אימות קוד חד-פעמי בכניסה (מייל + קוד בן 6 ספרות).
import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsEmail({}, { message: 'כתובת מייל לא תקינה' })
  email!: string;

  @Matches(/^\d{6}$/, { message: 'הקוד חייב להיות בן 6 ספרות' })
  code!: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}

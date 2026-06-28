// login.dto.ts — שדות הכניסה.
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'כתובת מייל לא תקינה' })
  email!: string;

  @IsString()
  password!: string;

  // התחברות מה-Reader: מזהה המכשיר (אם קיים) — מפעיל בדיקת אישור מכשיר.
  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  deviceName?: string;
}

// register.dto.ts — שדות והבדיקות להרשמת משתמש חדש.
import { IsEmail, IsString, MinLength } from 'class-validator';
import { IsStrongPassword } from '../password.policy';

export class RegisterDto {
  @IsEmail({}, { message: 'כתובת מייל לא תקינה' })
  email!: string;

  @IsString()
  @MinLength(2, { message: 'שם קצר מדי' })
  name!: string;

  @IsStrongPassword()
  password!: string;
}

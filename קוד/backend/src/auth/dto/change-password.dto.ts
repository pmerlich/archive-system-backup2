// change-password.dto.ts — שדות לשינוי סיסמה: הסיסמה הנוכחית והחדשה (החדשה לפי מדיניות הסיסמה).
import { IsString } from 'class-validator';
import { IsStrongPassword } from '../password.policy';

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsStrongPassword()
  newPassword!: string;
}

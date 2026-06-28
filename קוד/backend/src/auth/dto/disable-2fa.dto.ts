// disable-2fa.dto.ts — כיבוי אימות דו-שלבי דורש אישור סיסמה.
import { IsString } from 'class-validator';

export class DisableTwoFactorDto {
  @IsString()
  password!: string;
}

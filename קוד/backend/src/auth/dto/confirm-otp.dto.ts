// confirm-otp.dto.ts — אישור קוד להפעלת אימות דו-שלבי.
import { Matches } from 'class-validator';

export class ConfirmOtpDto {
  @Matches(/^\d{6}$/, { message: 'הקוד חייב להיות בן 6 ספרות' })
  code!: string;
}

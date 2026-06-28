// password.policy.ts — מדיניות סיסמה אחת לכל המערכת (הרשמה ושינוי סיסמה).
// הדרישה: לפחות 10 תווים, אות גדולה (A-Z), אות קטנה (a-z), ספרה (0-9), ותו מיוחד.
import { applyDecorators } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';

export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{10,}$/;

export const PASSWORD_MESSAGE =
  'הסיסמה חייבת לכלול לפחות 10 תווים, אות גדולה (A-Z), אות קטנה (a-z), ספרה (0-9), ותו מיוחד (כמו ‎!@#$‎)';

// דקורטור לשימוש חוזר ב-DTO: מאמת שהשדה הוא מחרוזת שעומדת במדיניות.
export function IsStrongPassword() {
  return applyDecorators(IsString(), Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE }));
}

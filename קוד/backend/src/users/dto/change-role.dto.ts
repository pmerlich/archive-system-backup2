// change-role.dto.ts — גוף הבקשה לשינוי תפקיד של משתמש.
import { IsString, MinLength } from 'class-validator';

export class ChangeRoleDto {
  @IsString()
  @MinLength(2, { message: 'יש לבחור תפקיד' })
  roleKey!: string;
}

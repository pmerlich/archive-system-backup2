// create-folder.dto.ts — גוף הבקשה ליצירת תיקייה.
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @MinLength(1, { message: 'יש להזין שם תיקייה' })
  @MaxLength(200, { message: 'שם התיקייה ארוך מדי' })
  name!: string;

  // null או חסר = תיקיית שורש; אחרת מזהה תיקיית האב.
  @IsOptional()
  @IsString()
  parentId?: string | null;
}

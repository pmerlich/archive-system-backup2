// update-folder.dto.ts — גוף הבקשה לשינוי שם ו/או העברת תיקייה.
// name — שם חדש (לא חובה). parentId — תיקיית אב חדשה; null = העברה לשורש.
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateFolderDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'שם התיקייה ריק' })
  @MaxLength(200, { message: 'שם התיקייה ארוך מדי' })
  name?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;
}

// update-tag.dto.ts — גוף הבקשה לעדכון תגית (שם / סוג / רמת רגישות).
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TAG_TYPE_KEYS, SENSITIVITY_KEYS } from '../tag-catalog';

export class UpdateTagDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'שם התגית ריק' })
  @MaxLength(100, { message: 'שם התגית ארוך מדי' })
  name?: string;

  @IsOptional()
  @IsIn(TAG_TYPE_KEYS, { message: 'סוג תגית לא חוקי' })
  type?: string;

  @IsOptional()
  @IsIn(SENSITIVITY_KEYS, { message: 'רמת רגישות לא חוקית' })
  sensitivity?: string;

  // העברה: תגית-אב חדשה; null = הפיכה לתגית שורש.
  @IsOptional()
  @IsString()
  parentId?: string | null;
}

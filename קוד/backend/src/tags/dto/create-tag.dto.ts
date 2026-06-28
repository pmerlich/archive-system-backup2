// create-tag.dto.ts — גוף הבקשה ליצירת תגית.
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TAG_TYPE_KEYS, SENSITIVITY_KEYS } from '../tag-catalog';

export class CreateTagDto {
  @IsString()
  @MinLength(1, { message: 'יש להזין שם תגית' })
  @MaxLength(100, { message: 'שם התגית ארוך מדי' })
  name!: string;

  @IsOptional()
  @IsIn(TAG_TYPE_KEYS, { message: 'סוג תגית לא חוקי' })
  type?: string;

  @IsOptional()
  @IsIn(SENSITIVITY_KEYS, { message: 'רמת רגישות לא חוקית' })
  sensitivity?: string;

  // תגית-אב (null או חסר = תגית שורש)
  @IsOptional()
  @IsString()
  parentId?: string | null;
}

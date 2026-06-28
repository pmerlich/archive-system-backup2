// merge-duplicates.dto.ts — גוף הבקשה למיזוג כפילויות: שומרים קובץ אחד ומסירים את השאר.
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class MergeDuplicatesDto {
  @IsString()
  keepId!: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'יש לבחור קבצים להסרה' })
  @IsString({ each: true })
  removeIds!: string[];
}

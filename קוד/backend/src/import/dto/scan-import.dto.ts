// scan-import.dto.ts — קלט ליצירת סריקת ייבוא: נתיב המקור (חובה) ושם/תווית (רשות).
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ScanImportDto {
  @IsString()
  @IsNotEmpty()
  sourcePath!: string;

  @IsString()
  @IsOptional()
  label?: string;
}

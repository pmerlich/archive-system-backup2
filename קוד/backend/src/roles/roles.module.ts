// roles.module.ts — מודול גלובלי לתפקידי המערכת (זריעה + שליפה).
// גלובלי כדי ש-RolesService יהיה זמין גם ל-Auth וגם ל-Users בלי ייבוא חוזר.
import { Global, Module } from '@nestjs/common';
import { RolesService } from './roles.service';

@Global()
@Module({
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}

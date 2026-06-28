// mail.module.ts — מודול גלובלי שמספק את MailService לכל המערכת.
import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}

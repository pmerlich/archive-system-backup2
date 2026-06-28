// access.module.ts — מודול כללי ההרשאות (שלב 3.9). @Global כדי שמודולי הקבצים/הצפייה יוכלו לאכוף בלי תלות מעגלית.
import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessService } from './access.service';
import { AccessController } from './access.controller';

@Global()
@Module({ imports: [AuthModule], controllers: [AccessController], providers: [AccessService], exports: [AccessService] })
export class AccessModule {}

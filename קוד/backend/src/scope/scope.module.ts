// scope.module.ts — תשתית התאמת-טווח משותפת (סימני מים + הרשאות).
import { Global, Module } from '@nestjs/common';
import { ScopeService } from './scope.service';

@Global()
@Module({ providers: [ScopeService], exports: [ScopeService] })
export class ScopeModule {}

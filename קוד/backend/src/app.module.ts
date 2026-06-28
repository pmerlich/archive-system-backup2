// app.module.ts — המודול הראשי שמרכיב את כל חלקי השרת.
// מוסיפים כאן מודולים חדשים ככל שהמערכת גדלה (משתמשים, תיקיות, תגיות, קבצים וכו').
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { RolesModule } from './roles/roles.module';
import { UsersModule } from './users/users.module';
import { FoldersModule } from './folders/folders.module';
import { TagsModule } from './tags/tags.module';
import { FilesModule } from './files/files.module';
import { ImportModule } from './import/import.module';
import { CollectionsModule } from './collections/collections.module';
import { LogsModule } from './logs/logs.module';
import { StatsModule } from './stats/stats.module';
import { ViewingModule } from './viewing/viewing.module';
import { WatermarkModule } from './watermark/watermark.module';
import { DevicesModule } from './devices/devices.module';
import { RestrictionsModule } from './restrictions/restrictions.module';
import { ShareModule } from './share/share.module';
import { ScopeModule } from './scope/scope.module';
import { AccessModule } from './access/access.module';
import { ViewlogModule } from './viewlog/viewlog.module';
import { MediaModule } from './media/media.module';
import { RenderModule } from './render/render.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    MailModule,
    RolesModule,
    HealthModule,
    AuthModule,
    UsersModule,
    FoldersModule,
    TagsModule,
    FilesModule,
    ImportModule,
    CollectionsModule,
    LogsModule,
    StatsModule,
    ViewingModule,
    WatermarkModule,
    DevicesModule,
    RestrictionsModule,
    ShareModule,
    ScopeModule,
    AccessModule,
    ViewlogModule,
    MediaModule,
    RenderModule,
  ],
})
export class AppModule {}

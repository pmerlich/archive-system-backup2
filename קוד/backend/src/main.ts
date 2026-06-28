// main.ts — נקודת הכניסה של השרת. מפעיל את NestJS ומאזין על הפורט מהתצורה.
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // בפיתוח — מאפשר לאתר המקומי לדבר עם השרת
  app.enableCors();

  // בדיקת תקינות של נתונים נכנסים (DTO)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 4000;

  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Backend running on port ${port}`);
}

bootstrap();

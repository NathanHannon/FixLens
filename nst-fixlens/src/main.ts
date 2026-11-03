import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { JsonErrorFilter } from './common/errors.js';
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '512kb' });
  // Native clients do not use CORS; these origins allow the local Expo web preview.
  app.enableCors({
    origin: (
      process.env.CORS_ORIGINS ??
      'http://localhost:8081,http://127.0.0.1:8081,http://localhost:8082,http://127.0.0.1:8082'
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new JsonErrorFilter());
  app.enableShutdownHooks();
  await app.listen(
    app.get(ConfigService).getOrThrow<number>('PORT'),
    '0.0.0.0',
  );
}
void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

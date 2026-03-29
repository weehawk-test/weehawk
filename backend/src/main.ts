import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

function resolveCorsOrigin(corsEnv: string | undefined): boolean | string[] {
  const raw = corsEnv?.trim();
  if (!raw) {
    Logger.warn(
      'CORS_ORIGIN is not set in environment; cross-origin browser requests are blocked. Add CORS_ORIGIN to your .env file.',
    );
    return false;
  }
  const lower = raw.toLowerCase();
  if (lower === '*' || lower === 'true') {
    return true;
  }
  const list = raw.split(',').map((o) => o.trim()).filter(Boolean);
  return list.length > 0 ? list : false;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const origin = resolveCorsOrigin(configService.get<string>('CORS_ORIGIN'));

  app.enableCors({
    origin,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
    exposedHeaders: ['Content-Disposition'],
  });

  const config = new DocumentBuilder()
    .setTitle('weehawk api')
    .setDescription('')
    .setVersion('1.0')
    .addTag('users')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('swagger', app, document);

  await app.listen(process.env.PORT ?? 8080);
}
bootstrap();

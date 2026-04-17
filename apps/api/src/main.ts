import './load-docker-secrets';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WsAdapter } from '@nestjs/platform-ws';
import { createSecretKeyMiddleware } from './common/middleware/secret-key.middleware';

function resolveCorsOrigin(corsEnv: string | undefined): boolean | string[] {
  const raw = corsEnv?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      Logger.warn(
        'CORS_ORIGIN is not set; browser requests from other origins are blocked. Set CORS_ORIGIN in .env (comma-separated URLs).',
      );
      return false;
    }
    Logger.warn(
      'CORS_ORIGIN is not set; reflecting the request Origin (OK for local dev on any port). Set CORS_ORIGIN for production.',
    );
    return true;
  }
  const lower = raw.toLowerCase();
  if (lower === '*' || lower === 'true') {
    return true;
  }
  const list = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return list.length > 0 ? list : false;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useWebSocketAdapter(new WsAdapter(app));
  const configService = app.get(ConfigService);
  const origin = resolveCorsOrigin(configService.get<string>('CORS_ORIGIN'));

  app.enableCors({
    origin,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Weehawk-Api-Key',
      'Accept',
      'Origin',
      'X-Requested-With',
    ],
    exposedHeaders: [
      'Content-Disposition',
      // Required so browser fetch() can read throttling / rate-limit headers cross-origin
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
  });
  app.use(createSecretKeyMiddleware(configService));

  const config = new DocumentBuilder()
    .setTitle('weehawk api')
    .setDescription('')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('users')
    .build();

  const env = (configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? '').toLowerCase();
  if (env !== 'production') {
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('swagger', app, document);
  }

  await app.listen(process.env.PORT ?? 8080);
}
bootstrap();

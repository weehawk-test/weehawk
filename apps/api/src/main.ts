import './load-docker-secrets';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import { createSecretKeyMiddleware } from './common/middleware/secret-key.middleware';
import { resolveCorsOrigin } from './common/cors-origin';
import { assertProductionSecurityConfig } from './common/production-security';
import { HttpErrorSanitizerFilter } from './common/http-error-sanitizer.filter';
import { registerRawTerminalWebSockets } from './raw-terminal-ws.bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useWebSocketAdapter(new IoAdapter(app));
  const configService = app.get(ConfigService);
  assertProductionSecurityConfig(configService);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

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
  app.useGlobalFilters(new HttpErrorSanitizerFilter());

  const config = new DocumentBuilder()
    .setTitle('weehawk api')
    .setDescription('')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('users')
    .build();

  const env = (
    configService.get<string>('NODE_ENV') ??
    process.env.NODE_ENV ??
    ''
  ).toLowerCase();
  if (env !== 'production') {
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('swagger', app, document);
  }

  registerRawTerminalWebSockets(app);
  await app.listen(process.env.PORT ?? 8080);
}
bootstrap();

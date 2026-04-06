import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WsAdapter } from '@nestjs/platform-ws';
import {
  isCloudEditionFromProcessEnv,
  LOCAL_HOST_DOCKER_FORBIDDEN_MESSAGE,
} from './common/weehawk-edition';

/** First-line HTTP rejection (before Nest guards); matches routes that must not hit host Docker in cloud. */
function isCloudBlockedHostDockerPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/docker-monitor') ||
    pathname.startsWith('/api/docker-secrets') ||
    pathname.startsWith('/ws/docker-monitor') ||
    pathname.startsWith('/ws/service-terminal')
  );
}

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

  if (isCloudEditionFromProcessEnv()) {
    app.use((req, res, next) => {
      let pathname = (req as { path?: string }).path;
      if (!pathname && req.url) {
        try {
          pathname = new URL(req.url, 'http://localhost').pathname;
        } catch {
          pathname = req.url.split('?')[0] ?? '';
        }
      }
      if (pathname && isCloudBlockedHostDockerPath(pathname)) {
        res.status(403).json({
          statusCode: 403,
          message: LOCAL_HOST_DOCKER_FORBIDDEN_MESSAGE,
        });
        return;
      }
      next();
    });
  }

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
      'Accept',
      'Origin',
      'X-Requested-With',
    ],
    exposedHeaders: ['Content-Disposition'],
  });

  const config = new DocumentBuilder()
    .setTitle('weehawk api')
    .setDescription('')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('users')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('swagger', app, document);

  await app.listen(process.env.PORT ?? 8080);
}
bootstrap();

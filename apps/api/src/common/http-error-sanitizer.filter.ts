import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

function sanitizeMessageText(raw: string): string {
  const text = String(raw ?? '');
  return text
    .replace(/#[0-9]+\b/g, '')
    .replace(
      /\b(remote server|server|service|project|host|registry account)\s+[0-9]+\b/gi,
      '$1',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizePayload(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeMessageText(value);
  if (Array.isArray(value)) return value.map((v) => sanitizePayload(v));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = sanitizePayload(v);
  }
  return out;
}

@Catch()
export class HttpErrorSanitizerFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorSanitizerFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest<{ url?: string }>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const original = exception.getResponse();
      const sanitized =
        typeof original === 'string'
          ? { statusCode: status, message: sanitizeMessageText(original) }
          : (sanitizePayload(original) as Record<string, unknown>);
      if (sanitized.statusCode == null) sanitized.statusCode = status;
      if (sanitized.path == null) sanitized.path = request?.url ?? '';
      if (sanitized.timestamp == null)
        sanitized.timestamp = new Date().toISOString();
      response.status(status).json(sanitized);
      return;
    }

    const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
    const err =
      exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(
      `Unhandled exception on ${request?.url ?? ''}: ${err.message}`,
      err.stack,
    );

    const message = isProd
      ? 'Internal server error'
      : sanitizeMessageText(err.message || String(exception));

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message,
      timestamp: new Date().toISOString(),
      path: request?.url ?? '',
    });
  }
}

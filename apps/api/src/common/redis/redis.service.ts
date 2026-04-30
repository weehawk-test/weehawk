import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType | null = null;
  private ready = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = (this.config.get<string>('REDIS_URL') ?? '').trim();
    const host = (this.config.get<string>('REDIS_HOST') ?? '').trim();
    const portRaw = (this.config.get<string>('REDIS_PORT') ?? '').trim();
    const password = (this.config.get<string>('REDIS_PASSWORD') ?? '').trim();

    const endpoint =
      url || (host ? `redis://${host}:${portRaw || '6379'}` : '');
    if (!endpoint) {
      this.logger.warn('Redis is not configured; using in-memory fallback.');
      return;
    }

    this.client = createClient({
      url: endpoint,
      ...(password ? { password } : {}),
    });

    this.client.on('error', (err) => {
      this.ready = false;
      this.logger.error(
        `Redis error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    this.client.on('ready', () => {
      this.ready = true;
      this.logger.log('Redis connected.');
    });

    try {
      await this.client.connect();
      this.ready = this.client.isReady;
    } catch (err) {
      this.ready = false;
      this.logger.error(
        `Redis connect failed, using in-memory fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      // ignore shutdown errors
    } finally {
      this.ready = false;
      this.client = null;
    }
  }

  isReady(): boolean {
    return !!this.client && this.ready;
  }

  async setWithTtlMs(key: string, value: string, ttlMs: number): Promise<void> {
    if (!this.client || !this.ready) throw new Error('Redis unavailable');
    await this.client.set(key, value, { PX: ttlMs });
  }

  async get(key: string): Promise<string | null> {
    if (!this.client || !this.ready) throw new Error('Redis unavailable');
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    if (!this.client || !this.ready) throw new Error('Redis unavailable');
    await this.client.del(key);
  }

  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    if (!this.client || !this.ready) throw new Error('Redis unavailable');
    return this.client.eval(script, { keys, arguments: args });
  }
}

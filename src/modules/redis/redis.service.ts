import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

type RedisClient = RedisClientType<
  Record<string, never>,
  Record<string, never>
>;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: RedisClient;
  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.configService.get<string>('REDIS_URL');

    if (!redisUrl) {
      throw new Error('REDIS_URL is not defined');
    }

    this.client = createClient({
      url: redisUrl,
    });

    this.client.on('error', (err) => {
      console.error('Redis error:', err);
    });

    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const data = String(JSON.stringify(value));

    // Вот эта строка решает 90% таких ошибок:
    if (typeof data !== 'string') {
      throw new Error('Invalid serialized value');
    }

    if (ttlSeconds) {
      await this.client.set(key, data, { EX: ttlSeconds });
    } else {
      await this.client.set(key, data);
    }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const data = await this.client.get(key);

    if (typeof data !== 'string') {
      return null;
    }

    return JSON.parse(data) as T;
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);

    return result === 1;
  }
}

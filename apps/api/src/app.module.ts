import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ServicesModule } from './services/services.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ProjectsModule } from './projects/projects.module';
import { DockersecretsModule } from './dockersecrets/dockersecrets.module';
import { UserModule } from './user/user.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { RegistryModule } from './registry/registry.module';
import { S3Module } from './s3/s3.module';
import { CronJobsModule } from './cron-jobs/cron-jobs.module';
import { GitModule } from './git/git.module';
import { TraefikModule } from './traefik/traefik.module';
import { RemoteServersModule } from './remote-servers/remote-servers.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { RedisModule } from './common/redis/redis.module';
import { RedisService } from './common/redis/redis.service';
import { RedisThrottlerStorage } from './common/redis/redis-throttler.storage';
import { DevThrottlerGuard } from './common/dev-throttler.guard';
import { existsSync } from 'fs';

const ENV_FILE_PATHS = ['apps/api/.env', '.env'].filter((filePath) =>
  existsSync(filePath),
);

@Module({
  imports: [
    ServicesModule,
    RedisModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ENV_FILE_PATHS,
    }),
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redisService: RedisService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60 * 1000,
            limit: 120,
          },
        ],
        storage: new RedisThrottlerStorage(redisService),
      }),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbType = (configService.get<string>('DB_TYPE') ?? 'postgres')
          .trim()
          .toLowerCase();
        const synchronize =
          (
            configService.get<string>('DB_SYNCHRONIZE') ?? 'true'
          ).toLowerCase() === 'true';
        const dropSchema =
          (configService.get<string>('DB_DROP_SCHEMA') ?? 'false')
            .toLowerCase()
            .trim() === 'true';
        return {
          type: dbType as any,
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: Number(configService.get<string>('DB_PORT') ?? 5432),
          username: configService.get<string>('DB_USERNAME', 'postgres'),
          password: configService.get<string>('DB_PASSWORD', 'postgres'),
          database: configService.get<string>('DB_DATABASE', 'weehawk'),
          autoLoadEntities: true,
          synchronize,
          dropSchema,
        };
      },
    }),
    ProjectsModule,
    DockersecretsModule,
    UserModule,
    NotificationsModule,
    WebhooksModule,
    CronJobsModule,
    RegistryModule,
    S3Module,
    GitModule,
    TraefikModule,
    RemoteServersModule,
    OrganizationsModule,
    AuthModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: DevThrottlerGuard,
    },
  ],
})
export class AppModule {}

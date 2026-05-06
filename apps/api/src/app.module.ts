import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditHttpContextInterceptor } from './common/audit-http-context.interceptor';
import { OrganizationHttpFailureAuditInterceptor } from './organizations/organization-http-failure-audit.interceptor';
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
import { DataSource, type DataSourceOptions } from 'typeorm';
import { runOrgScopeSchemaBackfill } from './database/org-scope-backfill';
import { migrateOrganizationAuditLogTargetEmailToMetadata } from './database/organization-audit-log-target-email-migration';
import { migrateGitIntegrationSettingsToOrganizationScope } from './database/git-integration-org-migration';
import { migrateRegistryAccountsToOrganizationScope } from './database/registry-account-org-migration';
import { migrateRegistryAccountPublicIds } from './database/registry-account-public-id-migration';
import { migrateCronJobsOrganizationOwnership } from './database/cron-job-org-migration';
import { migrateNotificationChannelsOrganizationOwnership } from './database/notification-channel-org-migration';
import { migrateProjectsOrganizationOwnership } from './database/project-org-migration';
import { migrateRemoteServersOrganizationOwnership } from './database/remote-server-org-migration';
import { migrateS3ProfilesOrganizationOwnership } from './database/s3-profile-org-migration';
import { migrateWebhooksOrganizationOwnership } from './database/webhook-org-migration';

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
      dataSourceFactory: async (options: DataSourceOptions) => {
        const pre = new DataSource({ ...options, synchronize: false });
        await pre.initialize();
        await runOrgScopeSchemaBackfill(pre);
        await migrateOrganizationAuditLogTargetEmailToMetadata(pre);
        await migrateGitIntegrationSettingsToOrganizationScope(pre);
        await migrateRegistryAccountsToOrganizationScope(pre);
        await migrateRegistryAccountPublicIds(pre);
        await migrateCronJobsOrganizationOwnership(pre);
        await migrateNotificationChannelsOrganizationOwnership(pre);
        await migrateProjectsOrganizationOwnership(pre);
        await migrateRemoteServersOrganizationOwnership(pre);
        await migrateS3ProfilesOrganizationOwnership(pre);
        await migrateWebhooksOrganizationOwnership(pre);
        await pre.destroy();
        const ds = new DataSource(options);
        await ds.initialize();
        return ds;
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
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditHttpContextInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: OrganizationHttpFailureAuditInterceptor,
    },
  ],
})
export class AppModule {}

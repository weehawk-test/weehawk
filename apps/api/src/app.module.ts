import { Module } from '@nestjs/common';
import { ServicesModule } from './services/services.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ProjectsModule } from './projects/projects.module';
import { DockersecretsModule } from './dockersecrets/dockersecrets.module';
import { DockerModule } from './docker/docker.module';
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

@Module({
  imports: [
    ServicesModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbType = (configService.get<string>('DB_TYPE') ?? 'postgres').trim().toLowerCase();
        const synchronize = (configService.get<string>('DB_SYNCHRONIZE') ?? 'true').toLowerCase() === 'true';
        const dropSchema = (configService.get<string>('DB_DROP_SCHEMA') ?? 'false').toLowerCase() === 'true';
        return {
          type: dbType as any,
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: Number(configService.get<string>('DB_PORT') ?? 5432),
          username: configService.get<string>('DB_USERNAME', 'postgres'),
          password: configService.get<string>('DB_PASSWORD', 'postgres'),
          database: configService.get<string>('DB_DATABASE', 'weehawk'),
          autoLoadEntities: true,
          synchronize,
        };
      },
    }),
    ProjectsModule,
    DockersecretsModule,
    DockerModule,
    UserModule,
    NotificationsModule,
    WebhooksModule,
    CronJobsModule,
    RegistryModule,
    S3Module,
    GitModule,
    TraefikModule,
    RemoteServersModule,
    AuthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

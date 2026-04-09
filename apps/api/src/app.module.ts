import { Module } from '@nestjs/common';
import { ServicesModule } from './services/services.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
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

function expandEnvPath(input: string): string {
  // Supports Windows-style %VAR%, shell-style ${VAR}, and $VAR placeholders.
  return input
    .replace(/%([^%]+)%/g, (_m, key: string) => process.env[key] ?? `%${key}%`)
    .replace(/\$\{([^}]+)\}/g, (_m, key: string) => process.env[key] ?? `\${${key}}`)
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, key: string) => process.env[key] ?? `$${key}`);
}

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
        const dbType = (configService.get<string>('DB_TYPE') ?? 'better-sqlite3')
          .trim()
          .toLowerCase();
        if (dbType === 'sqlite' || dbType === 'better-sqlite3') {
          const configuredPathRaw =
            configService.get<string>('DB_PATH') ?? '%LOCALAPPDATA%\Weehawk\data\weehawk.sqlite';
          const configuredPath = expandEnvPath(configuredPathRaw);
          const sqlitePath = path.isAbsolute(configuredPath)
            ? configuredPath
            : path.resolve(process.cwd(), configuredPath);
          fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
          return {
            type: dbType as 'sqlite' | 'better-sqlite3',
            database: sqlitePath,
            autoLoadEntities: true,
            synchronize: true,
            //dropSchema: true,
          };
        }
        return {
          type: dbType as any,
          host: configService.get<string>('DB_HOST'),
          port: configService.get<number>('DB_PORT'),
          username: configService.get<string>('DB_USERNAME'),
          password: configService.get<string>('DB_PASSWORD'),
          database: configService.get<string>('DB_DATABASE'),
          autoLoadEntities: true,
          synchronize: true,
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
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

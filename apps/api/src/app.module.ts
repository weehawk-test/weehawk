import { Module } from '@nestjs/common';
import { ServicesModule } from './services/services.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ProjectsModule } from './projects/projects.module';
import { DockersecretsModule } from './dockersecrets/dockersecrets.module';
import { DockerModule } from './docker/docker.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { RegistryModule } from './registry/registry.module';
import { S3Module } from './s3/s3.module';
import { CronJobsModule } from './cron-jobs/cron-jobs.module';

@Module({
  imports: [
    ServicesModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: configService.get<any>('DB_TYPE'),
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_DATABASE'),
        autoLoadEntities: true,
        synchronize: true,
      }),
    }),
    ProjectsModule,
    DockersecretsModule,
    DockerModule,
    AuthModule,
    UserModule,
    NotificationsModule,
    WebhooksModule,
    CronJobsModule,
    RegistryModule,
    S3Module,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

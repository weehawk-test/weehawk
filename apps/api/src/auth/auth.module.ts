import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { Oauth2Controller } from './oauth2.controller';
import { User } from './entities/user.entity';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { TokenModule } from '../token/token.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'change-me-in-production'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXP', '7d') as
            | `${number}d`
            | `${number}h`
            | `${number}m`
            | `${number}s`,
        },
      }),
    }),
    TokenModule,
  ],
  controllers: [AuthController, Oauth2Controller],
  providers: [AuthService, JwtStrategy, GoogleStrategy, GoogleAuthGuard],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}

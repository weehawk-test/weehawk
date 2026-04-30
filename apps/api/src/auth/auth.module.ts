import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { Oauth2Controller } from './oauth2.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TokenModule } from '../token/token.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    EmailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const exp = config.get<string>('auth.jwtExpiresIn', '7d');
        const seconds = exp === '7d' ? 7 * 24 * 60 * 60 : parseInt(exp, 10) || 604800;
        const jwtSecret = config.get<string>('auth.jwtSecret')?.trim();
        if (!jwtSecret) {
          throw new Error('Missing auth.jwtSecret');
        }
        return {
          secret: jwtSecret,
          signOptions: { expiresIn: seconds },
        };
      },
    }),
    TokenModule,
  ],
  controllers: [AuthController, Oauth2Controller],
  providers: [AuthService, JwtStrategy, GoogleStrategy, JwtAuthGuard],
  exports: [JwtModule, AuthService],
})
export class AuthModule {}

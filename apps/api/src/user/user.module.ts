import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { TokenModule } from '../token/token.module';
import { EmailModule } from '../email/email.module';
import { UserService } from './user.service';
import { UserController } from './user.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User]), TokenModule, AuthModule, EmailModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}

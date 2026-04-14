import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { UserPublicController } from './user-public.controller';
import { AdminUserController } from './admin-user.controller';
import { AdminUserService } from './admin-user.service';
import { TokenModule } from '../token/token.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), TokenModule, EmailModule],
  controllers: [UserController, UserPublicController, AdminUserController],
  providers: [UserService, AdminUserService],
  exports: [UserService],
})
export class UserModule {}

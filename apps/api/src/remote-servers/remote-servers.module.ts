import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RemoteServer } from './entities/remote-server.entity';
import { RemoteServersController } from './remote-servers.controller';
import { RemoteServersService } from './remote-servers.service';

@Module({
  imports: [TypeOrmModule.forFeature([RemoteServer]), AuthModule],
  controllers: [RemoteServersController],
  providers: [RemoteServersService],
  exports: [RemoteServersService],
})
export class RemoteServersModule {}

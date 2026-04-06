import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isCloudEdition, LOCAL_HOST_DOCKER_FORBIDDEN_MESSAGE } from '../weehawk-edition';

/**
 * Blocks HTTP access to endpoints that talk to the API host’s Docker engine / socket.
 * Weehawk Cloud runs workloads on user machines over SSH; the server must not expose local Docker.
 */
@Injectable()
export class CloudEditionLocalDockerGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    if (isCloudEdition(this.configService)) {
      throw new ForbiddenException(LOCAL_HOST_DOCKER_FORBIDDEN_MESSAGE);
    }
    return true;
  }
}

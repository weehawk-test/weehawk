import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class LocalSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      user?: { userId: number; email: string };
    }>();
    req.user = { userId: 1, email: 'desktop@local.weehawk' };
    return true;
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { ChangeEmailService } from '../email/change-email.service';
import { Public } from '../auth/decorators/public.decorator';

/** Public endpoints that do not require JWT (e.g. called from email links). */
@Controller('/api/user')
export class UserPublicController {
  constructor(private readonly changeEmailService: ChangeEmailService) {}

  @Get('/confirm-email-change')
  @Public()
  async confirmEmailChange(@Query('token') token: string): Promise<{ message: string }> {
    await this.changeEmailService.confirmEmailChange(token);
    return { message: 'Email changed successfully' };
  }
}

import { All, Controller, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';

/**
 * Public ingress (no JWT). URL: `GET|POST {origin}/hooks/{secretToken}` (no `/api` prefix).
 */
@ApiTags('Triggers (public)')
@Controller('hooks')
export class WebhooksTriggerController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @All(':token')
  @ApiOperation({ summary: 'Trigger webhook by secret token' })
  trigger(@Param('token') token: string) {
    return this.webhooksService.triggerByToken(token);
  }
}

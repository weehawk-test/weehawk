import { All, Controller, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicWebhookHostGuard } from './public-webhook-host.guard';
import { WebhooksService } from './webhooks.service';

/**
 * Public ingress (no JWT). URL: `GET|POST {origin}/weehawk-hooks/{secretToken}` (no `/api` prefix).
 */
@ApiTags('Triggers (public)')
@Controller('weehawk-hooks')
@UseGuards(PublicWebhookHostGuard)
export class WebhooksTriggerController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @All(':token')
  @ApiOperation({ summary: 'Trigger webhook by secret token' })
  trigger(@Param('token') token: string): Promise<{ ok: boolean; message: string }> {
    return this.webhooksService.triggerByToken(token);
  }
}

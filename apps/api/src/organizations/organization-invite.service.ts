import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../auth/entities/user.entity';
import { AuthProvider } from '../auth/entities/auth-provider.enum';
import { Role } from '../auth/entities/role.enum';
import { EmailService } from '../email/email.service';
import { TokenStoreService } from '../email/token-store.service';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';
import { NotificationService } from '../notifications/notification.service';
import type {
  OrganizationMemberContext,
  OrganizationMemberPublicDto,
} from './organizations.service';

export type AcceptOrganizationInviteResultDto = OrganizationMemberPublicDto & {
  organizationPublicId: string;
  organizationName: string;
};

const PREFIX = 'org-invite:';
const SEP = '||';
const TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

/** Stored value: `${organizationInternalId}||${inviteeEmailLower}` */
@Injectable()
export class OrganizationInviteService {
  private readonly logger = new Logger(OrganizationInviteService.name);

  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly orgRepo: OrganizationsRepository,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly emailService: EmailService,
    private readonly tokenStore: TokenStoreService,
    private readonly config: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Resolves NotificationService at runtime from the global container.
   * OrganizationsModule deliberately does not import NotificationsModule (to
   * avoid a deep circular dependency through Remote/Traefik/OrgRealtime),
   * so we look the provider up via ModuleRef with strict:false.
   * Returns null if NotificationsModule is not registered.
   */
  private resolveNotificationService(): NotificationService | null {
    try {
      return this.moduleRef.get(NotificationService, { strict: false });
    } catch (e) {
      this.logger.warn(
        `Notification service not available: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return null;
    }
  }

  private getFrontendBaseUrl(): string {
    return (
      this.config.get<string>('WEBFRONTEND_BASE_URL') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  private isSelfHosted(): boolean {
    const raw = this.config.get<string>('INSTANCE_MODE') ?? 'cloud';
    return raw.trim().toLowerCase() === 'self-hosted';
  }

  async sendMemberInvite(
    ctx: OrganizationMemberContext,
    actingUserId: number,
    rawEmail: string,
    notificationChannelId?: string,
    notificationRemoteServerId?: number,
  ): Promise<{ message: string; notice?: string }> {
    if (!ctx.actingIsOwner) {
      throw new ForbiddenException(
        'Only organization owners can invite members.',
      );
    }
    const email = String(rawEmail ?? '')
      .trim()
      .toLowerCase();
    if (!email) {
      throw new BadRequestException('email is required');
    }

    if (this.isSelfHosted()) {
      const ch = String(notificationChannelId ?? '').trim();
      if (!ch) {
        throw new BadRequestException(
          'notificationChannelId is required in self-hosted mode.',
        );
      }
      if (
        !Number.isInteger(notificationRemoteServerId) ||
        (notificationRemoteServerId ?? 0) < 1
      ) {
        throw new BadRequestException(
          'notificationRemoteServerId is required in self-hosted mode.',
        );
      }
      return this.selfHostedDirectAdd(
        ctx,
        actingUserId,
        email,
        ch,
        notificationRemoteServerId,
      );
    }

    return this.cloudSendInvite(ctx, actingUserId, email);
  }

  /**
   * Self-hosted mode: create the user account if it doesn't exist,
   * then add them directly to the organization (no email invite flow).
   */
  private async selfHostedDirectAdd(
    ctx: OrganizationMemberContext,
    actingUserId: number,
    email: string,
    notificationChannelId?: string,
    notificationRemoteServerId?: number,
  ): Promise<{ message: string; notice?: string }> {
    let invitee = await this.users
      .createQueryBuilder('u')
      .where('LOWER(u.email) = :email', { email })
      .getOne();

    let userCreated = false;

    if (!invitee) {
      const tempPassword = crypto.randomUUID();
      const hash = await bcrypt.hash(tempPassword, 10);
      const localPart = email.split('@')[0] ?? '';
      const now = new Date();
      invitee = this.users.create({
        firstName: localPart || 'User',
        lastName: '',
        email,
        passwordHash: hash,
        provider: AuthProvider.LOCAL,
        role: Role.USER,
        enabled: true,
        emailVerified: false,
        locked: false,
        createdAt: now,
        updatedAt: now,
      });
      invitee = await this.users.save(invitee);
      userCreated = true;
      await this.sendSelfHostedInviteNotification(
        ctx,
        notificationChannelId,
        notificationRemoteServerId,
        email,
        tempPassword,
        true,
      );
    } else if (notificationChannelId?.trim()) {
      await this.sendSelfHostedInviteNotification(
        ctx,
        notificationChannelId,
        notificationRemoteServerId,
        email,
        null,
        false,
      );
    }

    const already = await this.orgRepo.findMembership(invitee.id, ctx.internalId);
    if (already) {
      throw new ConflictException('This user is already a member.');
    }

    await this.organizationsService.addMemberByUserId(
      ctx.internalId,
      invitee.id,
    );

    await this.organizationsService.appendOrganizationAuditEvent(
      ctx.internalId,
      actingUserId,
      'member.invited',
      {
        metadata: {
          endpoint: `POST /api/organizations/${encodeURIComponent(ctx.publicId)}/members`,
          targetEmail: email,
          selfHostedDirectAdd: true,
          userCreated,
        },
      },
    );

    if (userCreated) {
      return {
        message: `Account created for ${email} and added to the organization. They need to reset their password on first login.`,
      };
    }
    return {
      message: `${email} has been added to the organization.`,
    };
  }

  private selfHostedInviteNotificationMessage(input: {
    organizationName: string;
    inviteeEmail: string;
    frontendBaseUrl: string;
    temporaryPassword: string | null;
    userCreated: boolean;
  }): string {
    const lines = [
      `Welcome to ${input.organizationName}!`,
      '',
      `Organization: ${input.organizationName}`,
      `Site: ${input.frontendBaseUrl}`,
      `Email: ${input.inviteeEmail}`,
    ];
    if (input.userCreated && input.temporaryPassword) {
      lines.push(`Temporary password: ${input.temporaryPassword}`);
      lines.push('Sign in with this temporary password and change it immediately.');
    } else {
      lines.push('Your existing account was added to the organization.');
    }
    return lines.join('\n');
  }

  private async sendSelfHostedInviteNotification(
    ctx: OrganizationMemberContext,
    notificationChannelId: string | undefined,
    notificationRemoteServerId: number | undefined,
    inviteeEmail: string,
    temporaryPassword: string | null,
    userCreated: boolean,
  ): Promise<void> {
    const channelId = notificationChannelId?.trim();
    if (!channelId) return;
    const notificationService = this.resolveNotificationService();
    if (!notificationService) return;
    const msg = this.selfHostedInviteNotificationMessage({
      organizationName: ctx.name,
      inviteeEmail,
      frontendBaseUrl: this.getFrontendBaseUrl(),
      temporaryPassword,
      userCreated,
    });
    await notificationService.sendMessageForOrganization(
      ctx.internalId,
      channelId,
      msg,
      notificationRemoteServerId,
    );
  }

  /** Cloud mode: existing email-based invite flow. */
  private async cloudSendInvite(
    ctx: OrganizationMemberContext,
    actingUserId: number,
    email: string,
  ): Promise<{ message: string; notice?: string }> {
    const invitee = await this.users
      .createQueryBuilder('u')
      .where('LOWER(u.email) = :email', { email })
      .getOne();
    if (!invitee) {
      return {
        message: 'Your request was processed.',
        notice:
          'Invitation emails are only delivered to addresses that already have a Weehawk account. If they are registered, they will receive the invitation shortly.',
      };
    }
    const already = await this.orgRepo.findMembership(invitee.id, ctx.internalId);
    if (already) {
      throw new ConflictException('This user is already a member.');
    }

    const inviter = await this.users.findOne({ where: { id: actingUserId } });
    if (!inviter) {
      throw new NotFoundException('Inviter not found');
    }

    const token = crypto.randomUUID();
    await this.tokenStore.set(
      PREFIX + token,
      `${ctx.internalId}${SEP}${email}`,
      TTL_MS,
    );
    const link = `${this.getFrontendBaseUrl()}/accept-org-invite?token=${encodeURIComponent(token)}`;
    const inviterName = [inviter.firstName?.trim(), inviter.lastName?.trim()]
      .filter(Boolean)
      .join(' ')
      .trim();
    await this.emailService.sendOrganizationInvite(
      invitee.email,
      invitee.firstName ?? 'there',
      ctx.name,
      inviterName || inviter.email,
      link,
    );
    await this.organizationsService.appendOrganizationAuditEvent(
      ctx.internalId,
      actingUserId,
      'member.invited',
      {
        metadata: {
          endpoint: `POST /api/organizations/${encodeURIComponent(ctx.publicId)}/members`,
          targetEmail: email,
        },
      },
    );
    return { message: 'Invitation email sent.' };
  }

  async acceptInvite(
    token: string,
    userId: number,
  ): Promise<AcceptOrganizationInviteResultDto> {
    const raw = (token ?? '').trim();
    if (!raw) throw new NotFoundException('Invalid or expired invitation');
    const value = await this.tokenStore.get(PREFIX + raw);
    if (!value) {
      throw new NotFoundException('Invalid or expired invitation');
    }
    const sepIdx = value.indexOf(SEP);
    if (sepIdx < 0) {
      await this.tokenStore.delete(PREFIX + raw);
      throw new NotFoundException('Invalid or expired invitation');
    }
    const orgIdStr = value.slice(0, sepIdx);
    const inviteeEmail = value.slice(sepIdx + SEP.length);
    const organizationInternalId = parseInt(orgIdStr, 10);
    if (!Number.isFinite(organizationInternalId)) {
      await this.tokenStore.delete(PREFIX + raw);
      throw new NotFoundException('Invalid or expired invitation');
    }

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.email.trim().toLowerCase() !== inviteeEmail) {
      throw new ForbiddenException(
        'Sign in with the email address that received this invitation.',
      );
    }

    try {
      const out = await this.organizationsService.addMemberByUserId(
        organizationInternalId,
        userId,
      );
      const orgRow = await this.orgRepo.findById(organizationInternalId);
      if (!orgRow) {
        throw new NotFoundException('Organization not found');
      }
      await this.tokenStore.delete(PREFIX + raw);
      return {
        ...out,
        organizationPublicId: orgRow.publicId,
        organizationName: orgRow.name,
      };
    } catch (e) {
      if (e instanceof ConflictException) {
        await this.tokenStore.delete(PREFIX + raw);
      }
      throw e;
    }
  }
}

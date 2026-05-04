import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { EmailService } from '../email/email.service';
import { TokenStoreService } from '../email/token-store.service';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';
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
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly orgRepo: OrganizationsRepository,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly emailService: EmailService,
    private readonly tokenStore: TokenStoreService,
    private readonly config: ConfigService,
  ) {}

  private getFrontendBaseUrl(): string {
    return (
      this.config.get<string>('WEBFRONTEND_BASE_URL') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  async sendMemberInvite(
    ctx: OrganizationMemberContext,
    actingUserId: number,
    rawEmail: string,
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
    const invitee = await this.users
      .createQueryBuilder('u')
      .where('LOWER(u.email) = :email', { email })
      .getOne();
    if (!invitee) {
      /** Do not reveal whether the address exists; no email or token is created. */
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
      { targetEmail: email },
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

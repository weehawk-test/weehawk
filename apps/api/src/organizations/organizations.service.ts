import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationMembership } from './entities/organization-membership.entity';
import { OrganizationsRepository } from './organizations.repository';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { parseOrganizationPublicIdParam } from './org-public-id';
import { User } from '../auth/entities/user.entity';
import { Project } from '../projects/entities/project.entity';
import { generatePublicId } from '../common/public-id';

export type OrganizationPublicDto = {
  publicId: string;
  name: string;
  isOwner: boolean;
  createdAt: Date;
};

export type OrganizationMemberContext = {
  internalId: number;
  publicId: string;
  name: string;
  ownerId: number;
  createdAt: Date;
};

export type OrganizationMemberPublicDto = {
  email: string;
  firstName: string;
  lastName: string;
  isOwner: boolean;
  joinedAt: string;
};

export type OrganizationProjectPublicDto = {
  publicId: string;
  name: string;
  description: string;
  createdAt: string;
  serviceCount: number;
};

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly repo: OrganizationsRepository,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
  ) {}

  private sanitizeCreateName(dto: CreateOrganizationDto): string {
    const name = dto.name.trim().replace(/\s+/g, ' ');
    if (!name) throw new BadRequestException('Organization name is required');
    return name;
  }

  toPublicDto(org: Organization, actingUserId: number): OrganizationPublicDto {
    return {
      publicId: org.publicId,
      name: org.name,
      isOwner: org.ownerId === actingUserId,
      createdAt: org.createdAt,
    };
  }

  memberContextToPublicDto(
    ctx: OrganizationMemberContext,
    actingUserId: number,
  ): OrganizationPublicDto {
    return {
      publicId: ctx.publicId,
      name: ctx.name,
      isOwner: ctx.ownerId === actingUserId,
      createdAt: ctx.createdAt,
    };
  }

  async create(
    userId: number,
    dto: CreateOrganizationDto,
  ): Promise<OrganizationPublicDto> {
    const name = this.sanitizeCreateName(dto);
    const publicId = generatePublicId('org');
    const org = new Organization();
    org.name = name;
    org.publicId = publicId;
    org.ownerId = userId;
    const saved = await this.repo.saveOrganization(org);
    const membership = new OrganizationMembership();
    membership.userId = userId;
    membership.organizationId = saved.id;
    await this.repo.saveMembership(membership);
    return this.toPublicDto(saved, userId);
  }

  async listMine(userId: number): Promise<OrganizationPublicDto[]> {
    const rows = await this.repo.listOrganizationsForUser(userId);
    return rows.map((o) => this.toPublicDto(o, userId));
  }

  /**
   * Validates publicId, resolves org, verifies membership. Same 404 for unknown org and non-member.
   */
  async requireMemberContext(
    rawPublicId: unknown,
    userId: number,
  ): Promise<OrganizationMemberContext> {
    const publicId = parseOrganizationPublicIdParam(rawPublicId);
    const org = await this.repo.findByPublicId(publicId);
    if (!org) throw new NotFoundException('Organization not found');
    const member = await this.repo.findMembership(userId, org.id);
    if (!member) throw new NotFoundException('Organization not found');
    return {
      internalId: org.id,
      publicId: org.publicId,
      name: org.name,
      ownerId: org.ownerId,
      createdAt: org.createdAt,
    };
  }

  async listMembers(
    ctx: OrganizationMemberContext,
  ): Promise<OrganizationMemberPublicDto[]> {
    const links = await this.repo.listMembershipsForOrganization(ctx.internalId);
    if (links.length === 0) return [];
    const userIds = [...new Set(links.map((l) => l.userId))];
    const userRows = await this.users.find({ where: { id: In(userIds) } });
    const byId = new Map(userRows.map((u) => [u.id, u]));
    return links.map((link) => {
      const u = byId.get(link.userId);
      if (!u) {
        throw new NotFoundException('Organization member data is incomplete');
      }
      return {
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        isOwner: ctx.ownerId === link.userId,
        joinedAt: link.createdAt.toISOString(),
      };
    });
  }

  async addMemberByEmail(
    ctx: OrganizationMemberContext,
    actingUserId: number,
    rawEmail: string,
  ): Promise<OrganizationMemberPublicDto> {
    if (ctx.ownerId !== actingUserId) {
      throw new ForbiddenException(
        'Only the organization owner can invite members.',
      );
    }
    const email = String(rawEmail ?? '')
      .trim()
      .toLowerCase();
    if (!email) throw new BadRequestException('email is required');
    const user = await this.users
      .createQueryBuilder('u')
      .where('LOWER(u.email) = :email', { email })
      .getOne();
    if (!user) {
      throw new NotFoundException(
        'No user with this email was found. They must sign up first.',
      );
    }
    const existing = await this.repo.findMembership(user.id, ctx.internalId);
    if (existing) {
      throw new ConflictException('This user is already a member.');
    }
    const membership = new OrganizationMembership();
    membership.userId = user.id;
    membership.organizationId = ctx.internalId;
    const saved = await this.repo.saveMembership(membership);
    return {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isOwner: ctx.ownerId === user.id,
      joinedAt: saved.createdAt.toISOString(),
    };
  }

  async listProjectsForOrg(
    ctx: OrganizationMemberContext,
  ): Promise<OrganizationProjectPublicDto[]> {
    const rows = await this.projects.find({
      where: { organizationId: ctx.internalId },
      relations: ['services'],
      order: { createdAt: 'DESC' },
    });
    const out: OrganizationProjectPublicDto[] = [];
    for (const p of rows) {
      let row = p;
      if (!row.publicId) {
        row.publicId = generatePublicId('prj');
        row = await this.projects.save(row);
      }
      const services = row.services ?? [];
      out.push({
        publicId: row.publicId,
        name: row.name,
        description: row.description ?? '',
        createdAt: row.createdAt.toISOString(),
        serviceCount: services.length,
      });
    }
    return out;
  }
}

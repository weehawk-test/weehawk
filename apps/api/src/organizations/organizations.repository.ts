import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationMembership } from './entities/organization-membership.entity';
import {
  ORGANIZATION_MEMBER_ROLE,
  type OrganizationMemberRole,
} from './organization-member-role';

@Injectable()
export class OrganizationsRepository {
  constructor(
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(OrganizationMembership)
    private readonly memberships: Repository<OrganizationMembership>,
  ) {}

  async findByPublicId(publicId: string): Promise<Organization | null> {
    return this.organizations.findOne({ where: { publicId } });
  }

  async findById(id: number): Promise<Organization | null> {
    return this.organizations.findOne({ where: { id } });
  }

  async saveOrganization(row: Organization): Promise<Organization> {
    return this.organizations.save(row);
  }

  async saveMembership(row: OrganizationMembership): Promise<OrganizationMembership> {
    return this.memberships.save(row);
  }

  async findMembership(
    userId: number,
    organizationId: number,
  ): Promise<OrganizationMembership | null> {
    return this.memberships.findOne({ where: { userId, organizationId } });
  }

  async deleteMembership(
    userId: number,
    organizationId: number,
  ): Promise<number> {
    const r = await this.memberships.delete({ userId, organizationId });
    return r.affected ?? 0;
  }

  async listMembershipsForOrganization(
    organizationId: number,
  ): Promise<OrganizationMembership[]> {
    return this.memberships.find({
      where: { organizationId },
      order: { createdAt: 'ASC' },
    });
  }

  async countMembershipsForOrganization(organizationId: number): Promise<number> {
    return this.memberships.count({ where: { organizationId } });
  }

  async countOwnersForOrganization(organizationId: number): Promise<number> {
    return this.memberships.count({
      where: { organizationId, role: ORGANIZATION_MEMBER_ROLE.OWNER },
    });
  }

  async updateMembershipRole(
    userId: number,
    organizationId: number,
    role: OrganizationMemberRole,
  ): Promise<number> {
    const r = await this.memberships.update(
      { userId, organizationId },
      { role },
    );
    return r.affected ?? 0;
  }

  async updateMembershipPermissions(
    userId: number,
    organizationId: number,
    permissions: Record<string, boolean> | null,
  ): Promise<number> {
    const r = await this.memberships.update(
      { userId, organizationId },
      { permissions },
    );
    return r.affected ?? 0;
  }

  async listOwnerUserIds(organizationId: number): Promise<number[]> {
    const rows = await this.memberships.find({
      where: { organizationId, role: ORGANIZATION_MEMBER_ROLE.OWNER },
      select: ['userId'],
    });
    return rows.map((row) => row.userId);
  }

  async listOrganizationsForUser(userId: number): Promise<Organization[]> {
    const links = await this.memberships.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    if (links.length === 0) return [];
    const ids = links.map((l) => l.organizationId);
    const orgs = await this.organizations.find({
      where: { id: In(ids) },
    });
    const order = new Map(ids.map((id, i) => [id, i]));
    return orgs.sort(
      (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );
  }
}

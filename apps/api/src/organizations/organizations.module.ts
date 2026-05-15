import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationAuditLog } from '../ee/audit/organization-audit-log.entity';
import { OrganizationMembership } from './entities/organization-membership.entity';
import { User } from '../auth/entities/user.entity';
import { Project } from '../projects/entities/project.entity';
import { EmailModule } from '../email/email.module';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { OrgMembershipGuard } from './guards/org-membership.guard';
import { OrganizationInviteService } from './organization-invite.service';
import { ActiveOrganizationService } from './active-organization.service';
import { OrganizationAuditService } from '../ee/audit/organization-audit.service';
import { OrganizationAuditController } from '../ee/audit/organization-audit.controller';
import { OrganizationPermissionsService } from '../ee/permissions/organization-permissions.service';
import { OrganizationPermissionsController } from '../ee/permissions/organization-permissions.controller';
import {
  EnterpriseLicenseService,
  InstanceEnterpriseLicense,
  InstanceEnterpriseLicenseController,
} from '../ee/license-token';

@Module({
  imports: [
    EmailModule,
    TypeOrmModule.forFeature([
      Organization,
      OrganizationAuditLog,
      OrganizationMembership,
      User,
      Project,
      InstanceEnterpriseLicense,
    ]),
  ],
  controllers: [
    OrganizationsController,
    OrganizationAuditController,
    OrganizationPermissionsController,
    InstanceEnterpriseLicenseController,
  ],
  providers: [
    OrganizationsRepository,
    EnterpriseLicenseService,
    OrganizationsService,
    OrganizationAuditService,
    OrganizationPermissionsService,
    ActiveOrganizationService,
    OrganizationInviteService,
    OrgMembershipGuard,
  ],
  exports: [
    OrganizationsService,
    OrganizationAuditService,
    ActiveOrganizationService,
    OrgMembershipGuard,
    OrganizationsRepository,
  ],
})
export class OrganizationsModule {}

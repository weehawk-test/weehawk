import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationAuditLog } from './entities/organization-audit-log.entity';
import { OrganizationMembership } from './entities/organization-membership.entity';
import { User } from '../auth/entities/user.entity';
import { Project } from '../projects/entities/project.entity';
import { EmailModule } from '../email/email.module';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { OrgMembershipGuard } from './guards/org-membership.guard';
import { OrganizationInviteService } from './organization-invite.service';

@Module({
  imports: [
    EmailModule,
    TypeOrmModule.forFeature([
      Organization,
      OrganizationAuditLog,
      OrganizationMembership,
      User,
      Project,
    ]),
  ],
  controllers: [OrganizationsController],
  providers: [
    OrganizationsRepository,
    OrganizationsService,
    OrganizationInviteService,
    OrgMembershipGuard,
  ],
  exports: [
    OrganizationsService,
    OrgMembershipGuard,
    OrganizationsRepository,
  ],
})
export class OrganizationsModule {}

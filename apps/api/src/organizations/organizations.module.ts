import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationMembership } from './entities/organization-membership.entity';
import { User } from '../auth/entities/user.entity';
import { Project } from '../projects/entities/project.entity';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { OrgMembershipGuard } from './guards/org-membership.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization,
      OrganizationMembership,
      User,
      Project,
    ]),
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsRepository, OrganizationsService, OrgMembershipGuard],
  exports: [
    OrganizationsService,
    OrgMembershipGuard,
    OrganizationsRepository,
  ],
})
export class OrganizationsModule {}

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { LocalSessionGuard } from '../../common/guards/local-session.guard';
import { User } from '../../auth/entities/user.entity';
import { Role } from '../../auth/entities/role.enum';
import { EnterpriseLicenseService } from './enterprise-license.service';
import { UpdateInstanceEnterpriseLicenseDto } from './update-instance-enterprise-license.dto';

@ApiTags('Enterprise')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/enterprise')
export class InstanceEnterpriseLicenseController {
  constructor(
    private readonly enterpriseLicense: EnterpriseLicenseService,
    private readonly config: ConfigService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  private isSelfHostedInstance(): boolean {
    const raw = (this.config.get<string>('INSTANCE_MODE') ?? 'cloud')
      .trim()
      .toLowerCase();
    return raw === 'self-hosted';
  }

  @Get('instance-license')
  @ApiOperation({
    summary:
      'Enterprise license status (any signed-in user). Key management fields only for instance ADMIN users.',
  })
  async getInstanceLicenseState(
    @Req() req: { user?: { userId: number } },
  ): Promise<{
    licensed: boolean;
    salesUrl: string;
    selfHosted: boolean;
    canManageInstanceLicense: boolean;
    /** When true, only Ed25519-signed `whl1...` tokens are accepted as license keys. */
    signedLicenseEnforced: boolean;
    hasStoredLicenseKey?: boolean;
  }> {
    const userId = this.uid(req);
    const user = await this.users.findOne({ where: { id: userId } });
    const selfHosted = this.isSelfHostedInstance();
    const isAdmin = user?.role === Role.ADMIN;
    const canManage = !!isAdmin;
    return {
      licensed: this.enterpriseLicense.isLicensed(),
      salesUrl: this.enterpriseLicense.getSalesUrl(),
      selfHosted,
      canManageInstanceLicense: canManage,
      signedLicenseEnforced: this.enterpriseLicense.signedLicenseEnforced(),
      ...(canManage
        ? { hasStoredLicenseKey: this.enterpriseLicense.hasDatabaseLicenseKey() }
        : {}),
    };
  }

  @Put('instance-license')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary:
      'Set or clear the instance enterprise license key (instance ADMIN only; stored encrypted)',
  })
  async updateInstanceLicense(
    @Req() req: { user?: { userId: number } },
    @Body() dto: UpdateInstanceEnterpriseLicenseDto,
  ): Promise<{ licensed: boolean; message: string }> {
    const userId = this.uid(req);
    const user = await this.users.findOne({ where: { id: userId } });
    if (user?.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Only instance administrators (ADMIN) can update the enterprise license key.',
      );
    }
    await this.enterpriseLicense.setInstanceLicenseKey(dto.licenseKey ?? '');
    return {
      licensed: this.enterpriseLicense.isLicensed(),
      message: this.enterpriseLicense.hasDatabaseLicenseKey()
        ? 'Enterprise license key saved.'
        : 'Enterprise license key cleared.',
    };
  }
}

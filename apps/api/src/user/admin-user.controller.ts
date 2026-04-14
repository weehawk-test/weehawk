import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { AdminUserService } from './admin-user.service';
import { UserProfileResponseDto } from '../auth/dto/user-profile-response.dto';
import { UserCreateRequestDto } from './dto/user-create-request.dto';
import { UserUpdateRequestDto } from './dto/user-update-request.dto';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { Role } from '../auth/entities/role.enum';

@ApiTags('Admin - Users')
@Controller('/api/admin/users')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminUserController {
  constructor(private readonly adminUserService: AdminUserService) {}

  @Get()
  listAll(
    @Query('page', { transform: (v) => (v != null ? parseInt(String(v), 10) : 0) }) page: number = 0,
    @Query('size', { transform: (v) => (v != null ? parseInt(String(v), 10) : 8) }) size: number = 8,
    @Query('email') email?: string,
  ): Promise<{
    content: UserProfileResponseDto[];
    totalElements: number;
    totalPages: number;
    number: number;
    size: number;
  }> {
    return this.adminUserService.findAll(page, size, email).then((r) => ({
      content: r.items,
      totalElements: r.total,
      totalPages: Math.ceil(r.total / (r.size || 1)),
      number: r.page,
      size: r.size,
    }));
  }

  @Get('/:id')
  getById(@Param('id', ParseIntPipe) id: number): Promise<UserProfileResponseDto> {
    return this.adminUserService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBody({ type: UserCreateRequestDto })
  async create(@Body() dto: UserCreateRequestDto): Promise<UserProfileResponseDto> {
    return this.adminUserService.create(dto);
  }

  @Put('/:id')
  @ApiBody({ type: UserUpdateRequestDto })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UserUpdateRequestDto,
  ): Promise<UserProfileResponseDto> {
    return this.adminUserService.update(id, dto);
  }

  @Delete('/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.adminUserService.deleteById(id);
  }
}

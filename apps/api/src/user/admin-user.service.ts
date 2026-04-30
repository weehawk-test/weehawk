import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../auth/entities/user.entity';
import { AuthProvider } from '../auth/entities/auth-provider.enum';
import { Role } from '../auth/entities/role.enum';
import { UserProfileResponseDto } from '../auth/dto/user-profile-response.dto';
import { UserCreateRequestDto } from './dto/user-create-request.dto';
import { UserUpdateRequestDto } from './dto/user-update-request.dto';
import { UserService } from './user.service';

const MAX_PAGE_SIZE = 8;

@Injectable()
export class AdminUserService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly userService: UserService,
  ) {}

  async findAll(
    page: number,
    size: number,
    email?: string,
  ): Promise<{
    items: UserProfileResponseDto[];
    total: number;
    page: number;
    size: number;
  }> {
    const take = Math.min(MAX_PAGE_SIZE, Math.max(1, size));
    const skip = Math.max(0, page) * take;

    let qb = this.userRepo.createQueryBuilder('u').orderBy('u.id', 'ASC');
    if (email?.trim()) {
      qb = qb.andWhere('LOWER(u.email) LIKE LOWER(:email)', {
        email: `%${email.trim()}%`,
      });
    }
    const [items, total] = await qb.skip(skip).take(take).getManyAndCount();
    return {
      items: items.map((u) => this.userService.toProfileResponse(u)),
      total,
      page,
      size: take,
    };
  }

  async findById(id: number): Promise<UserProfileResponseDto> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found with id: ' + id);
    return this.userService.toProfileResponse(user);
  }

  async create(dto: UserCreateRequestDto): Promise<UserProfileResponseDto> {
    const email = dto.email.toLowerCase();
    const exists = await this.userRepo.exists({ where: { email } });
    if (exists)
      throw new ConflictException('Email already in use: ' + dto.email);

    const hash = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email,
      passwordHash: hash,
      role: dto.role ?? Role.USER,
      provider: AuthProvider.LOCAL,
      enabled: dto.enabled ?? true,
      emailVerified: false,
      locked: false,
    });
    const saved = await this.userRepo.save(user);
    return this.userService.toProfileResponse(saved);
  }

  async update(
    id: number,
    dto: UserUpdateRequestDto,
  ): Promise<UserProfileResponseDto> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found with id: ' + id);

    if (dto.firstName != null && dto.firstName.trim() !== '')
      user.firstName = dto.firstName;
    if (dto.lastName != null && dto.lastName.trim() !== '')
      user.lastName = dto.lastName;
    if (dto.role != null) user.role = dto.role;
    if (dto.enabled != null) user.enabled = dto.enabled;
    if (dto.locked != null) user.locked = dto.locked;

    const saved = await this.userRepo.save(user);
    return this.userService.toProfileResponse(saved);
  }

  async deleteById(id: number): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found with id: ' + id);
    await this.userService.deleteUserAndRelatedRows(user.id);
  }
}

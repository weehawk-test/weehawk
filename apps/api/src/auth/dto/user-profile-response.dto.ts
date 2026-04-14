import { AuthProvider } from '../entities/auth-provider.enum';
import { Role } from '../entities/role.enum';

export class UserProfileResponseDto {
  userId!: number;
  firstName!: string;
  lastName!: string;
  email!: string;
  role!: Role;
  provider!: AuthProvider;
  imageUrl!: string | null;
  emailVerified!: boolean;
  enabled!: boolean;
  locked!: boolean;
  createdAt!: Date;
  lastLogin!: Date | null;
}

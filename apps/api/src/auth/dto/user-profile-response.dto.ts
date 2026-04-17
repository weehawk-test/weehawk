import { AuthProvider } from '../entities/auth-provider.enum';
import { Role } from '../entities/role.enum';

export class UserProfileResponseDto {
  userId!: number;
  firstName!: string;
  lastName!: string;
  email!: string;
  role!: Role;
  provider!: AuthProvider;
  providerId!: string | null;
  /** Google OAuth email; may differ from {@link UserProfileResponseDto.email}. */
  googleAccountEmail!: string | null;
  imageUrl!: string | null;
  /** True when the account has a local password (false for pure OAuth accounts). */
  hasPassword!: boolean;
  emailVerified!: boolean;
  enabled!: boolean;
  locked!: boolean;
  createdAt!: Date;
  lastLogin!: Date | null;
}

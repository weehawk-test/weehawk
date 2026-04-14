import { AuthProvider } from '../entities/auth-provider.enum';
import { Role } from '../entities/role.enum';

export class AuthResponseDto {
  accessToken!: string;
  refreshToken!: string;
  tokenType = 'Bearer';
  userId!: number;
  firstName!: string;
  lastName!: string;
  email!: string;
  role!: Role;
  provider!: AuthProvider;
  imageUrl!: string | null;
  emailVerified!: boolean;
}

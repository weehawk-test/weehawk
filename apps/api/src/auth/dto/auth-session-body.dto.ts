import { AuthProvider } from '../entities/auth-provider.enum';
import { Role } from '../entities/role.enum';

/** Returned in JSON on login/register/refresh — tokens are HttpOnly cookies only. */
export class AuthSessionBodyDto {
  userId!: number;
  firstName!: string;
  lastName!: string;
  email!: string;
  role!: Role;
  provider!: AuthProvider;
  imageUrl!: string | null;
  emailVerified!: boolean;
}

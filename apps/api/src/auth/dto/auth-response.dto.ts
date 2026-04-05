export class AuthResponseDto {
  accessToken!: string;
  refreshToken!: string;
  tokenType = 'Bearer';
  userId!: number;
  firstName!: string;
  lastName!: string;
  email!: string;
  emailVerified!: boolean;
  imageUrl!: string | null;
  /** Included for OAuth callback redirects; defaults to USER when unset. */
  role?: string;
  /** LOCAL or GOOGLE */
  provider?: string;
}

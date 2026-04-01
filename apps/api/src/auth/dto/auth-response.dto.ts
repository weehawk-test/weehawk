export class AuthResponseDto {
  accessToken!: string;
  refreshToken!: string;
  tokenType = 'Bearer';
  userId!: number;
  firstName!: string;
  lastName!: string;
  email!: string;
  imageUrl!: string | null;
}

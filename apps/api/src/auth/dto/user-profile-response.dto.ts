export class UserProfileResponseDto {
  userId!: number;
  firstName!: string;
  lastName!: string;
  email!: string;
  imageUrl!: string | null;
  emailVerified!: boolean;
  /** LOCAL or GOOGLE — email confirmation / password flows apply to LOCAL. */
  authProvider!: string;
  createdAt!: Date;
  lastLogin!: Date | null;
}

export class UserProfileResponseDto {
  firstName!: string;
  lastName!: string;
  email!: string;
  imageUrl!: string | null;
  emailVerified!: boolean;
  createdAt!: Date;
  lastLogin!: Date | null;
}

export class UserProfileResponseDto {
  userId!: number;
  firstName!: string;
  lastName!: string;
  email!: string;
  imageUrl!: string | null;
  createdAt!: Date;
  lastLogin!: Date | null;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from './role.enum';
import { AuthProvider } from './auth-provider.enum';
import { RefreshToken } from '../../token/refresh-token.entity';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'first_name', length: 50 })
  firstName!: string;

  @Column({ name: 'last_name', length: 50 })
  lastName!: string;

  @Column({ length: 254, unique: true })
  email!: string;

  @Column({ type: 'varchar', name: 'password_hash', length: 60, nullable: true })
  passwordHash: string | null = null;

  @Column({ type: 'enum', enum: Role, default: Role.USER })
  role: Role = Role.USER;

  @Column({ type: 'enum', enum: AuthProvider, default: AuthProvider.LOCAL })
  provider: AuthProvider = AuthProvider.LOCAL;

  @Column({ type: 'varchar', name: 'provider_id', length: 100, nullable: true, unique: true })
  providerId: string | null = null;

  /**
   * Email returned by Google on OAuth (may differ from {@link User.email} after an in-app email change).
   */
  @Column({ type: 'varchar', name: 'google_account_email', length: 254, nullable: true })
  googleAccountEmail: string | null = null;

  @Column({ default: true })
  enabled!: boolean;

  @Column({ default: false })
  locked!: boolean;

  @Column({ name: 'email_verified', default: false })
  emailVerified!: boolean;

  @Column({ type: 'varchar', name: 'image_url', length: 512, nullable: true })
  imageUrl: string | null = null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'last_login', type: 'timestamp', nullable: true })
  lastLogin: Date | null = null;

  @OneToMany(() => RefreshToken, (rt) => rt.user)
  refreshTokens?: RefreshToken[];
}

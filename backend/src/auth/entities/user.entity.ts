import { RefreshToken } from 'src/token/refresh-token.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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

  @Column({
    type: 'varchar',
    name: 'password_hash',
    length: 60,
    nullable: true,
  })
  passwordHash: string | null = null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'last_login', type: 'timestamp', nullable: true })
  lastLogin: Date | null = null;

  @OneToMany(() => RefreshToken, (rt) => rt.user)
  refreshTokens?: RefreshToken[];
}

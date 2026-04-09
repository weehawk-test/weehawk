import {
  Column,
  CreateDateColumn,
  Entity,
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

  @Column({
    type: 'varchar',
    name: 'google_id',
    length: 64,
    nullable: true,
    unique: true,
  })
  googleId: string | null = null;

  @Column({ name: 'image_url', type: 'varchar', length: 512, nullable: true })
  imageUrl: string | null = null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'last_login', type: 'datetime', nullable: true })
  lastLogin: Date | null = null;

  @Column({ name: 'email_verified', type: 'boolean', default: false })
  emailVerified!: boolean;
}

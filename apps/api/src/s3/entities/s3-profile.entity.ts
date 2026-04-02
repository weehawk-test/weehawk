import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Saved S3-compatible destination profiles; connection tests use @aws-sdk/client-s3.
 * `secretAccessKey` is stored in plaintext for now; encryption at rest can be added later
 * (e.g. app-level crypto or envelope encryption) without changing the API contract.
 */
@Entity('s3_profiles')
export class S3Profile {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 191, unique: true })
  name!: string;

  @Column({ type: 'varchar', length: 512 })
  endpoint!: string;

  @Column({ type: 'varchar', length: 128 })
  region!: string;

  @Column({ type: 'varchar', length: 255 })
  bucket!: string;

  @Column({ type: 'varchar', length: 255 })
  accessKeyId!: string;

  @Column({ type: 'text' })
  secretAccessKey!: string;

  @Column({ type: 'boolean', default: false })
  forcePathStyle!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

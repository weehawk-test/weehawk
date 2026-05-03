import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { generatePublicId } from '../../common/public-id';

@Entity({ name: 'organizations' })
export class Organization {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 40, unique: true, nullable: true })
  publicId!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'owner_id', type: 'int' })
  ownerId!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @BeforeInsert()
  ensurePublicId() {
    if (!this.publicId) this.publicId = generatePublicId('org');
  }
}

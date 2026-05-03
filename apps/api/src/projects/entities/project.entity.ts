import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Service } from 'src/services/entities/service.entity';
import { generatePublicId } from '../../common/public-id';

@Entity('projects')
@Index(['userId', 'organizationId', 'name'])
export class Project {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 40, unique: true, nullable: true })
  publicId!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  /** Optional org scope: internal FK only; APIs expose organization `publicId` when present. */
  @Column({ name: 'organization_id', type: 'int', nullable: true })
  organizationId!: number | null;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @OneToMany(() => Service, (service) => service.project, { cascade: true })
  services!: Service[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  ensurePublicId() {
    if (!this.publicId) this.publicId = generatePublicId('prj');
  }
}

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

  /** Organization scope (internal FK); APIs expose `organizationPublicId`. */
  @Column({ name: 'organization_id', type: 'int' })
  organizationId!: number;

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

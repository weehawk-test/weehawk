import { Column, Entity, PrimaryGeneratedColumn, ManyToOne, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { composeType } from "./composeType.enum";
import { Project } from "src/projects/entities/project.entity";

@Entity('services')
export class Service {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ type: 'varchar', length: 50 })
    name!: string;

    @Column({ type: 'varchar', length: 100 })
    appName!: string;

    @Column({ type: 'enum', enum: composeType, default: composeType.COMPOSE })
    composeType!: composeType;

    @Column({ type: 'text', nullable: true })
    description?: string;

    @Column({ type: 'text', nullable: true })
    dockerConfig!: string;

    @Column({ type: 'text', nullable: true })
    env?: string;

    @Column({ type: 'simple-json', nullable: true })
    domains?: string[];

    @Column({ type: 'boolean', default: true })
    isActive!: boolean;

    /** Set when `POST .../execute` completes successfully (Docker deploy ran). */
    @Column({ type: 'timestamptz', nullable: true })
    lastDeployedAt?: Date | null;

    @ManyToOne(() => Project, (project) => project.services, { onDelete: 'CASCADE' })
    project!: Project;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}
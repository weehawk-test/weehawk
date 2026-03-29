import { 
  Injectable, 
  NotFoundException, 
  forwardRef, 
  Inject 
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Service } from './entities/service.entity';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { Project } from 'src/projects/entities/project.entity';
import { randomBytes } from 'crypto';
import { ExecutorService } from './ExecutorService';
import { spawn } from 'child_process';
import { Observable } from 'rxjs';
import { composeType } from './entities/composeType.enum';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @Inject(forwardRef(() => ExecutorService))
    private readonly executorService: ExecutorService,
  ) {}

  async create(createServiceDto: CreateServiceDto) {
    const { projectId, appName, ...serviceData } = createServiceDto;
    const project = await this.projectRepository.findOneBy({ id: projectId });
    if (!project) throw new NotFoundException('Project not found');

    const uniqueAppName = `${appName}-${randomBytes(2).toString('hex')}`;
    const service = this.serviceRepository.create({
      ...serviceData,
      appName: uniqueAppName,
      project: project,
    });

    return await this.serviceRepository.save(service);
  }


  getServiceLogsStream(id: number): Observable<any> {
    return new Observable((observer) => {
      this.findOne(id).then((service) => {
        let args: string[] = [];

        if (service.composeType === composeType.STACK) {
          args = ['service', 'logs', '-f', '--tail', '50', service.appName];
        } else {
          // Docker Compose Mode (Standalone)
          args = ['compose', '-p', service.appName, 'logs', '-f', '--tail', '50'];
        }

        const child = spawn('docker', args);

        child.stdout.on('data', (data) => {
          observer.next({ data: data.toString() });
        });

        child.stderr.on('data', (data) => {
          const errorMsg = data.toString();
          if (!errorMsg.includes('Attaching to')) {
            observer.next({ data: errorMsg });
          }
        });

        child.on('error', (err) => observer.error(err));
        child.on('close', () => observer.complete());

        return () => child.kill();
      }).catch(err => observer.error(err));
    });
  }

  async executeDeployment(id: number, mode: 'deploy' | 'reload' = 'deploy') {
    const result = await this.executorService.execute(id, mode);
    await this.serviceRepository.update(id, { lastDeployedAt: new Date() });
    return result;
  }

  async startService(id: number) {
    await this.findOne(id);
    return await this.executorService.startContainers(id);
  }

  async getRuntimeStatus(id: number) {
    await this.findOne(id);
    return await this.executorService.getRuntimeStatus(id);
  }

  async findAll() {
    return await this.serviceRepository.find({ 
      relations: ['project'], 
      order: { createdAt: 'DESC' } 
    });
  }

  async findByProjectId(projectId: number) {
    return await this.serviceRepository.find({
      where: { project: { id: projectId } },
      relations: ['project'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number) {
    const service = await this.serviceRepository.findOne({ 
      where: { id }, 
      relations: ['project'] 
    });
    if (!service) throw new NotFoundException(`Service #${id} not found`);
    return service;
  }

  async remove(id: number) {
    await this.executorService.stopAndRemove(id);
    const service = await this.findOne(id);
    await this.serviceRepository.remove(service);
    return { success: true };
  }

  async update(id: number, updateServiceDto: UpdateServiceDto) {
    const service = await this.findOne(id);
    const updated = this.serviceRepository.merge(service, updateServiceDto);
    return await this.serviceRepository.save(updated);
  }


  async shutdownService(id: number) {
    await this.findOne(id);
    return await this.executorService.shutdown(id);
  }
}
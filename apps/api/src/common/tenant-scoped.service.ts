import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ObjectLiteral, FindOneOptions, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

function requireScopedUserId(userId: number): number {
  if (!Number.isFinite(userId) || userId < 1) {
    throw new BadRequestException(
      'A valid userId is required for scoped operations.',
    );
  }
  return Math.trunc(userId);
}

export abstract class TenantScopedRepository<TEntity extends ObjectLiteral> {
  abstract findScoped(
    id: number,
    userId: number,
    options?: FindOneOptions<TEntity>,
  ): Promise<TEntity>;

  abstract updateScoped(
    id: number,
    userId: number,
    patch: QueryDeepPartialEntity<TEntity>,
  ): Promise<void>;

  abstract deleteScoped(id: number, userId: number): Promise<void>;

  abstract findScopedBy<K extends keyof TEntity>(
    field: K,
    value: TEntity[K],
    userId: number,
    options?: FindOneOptions<TEntity>,
  ): Promise<TEntity>;

  abstract saveScoped(entity: TEntity, userId: number): Promise<TEntity>;
}

export class UserIdTenantScopedRepository<
  TEntity extends ObjectLiteral & { id: number | string; userId: number },
> extends TenantScopedRepository<TEntity> {
  constructor(
    private readonly repo: Repository<TEntity>,
    private readonly entityLabel: string,
  ) {
    super();
  }

  async findScoped(
    id: number,
    userId: number,
    options?: FindOneOptions<TEntity>,
  ): Promise<TEntity> {
    const uid = requireScopedUserId(userId);
    const row = await this.repo.findOne({
      ...(options ?? {}),
      where: {
        ...(options?.where as ObjectLiteral | undefined),
        id,
        userId: uid,
      } as any,
    });
    if (!row)
      throw new NotFoundException(`${this.entityLabel} #${id} not found`);
    return row;
  }

  async updateScoped(
    id: number,
    userId: number,
    patch: QueryDeepPartialEntity<TEntity>,
  ): Promise<void> {
    const uid = requireScopedUserId(userId);
    const res = await this.repo.update({ id, userId: uid } as any, patch);
    if ((res.affected ?? 0) < 1) {
      throw new NotFoundException(`${this.entityLabel} #${id} not found`);
    }
  }

  async deleteScoped(id: number, userId: number): Promise<void> {
    const uid = requireScopedUserId(userId);
    const res = await this.repo.delete({ id, userId: uid } as any);
    if ((res.affected ?? 0) < 1) {
      throw new NotFoundException(`${this.entityLabel} #${id} not found`);
    }
  }

  async findScopedBy<K extends keyof TEntity>(
    field: K,
    value: TEntity[K],
    userId: number,
    options?: FindOneOptions<TEntity>,
  ): Promise<TEntity> {
    const uid = requireScopedUserId(userId);
    const row = await this.repo.findOne({
      ...(options ?? {}),
      where: {
        ...(options?.where as ObjectLiteral | undefined),
        [field]: value,
        userId: uid,
      } as any,
    });
    if (!row) {
      throw new NotFoundException(`${this.entityLabel} not found`);
    }
    return row;
  }

  async saveScoped(entity: TEntity, userId: number): Promise<TEntity> {
    const uid = requireScopedUserId(userId);
    const e = entity as unknown as { userId?: number };
    if (e.userId !== undefined && e.userId !== uid) {
      throw new BadRequestException(
        'Scoped save rejected: entity userId does not match acting user.',
      );
    }
    e.userId = uid;
    return this.repo.save(entity);
  }
}

export class ProjectTenantScopedRepository<
  TEntity extends ObjectLiteral,
> extends TenantScopedRepository<TEntity> {
  constructor(
    private readonly repo: Repository<TEntity>,
    private readonly entityLabel: string,
    private readonly projectIdColumn = 'projectId',
  ) {
    super();
  }

  async findScoped(
    id: number,
    userId: number,
    options?: FindOneOptions<TEntity>,
  ): Promise<TEntity> {
    const uid = requireScopedUserId(userId);
    const owned = await this.repo
      .createQueryBuilder('e')
      .select('e.id', 'id')
      .where('e.id = :id', { id })
      .andWhere(
        `e."${this.projectIdColumn}" IN (SELECT p."id" FROM "projects" p WHERE p."user_id" = :userId)`,
        { userId: uid },
      )
      .getRawOne<{ id?: number }>();
    if (!owned?.id) {
      throw new NotFoundException(`${this.entityLabel} #${id} not found`);
    }
    const row = await this.repo.findOne({
      ...(options ?? {}),
      where: {
        ...(options?.where as ObjectLiteral | undefined),
        id: owned.id,
      } as any,
    });
    if (!row)
      throw new NotFoundException(`${this.entityLabel} #${id} not found`);
    return row;
  }

  async updateScoped(
    id: number,
    userId: number,
    patch: QueryDeepPartialEntity<TEntity>,
  ): Promise<void> {
    const uid = requireScopedUserId(userId);
    const res = await this.repo
      .createQueryBuilder()
      .update()
      .set(patch)
      .where('"id" = :id', { id })
      .andWhere(
        `"${this.projectIdColumn}" IN (SELECT p."id" FROM "projects" p WHERE p."user_id" = :userId)`,
        { userId: uid },
      )
      .execute();
    if ((res.affected ?? 0) < 1) {
      throw new NotFoundException(`${this.entityLabel} #${id} not found`);
    }
  }

  async deleteScoped(id: number, userId: number): Promise<void> {
    const uid = requireScopedUserId(userId);
    const res = await this.repo
      .createQueryBuilder()
      .delete()
      .where('"id" = :id', { id })
      .andWhere(
        `"${this.projectIdColumn}" IN (SELECT p."id" FROM "projects" p WHERE p."user_id" = :userId)`,
        { userId: uid },
      )
      .execute();
    if ((res.affected ?? 0) < 1) {
      throw new NotFoundException(`${this.entityLabel} #${id} not found`);
    }
  }

  async findScopedBy<K extends keyof TEntity>(
    _field: K,
    _value: TEntity[K],
    _userId: number,
    _options?: FindOneOptions<TEntity>,
  ): Promise<TEntity> {
    throw new BadRequestException(
      'findScopedBy is not supported for project-scoped repositories; use findScoped(id, userId).',
    );
  }

  async saveScoped(_entity: TEntity, _userId: number): Promise<TEntity> {
    throw new BadRequestException(
      'saveScoped is not supported for project-scoped repositories; set project ownership explicitly and use internal repository save.',
    );
  }
}

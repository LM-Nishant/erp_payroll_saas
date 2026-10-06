import { TenantIsolationError } from './errors';

export type QueryArgs = Record<string, unknown>;

export interface ScopeOptions {
  organizationId: string;
  /** Hide rows where deletedAt is set unless the caller filters on deletedAt explicitly. */
  softDelete: boolean;
  /** Relation field names of the model; nested relation writes are rejected. */
  relationFields: ReadonlySet<string>;
}

const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const WHERE_WRITE_OPERATIONS = new Set([
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

const TENANT_KEY = 'organizationId';

function isPlainObject(value: unknown): value is QueryArgs {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scopeWhere(where: unknown, options: ScopeOptions, key = TENANT_KEY): QueryArgs {
  const base: QueryArgs = isPlainObject(where) ? { ...where } : {};
  if (key in base && base[key] !== options.organizationId) {
    throw new TenantIsolationError(`Query filter on ${key} does not match the current tenant`);
  }
  base[key] = options.organizationId;
  if (options.softDelete && !('deletedAt' in base)) {
    base.deletedAt = null;
  }
  return base;
}

function assertNoRelationWrites(model: string, data: QueryArgs, options: ScopeOptions): void {
  for (const field of Object.keys(data)) {
    if (options.relationFields.has(field)) {
      throw new TenantIsolationError(
        `Nested relation write "${model}.${field}" is not allowed on tenant-scoped models; use scalar foreign keys validated through the tenant client`,
      );
    }
  }
}

function scopeCreateData(model: string, data: unknown, options: ScopeOptions): QueryArgs {
  if (!isPlainObject(data)) {
    throw new TenantIsolationError(`Invalid create data for ${model}`);
  }
  assertNoRelationWrites(model, data, options);
  if (TENANT_KEY in data && data[TENANT_KEY] !== options.organizationId) {
    throw new TenantIsolationError(`Cannot create ${model} in another tenant`);
  }
  return { ...data, [TENANT_KEY]: options.organizationId };
}

function checkUpdateData(model: string, data: unknown, options: ScopeOptions): QueryArgs {
  if (!isPlainObject(data)) {
    throw new TenantIsolationError(`Invalid update data for ${model}`);
  }
  assertNoRelationWrites(model, data, options);
  if (TENANT_KEY in data && data[TENANT_KEY] !== options.organizationId) {
    throw new TenantIsolationError(`Cannot move ${model} to another tenant`);
  }
  return data;
}

/**
 * Pure function that rewrites Prisma query arguments for a tenant-scoped model so that:
 *  - every read/update/delete is filtered by the current organization_id (and soft-delete),
 *  - every create is stamped with the current organization_id,
 *  - explicit attempts to target another tenant throw TenantIsolationError,
 *  - nested relation writes (which could bypass scoping) are rejected.
 */
export function scopeTenantArgs(
  model: string,
  operation: string,
  args: QueryArgs | undefined,
  options: ScopeOptions,
): QueryArgs {
  const input: QueryArgs = isPlainObject(args) ? args : {};

  if (READ_OPERATIONS.has(operation)) {
    return { ...input, where: scopeWhere(input.where, options) };
  }

  if (WHERE_WRITE_OPERATIONS.has(operation)) {
    const scoped: QueryArgs = { ...input, where: scopeWhere(input.where, options) };
    if ('data' in input) scoped.data = checkUpdateData(model, input.data, options);
    return scoped;
  }

  if (CREATE_OPERATIONS.has(operation)) {
    const data = Array.isArray(input.data)
      ? input.data.map((row) => scopeCreateData(model, row, options))
      : scopeCreateData(model, input.data, options);
    return { ...input, data };
  }

  if (operation === 'upsert') {
    return {
      ...input,
      where: scopeWhere(input.where, options),
      create: scopeCreateData(model, input.create, options),
      update: checkUpdateData(model, input.update, options),
    };
  }

  throw new TenantIsolationError(
    `Operation "${operation}" is not supported on tenant-scoped model ${model}`,
  );
}

/**
 * Scoping for the tenant root model (Organization): read-only, restricted to the current org.
 */
export function scopeTenantRootArgs(
  model: string,
  operation: string,
  args: QueryArgs | undefined,
  options: ScopeOptions,
): QueryArgs {
  if (!READ_OPERATIONS.has(operation)) {
    throw new TenantIsolationError(`${model} is read-only through the tenant-scoped client`);
  }
  const input: QueryArgs = isPlainObject(args) ? args : {};
  return { ...input, where: scopeWhere(input.where, options, 'id') };
}

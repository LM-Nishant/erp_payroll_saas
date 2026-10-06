import { Prisma } from '@prisma/client';
import { TenantIsolationError } from './errors';
import { scopeTenantArgs, scopeTenantRootArgs, type QueryArgs } from './scope-args';
import { SOFT_DELETE_MODELS, TENANT_ROOT_MODEL, TENANT_SCOPED_MODELS } from './tenant-models';

const relationFieldsByModel: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    new Set(model.fields.filter((f) => f.kind === 'object').map((f) => f.name)),
  ]),
);

/**
 * Prisma Client extension that enforces tenant isolation for one organization.
 * Raw SQL is blocked on the scoped client — use the base client inside core code with an
 * explicit organization_id predicate if raw SQL is ever required.
 */
export function tenantExtension(organizationId: string) {
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (!model) {
          throw new TenantIsolationError(
            `Raw operation "${operation}" is not allowed on the tenant-scoped client`,
          );
        }
        const options = {
          organizationId,
          softDelete: SOFT_DELETE_MODELS.has(model),
          relationFields: relationFieldsByModel.get(model) ?? new Set<string>(),
        };
        if (TENANT_SCOPED_MODELS.has(model)) {
          return query(
            scopeTenantArgs(model, operation, args as QueryArgs, options) as typeof args,
          );
        }
        if (model === TENANT_ROOT_MODEL) {
          return query(
            scopeTenantRootArgs(model, operation, args as QueryArgs, options) as typeof args,
          );
        }
        throw new TenantIsolationError(
          `Model ${model} is not registered for tenant-scoped access (see tenant-models.ts)`,
        );
      },
    },
  });
}

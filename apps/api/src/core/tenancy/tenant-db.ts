import { prisma, type BasePrismaClient } from '../db/prisma';
import { getTenantContext, type TenantContext } from './context';
import { tenantExtension } from './prisma-extension';

export function createTenantClient(base: BasePrismaClient, organizationId: string) {
  return base.$extends(tenantExtension(organizationId));
}

export type TenantClient = ReturnType<typeof createTenantClient>;

const clients = new WeakMap<TenantContext, TenantClient>();

/**
 * Tenant-scoped Prisma client for the active TenantContext. This is the ONLY way feature
 * modules should access the database. Throws if no tenant context is active.
 */
export function tenantDb(): TenantClient {
  const context = getTenantContext();
  let client = clients.get(context);
  if (!client) {
    client = createTenantClient(prisma, context.organizationId);
    clients.set(context, client);
  }
  return client;
}

/** Stamp create data with the current organization id (required by Prisma's input types). */
export function withTenant<T extends object>(data: T): T & { organizationId: string } {
  return { ...data, organizationId: getTenantContext().organizationId };
}

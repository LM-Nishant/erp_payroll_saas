import type {
  CreateIntegrationCredentialInput,
  IntegrationCredentialDto,
  PaginationQuery,
  UpdateIntegrationCredentialInput,
} from '@erp/shared';
import type { IntegrationCredential, Prisma } from '@prisma/client';
import { audit } from '../audit';
import { accessFor, authorize, currentPrincipal } from '../authz';
import { ConflictError, NotFoundError } from '../http/errors';
import { toListResponse, toPageWindow } from '../http/pagination';
import { deleteSecretInternal, getSecretById, maskedDisplay, putSecret } from '../secrets';
import type { SecretValue } from '../secrets';
import {
  resolveSettingTarget,
  targetResource,
  whereForTargetAccess,
  type SettingTarget,
} from '../settings/target';
import { tenantDb, withTenant } from '../tenancy/tenant-db';

/*
 * Third-party integration credentials (Tally, biometric devices, payment gateways…). The
 * credential value lives in tenant_secrets (kind `integration`); rows only reference it.
 * Modules read it with `getIntegrationCredential({ provider, institutionId, purpose })`.
 */

const target = (row: IntegrationCredential): SettingTarget => ({
  scopeType: row.scopeType,
  targetId: row.targetId,
  groupId: row.groupId,
  institutionId: row.institutionId,
});

async function dto(row: IntegrationCredential): Promise<IntegrationCredentialDto> {
  const secret = await tenantDb().tenantSecret.findFirst({
    where: { id: row.secretId },
    select: { last4: true },
  });
  return {
    id: row.id,
    scopeType: row.scopeType,
    targetId: row.targetId,
    provider: row.provider,
    name: row.name,
    description: row.description,
    config: (row.config as IntegrationCredentialDto['config']) ?? {},
    isActive: row.isActive,
    masked: maskedDisplay(secret?.last4 ?? null),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function find(id: string, permission: 'integration.view' | 'integration.manage') {
  const row = await tenantDb().integrationCredential.findFirst({ where: { id } });
  if (!row) throw new NotFoundError('Integration credential');
  try {
    await authorize(currentPrincipal(), permission, targetResource(target(row)));
  } catch (err) {
    if (permission === 'integration.view') throw new NotFoundError('Integration credential');
    throw err;
  }
  return row;
}

const secretName = (row: { provider: string; name: string; scopeType: string; targetId: string }) =>
  `integration-${row.provider}-${row.name}-${row.scopeType.toLowerCase()}-${row.targetId}`.slice(
    0,
    190,
  );

export const integrationCredentialsService = {
  async list(query: PaginationQuery) {
    const access = await accessFor(currentPrincipal(), 'integration.view');
    const scope = whereForTargetAccess(access);
    const where: Prisma.IntegrationCredentialWhereInput = {
      ...(query.search ? { provider: { contains: query.search } } : {}),
      ...(scope ? { AND: [scope] } : {}),
    };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.integrationCredential.findMany({
        where,
        orderBy: [{ provider: 'asc' }, { name: 'asc' }],
        ...toPageWindow(query),
      }),
      db.integrationCredential.count({ where }),
    ]);
    return toListResponse(await Promise.all(rows.map(dto)), total, query);
  },

  async get(id: string) {
    return dto(await find(id, 'integration.view'));
  },

  async create(input: CreateIntegrationCredentialInput) {
    const t = await resolveSettingTarget(input.scopeType, input.targetId);
    await authorize(currentPrincipal(), 'integration.manage', targetResource(t));
    const db = tenantDb();
    const dup = await db.integrationCredential.findFirst({
      where: {
        scopeType: t.scopeType,
        targetId: t.targetId,
        provider: input.provider,
        name: input.name,
      },
      select: { id: true },
    });
    if (dup)
      throw new ConflictError('An integration credential with this provider and name exists');
    const stored = await putSecret({
      target: t,
      kind: 'integration',
      name: secretName({ ...input, scopeType: t.scopeType, targetId: t.targetId }),
      value: input.credentials,
      description: `${input.provider} integration credential`,
    });
    const row = await db.integrationCredential.create({
      data: withTenant({
        scopeType: t.scopeType,
        targetId: t.targetId,
        groupId: t.groupId,
        institutionId: t.institutionId,
        provider: input.provider,
        name: input.name,
        description: input.description ?? null,
        config: (input.config ?? {}) as Prisma.InputJsonValue,
        secretId: stored.id,
        createdById: currentPrincipal().userId,
      }),
    });
    const out = await dto(row);
    await audit.record({
      action: 'integration_credential.create',
      entityType: 'integration_credential',
      entityId: row.id,
      after: { ...out },
    });
    return out;
  },

  async update(id: string, input: UpdateIntegrationCredentialInput) {
    const before = await find(id, 'integration.manage');
    let secretId = before.secretId;
    if (input.credentials) {
      const stored = await putSecret({
        target: target(before),
        kind: 'integration',
        name: secretName(before),
        value: input.credentials,
        description: `${before.provider} integration credential`,
      });
      secretId = stored.id;
    }
    const row = await tenantDb().integrationCredential.update({
      where: { id },
      data: {
        secretId,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    const out = await dto(row);
    await audit.record({
      action: 'integration_credential.update',
      entityType: 'integration_credential',
      entityId: id,
      before: { ...(await dto(before)) },
      after: { ...out },
      metadata: { credentialsRotated: !!input.credentials },
    });
    return out;
  },

  async remove(id: string) {
    const before = await find(id, 'integration.manage');
    await tenantDb().integrationCredential.delete({ where: { id } });
    await deleteSecretInternal(before.secretId);
    await audit.record({
      action: 'integration_credential.delete',
      entityType: 'integration_credential',
      entityId: id,
      before: { provider: before.provider, name: before.name },
    });
  },
};

/**
 * Module-facing accessor: most specific ACTIVE credential (institution > group > organization)
 * for `provider`/`name`. Returns the config plus a SecretValue (reveal() is audited by purpose).
 */
export async function getIntegrationCredential(options: {
  provider: string;
  name?: string;
  institutionId?: string | null;
  purpose: string;
}): Promise<{ config: Record<string, unknown>; secret: SecretValue } | null> {
  const db = tenantDb();
  const rows = await db.integrationCredential.findMany({
    where: { provider: options.provider, name: options.name ?? 'default', isActive: true },
  });
  let groupId: string | null = null;
  if (options.institutionId) {
    const inst = await db.institution.findFirst({
      where: { id: options.institutionId },
      select: { groupId: true },
    });
    groupId = inst?.groupId ?? null;
  }
  const pick =
    (options.institutionId &&
      rows.find((r) => r.scopeType === 'INSTITUTION' && r.targetId === options.institutionId)) ||
    (groupId && rows.find((r) => r.scopeType === 'GROUP' && r.targetId === groupId)) ||
    rows.find((r) => r.scopeType === 'ORGANIZATION');
  if (!pick) return null;
  const secret = await getSecretById({ id: pick.secretId, purpose: options.purpose });
  if (!secret) return null;
  return { config: (pick.config as Record<string, unknown>) ?? {}, secret };
}

import { randomUUID } from 'node:crypto';
import { Prisma, type TenantSecret } from '@prisma/client';
import type {
  CreateSecretInput,
  ListSecretsQuery,
  SecretDto,
  SettingScopeType,
  UpdateSecretInput,
} from '@erp/shared';
import { audit } from '../audit';
import { isSensitiveKey } from '../audit/redact';
import { accessFor, authorize, currentPrincipal, tryGetPrincipal, type AccessSet } from '../authz';
import { prisma } from '../db/prisma';
import { NotFoundError, ValidationError } from '../http/errors';
import { toListResponse, toPageWindow } from '../http/pagination';
import { logger } from '../logger';
import { resolveSettingTarget, targetResource, type SettingTarget } from '../settings/target';
import { currentOrganizationId } from '../tenancy/context';
import { tenantDb, withTenant } from '../tenancy/tenant-db';
import { maskInfo, maskedDisplay, openSecret, rewrapSecret, sealSecret } from './envelope';
import { keyProvider } from './key-provider';
import { SecretValue } from './secret-value';

/** Columns that are safe to load for display (never the ciphertext / wrapped key). */
const DISPLAY_SELECT = {
  id: true,
  organizationId: true,
  scopeType: true,
  targetId: true,
  groupId: true,
  institutionId: true,
  kind: true,
  name: true,
  description: true,
  metadata: true,
  keyVersion: true,
  last4: true,
  fingerprint: true,
  version: true,
  createdById: true,
  rotatedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TenantSecretSelect;

type DisplayRow = Prisma.TenantSecretGetPayload<{ select: typeof DISPLAY_SELECT }>;

function assertSafeMetadata(metadata: Record<string, unknown> | null | undefined) {
  for (const key of Object.keys(metadata ?? {})) {
    if (isSensitiveKey(key)) {
      throw new ValidationError(
        `Metadata key "${key}" looks sensitive; store secret material only in "value"`,
        { field: `metadata.${key}` },
      );
    }
  }
}

const metadataJson = (m: Record<string, unknown> | null | undefined) =>
  m === undefined ? undefined : m === null ? Prisma.DbNull : (m as Prisma.InputJsonValue);

async function creatorNames(rows: DisplayRow[]) {
  const ids = [...new Set(rows.map((r) => r.createdById).filter((v): v is string => !!v))];
  if (ids.length === 0) return new Map<string, string>();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

function toDto(row: DisplayRow, names: Map<string, string>): SecretDto {
  return {
    id: row.id,
    scopeType: row.scopeType,
    targetId: row.targetId,
    kind: row.kind,
    name: row.name,
    description: row.description,
    metadata: (row.metadata as SecretDto['metadata']) ?? null,
    masked: maskedDisplay(row.last4),
    fingerprint: row.fingerprint,
    version: row.version,
    keyVersion: row.keyVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rotatedAt: row.rotatedAt?.toISOString() ?? null,
    createdBy: row.createdById
      ? { id: row.createdById, name: names.get(row.createdById) ?? 'Unknown' }
      : null,
  };
}

async function present(row: DisplayRow): Promise<SecretDto> {
  return toDto(row, await creatorNames([row]));
}

/** Audit snapshot: masked metadata only. */
const auditView = (row: DisplayRow) => ({
  scopeType: row.scopeType,
  targetId: row.targetId,
  kind: row.kind,
  name: row.name,
  description: row.description,
  metadata: row.metadata,
  masked: maskedDisplay(row.last4),
  fingerprint: row.fingerprint,
  version: row.version,
  keyVersion: row.keyVersion,
});

const rowTarget = (
  row: Pick<TenantSecret, 'scopeType' | 'targetId' | 'groupId' | 'institutionId'>,
): SettingTarget => ({
  scopeType: row.scopeType,
  targetId: row.targetId,
  groupId: row.groupId,
  institutionId: row.institutionId,
});

/** Prisma filter for the secrets visible with an access set (org rows need org-wide access). */
function whereForSecretAccess(access: AccessSet): Prisma.TenantSecretWhereInput | undefined {
  if (access.all) return undefined;
  const or: Prisma.TenantSecretWhereInput[] = [];
  if (access.groupIds.size > 0) or.push({ groupId: { in: [...access.groupIds] } });
  if (access.institutionIds.size > 0) {
    or.push({ institutionId: { in: [...access.institutionIds] } });
  }
  return or.length > 0 ? { OR: or } : { id: { in: [] } };
}

async function findVisible(id: string, permission: 'secret.view' | 'secret.manage') {
  const row = await tenantDb().tenantSecret.findFirst({ where: { id }, select: DISPLAY_SELECT });
  if (!row) throw new NotFoundError('Secret');
  try {
    await authorize(currentPrincipal(), permission, targetResource(rowTarget(row)));
  } catch (err) {
    if (permission === 'secret.view') throw new NotFoundError('Secret');
    throw err;
  }
  return row;
}

/**
 * Tenant secret management. Values are WRITE-ONLY: no method returns plaintext except the
 * internal `getSecret` used by engines (which audits every access).
 */
export const secretsService = {
  async list(query: ListSecretsQuery) {
    const principal = currentPrincipal();
    const access = await accessFor(principal, 'secret.view');
    if (!access.all && access.groupIds.size + access.institutionIds.size === 0) {
      // No grant at all → 403; grants only at campus/department level → empty list.
      await authorize(principal, 'secret.view', {});
    }
    const filters: Prisma.TenantSecretWhereInput[] = [
      {
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.scopeType ? { scopeType: query.scopeType } : {}),
        ...(query.targetId ? { targetId: query.targetId } : {}),
      },
    ];
    const scope = whereForSecretAccess(access);
    if (scope) filters.push(scope);
    const where = { AND: filters };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.tenantSecret.findMany({
        where,
        select: DISPLAY_SELECT,
        orderBy: [{ kind: 'asc' }, { name: 'asc' }, { createdAt: 'asc' }],
        ...toPageWindow(query),
      }),
      db.tenantSecret.count({ where }),
    ]);
    const names = await creatorNames(rows);
    return toListResponse(
      rows.map((r) => toDto(r, names)),
      total,
      query,
    );
  },

  get: async (id: string) => present(await findVisible(id, 'secret.view')),

  async create(input: CreateSecretInput) {
    const principal = currentPrincipal();
    const target = await resolveSettingTarget(input.scopeType, input.targetId);
    await authorize(principal, 'secret.manage', targetResource(target));
    assertSafeMetadata(input.metadata);
    const organizationId = currentOrganizationId();
    const id = randomUUID();
    const provider = keyProvider();
    const sealed = await sealSecret(provider, { organizationId, secretId: id }, input.value);
    const row = await tenantDb().tenantSecret.create({
      data: withTenant({
        id,
        scopeType: target.scopeType,
        targetId: target.targetId,
        groupId: target.groupId,
        institutionId: target.institutionId,
        kind: input.kind,
        name: input.name,
        description: input.description ?? null,
        metadata: metadataJson(input.metadata),
        ...sealed,
        ...maskInfo(input.value),
        fingerprint: provider.fingerprint(input.value, organizationId),
        createdById: principal.userId,
        updatedById: principal.userId,
      }),
      select: DISPLAY_SELECT,
    });
    await audit.record({
      action: 'secret.create',
      entityType: 'tenant_secret',
      entityId: row.id,
      after: auditView(row),
    });
    return present(row);
  },

  /** Replace the value (new data key, version + 1). */
  async rotate(id: string, value: string) {
    const before = await findVisible(id, 'secret.manage');
    const principal = currentPrincipal();
    const organizationId = currentOrganizationId();
    const provider = keyProvider();
    const sealed = await sealSecret(provider, { organizationId, secretId: id }, value);
    const after = await tenantDb().tenantSecret.update({
      where: { id },
      data: {
        ...sealed,
        ...maskInfo(value),
        fingerprint: provider.fingerprint(value, organizationId),
        version: { increment: 1 },
        rotatedAt: new Date(),
        updatedById: principal.userId,
      },
      select: DISPLAY_SELECT,
    });
    await audit.record({
      action: 'secret.rotate',
      entityType: 'tenant_secret',
      entityId: id,
      before: auditView(before),
      after: auditView(after),
    });
    return present(after);
  },

  async update(id: string, input: UpdateSecretInput) {
    const before = await findVisible(id, 'secret.manage');
    assertSafeMetadata(input.metadata);
    const after = await tenantDb().tenantSecret.update({
      where: { id },
      data: {
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.metadata !== undefined ? { metadata: metadataJson(input.metadata) } : {}),
        updatedById: currentPrincipal().userId,
      },
      select: DISPLAY_SELECT,
    });
    await audit.record({
      action: 'secret.update',
      entityType: 'tenant_secret',
      entityId: id,
      before: auditView(before),
      after: auditView(after),
    });
    return present(after);
  },

  /** Hard delete: the wrapped data key is destroyed with the row (crypto-shredding). */
  async remove(id: string) {
    const before = await findVisible(id, 'secret.manage');
    await tenantDb().tenantSecret.delete({ where: { id } });
    await audit.record({
      action: 'secret.delete',
      entityType: 'tenant_secret',
      entityId: id,
      before: auditView(before),
    });
  },
};

export interface GetSecretOptions {
  kind: string;
  /** Defaults to `default`. */
  name?: string;
  /** Most specific level to look at; falls back institution → group → organization. */
  institutionId?: string | null;
  groupId?: string | null;
  /** Why the engine needs it (audited), e.g. `email.send`, `ai.chat`. */
  purpose: string;
}

/**
 * INTERNAL API for engines (email, SMS, AI, storage…): decrypt a secret of the CURRENT tenant.
 * Resolution falls back institution → group → organization. Every successful access is audited
 * (`secret.access`). Returns null when no secret is configured. Never expose the result via HTTP.
 */
export async function getSecret(options: GetSecretOptions): Promise<SecretValue | null> {
  const organizationId = currentOrganizationId();
  const db = tenantDb();
  let groupId = options.groupId ?? null;
  if (options.institutionId && !groupId) {
    const inst = await db.institution.findFirst({
      where: { id: options.institutionId },
      select: { groupId: true },
    });
    groupId = inst?.groupId ?? null;
  }
  const candidates: Array<{ scopeType: SettingScopeType; targetId: string }> = [];
  if (options.institutionId) {
    candidates.push({ scopeType: 'INSTITUTION', targetId: options.institutionId });
  }
  if (groupId) candidates.push({ scopeType: 'GROUP', targetId: groupId });
  candidates.push({ scopeType: 'ORGANIZATION', targetId: organizationId });

  const name = options.name ?? 'default';
  const rows = await db.tenantSecret.findMany({
    where: { kind: options.kind, name, OR: candidates },
  });
  const row = candidates
    .map((c) => rows.find((r) => r.scopeType === c.scopeType && r.targetId === c.targetId))
    .find(Boolean);
  if (!row) return null;
  return openRow(row, options.purpose, { resolvedScope: row.scopeType });
}

/**
 * INTERNAL: decrypt one specific secret of the CURRENT tenant by id (e.g. the storage secret a
 * stored object was written with). Audited like `getSecret`. Null when it no longer exists.
 */
export async function getSecretById(options: {
  id: string;
  purpose: string;
}): Promise<SecretValue | null> {
  const row = await tenantDb().tenantSecret.findFirst({ where: { id: options.id } });
  if (!row) return null;
  return openRow(row, options.purpose, { byId: true });
}

async function openRow(
  row: TenantSecret,
  purpose: string,
  extra: Record<string, unknown>,
): Promise<SecretValue> {
  const organizationId = currentOrganizationId();
  let plaintext: string;
  try {
    plaintext = await openSecret(keyProvider(), { organizationId, secretId: row.id }, row);
  } catch (err) {
    logger.error(
      { secretRef: row.id, kind: row.kind, err: (err as Error).message },
      'Secret decryption failed',
    );
    await audit.record({
      action: 'secret.access_failed',
      entityType: 'tenant_secret',
      entityId: row.id,
      metadata: { kind: row.kind, name: row.name, purpose },
    });
    throw new Error('Secret could not be decrypted');
  }
  await audit.record({
    action: 'secret.access',
    entityType: 'tenant_secret',
    entityId: row.id,
    metadata: {
      kind: row.kind,
      name: row.name,
      purpose,
      ...extra,
      version: row.version,
    },
  });
  return new SecretValue(plaintext, {
    id: row.id,
    kind: row.kind,
    name: row.name,
    scopeType: row.scopeType,
    version: row.version,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  });
}

/**
 * Master key rotation: re-wrap every data key of an organization not yet on the active master
 * key version. Values are not decrypted. Call inside a tenant context (e.g. `runAsPlatform`).
 */
export async function rewrapOrganizationSecrets(): Promise<{ rewrapped: number; total: number }> {
  const organizationId = currentOrganizationId();
  const provider = keyProvider();
  const db = tenantDb();
  const rows = await db.tenantSecret.findMany({
    select: { id: true, wrappedKey: true, keyVersion: true },
  });
  let rewrapped = 0;
  for (const row of rows) {
    const next = await rewrapSecret(provider, { organizationId, secretId: row.id }, row);
    if (!next) continue;
    await db.tenantSecret.update({ where: { id: row.id }, data: next });
    rewrapped += 1;
  }
  await audit.record({
    action: 'secret.rewrap',
    entityType: 'organization',
    entityId: organizationId,
    metadata: { rewrapped, total: rows.length, activeKeyVersion: provider.activeVersion },
  });
  return { rewrapped, total: rows.length };
}

/**
 * INTERNAL API for engines that own credentials on behalf of a configured object (a
 * communication provider, a webhook signing secret, an integration credential). The CALLER is
 * responsible for authorization (e.g. `communication.manage`). Creates the secret, or rotates it
 * when one with the same target/kind/name exists. Audited as `secret.create` / `secret.rotate`.
 */
export async function putSecret(input: {
  target: SettingTarget;
  kind: string;
  name: string;
  value: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<{ id: string; last4: string | null; masked: string }> {
  assertSafeMetadata(input.metadata);
  const organizationId = currentOrganizationId();
  const userId = tryGetPrincipal()?.userId ?? null;
  const db = tenantDb();
  const provider = keyProvider();
  const existing = await db.tenantSecret.findFirst({
    where: {
      scopeType: input.target.scopeType,
      targetId: input.target.targetId,
      kind: input.kind,
      name: input.name,
    },
    select: DISPLAY_SELECT,
  });
  const id = existing?.id ?? randomUUID();
  const sealed = await sealSecret(provider, { organizationId, secretId: id }, input.value);
  const valueFields = {
    ...sealed,
    ...maskInfo(input.value),
    fingerprint: provider.fingerprint(input.value, organizationId),
  };
  const row = existing
    ? await db.tenantSecret.update({
        where: { id },
        data: {
          ...valueFields,
          version: { increment: 1 },
          rotatedAt: new Date(),
          updatedById: userId,
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
        select: DISPLAY_SELECT,
      })
    : await db.tenantSecret.create({
        data: withTenant({
          id,
          scopeType: input.target.scopeType,
          targetId: input.target.targetId,
          groupId: input.target.groupId,
          institutionId: input.target.institutionId,
          kind: input.kind,
          name: input.name,
          description: input.description ?? null,
          metadata: metadataJson(input.metadata),
          ...valueFields,
          createdById: userId,
          updatedById: userId,
        }),
        select: DISPLAY_SELECT,
      });
  await audit.record({
    action: existing ? 'secret.rotate' : 'secret.create',
    entityType: 'tenant_secret',
    entityId: row.id,
    ...(existing ? { before: auditView(existing) } : {}),
    after: auditView(row),
  });
  return { id: row.id, last4: row.last4, masked: maskedDisplay(row.last4) };
}

/** INTERNAL: crypto-shred a secret owned by an engine object (caller authorizes). */
export async function deleteSecretInternal(id: string): Promise<void> {
  const db = tenantDb();
  const row = await db.tenantSecret.findFirst({ where: { id }, select: DISPLAY_SELECT });
  if (!row) return;
  await db.tenantSecret.delete({ where: { id } });
  await audit.record({
    action: 'secret.delete',
    entityType: 'tenant_secret',
    entityId: id,
    before: auditView(row),
  });
}

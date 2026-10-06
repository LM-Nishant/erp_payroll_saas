import { randomUUID } from 'node:crypto';
import { TenantIsolationError } from '../tenancy/errors';

/**
 * Tenant-isolated object key strategy (spec §31). Keys are ALWAYS generated here — never taken
 * from clients:
 *
 *   org/{orgId}/inst/{institutionId}/{module}/{entity}/{entityId}/{uuid}-{sanitizedName}
 *   org/{orgId}/group/{groupId}/…           (group-level owners)
 *   org/{orgId}/shared/…                    (organization-level owners)
 *
 * Every storage access asserts the `org/{orgId}/` prefix of the current tenant.
 */

const SEGMENT = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ID = /^[0-9a-f-]{36}$/i;

/** Safe, readable file name: ASCII letters/digits/`.-_`, ≤ 100 chars, extension preserved. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const ascii = base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const dot = ascii.lastIndexOf('.');
  const stem = (dot > 0 ? ascii.slice(0, dot) : ascii)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  const ext =
    dot > 0
      ? ascii
          .slice(dot + 1)
          .replace(/[^A-Za-z0-9]/g, '')
          .toLowerCase()
      : '';
  const safeExt = ext.slice(0, 10);
  const safeStem = (stem || 'file').slice(0, 100 - (safeExt ? safeExt.length + 1 : 0));
  return safeExt ? `${safeStem}.${safeExt}` : safeStem;
}

export interface ObjectKeyParts {
  organizationId: string;
  groupId?: string | null;
  institutionId?: string | null;
  /** Owning module (`documents`, `branding`, `hr`…). */
  module: string;
  /** Entity type the file belongs to (`employee`, `institution`…). */
  entity: string;
  entityId: string;
  fileName: string;
}

export function buildObjectKey(parts: ObjectKeyParts): string {
  for (const [name, value] of [
    ['module', parts.module],
    ['entity', parts.entity],
  ] as const) {
    if (!SEGMENT.test(value)) throw new Error(`Invalid storage key ${name} segment`);
  }
  for (const id of [parts.organizationId, parts.entityId, parts.institutionId, parts.groupId]) {
    if (id && !ID.test(id)) throw new Error('Invalid id in storage key');
  }
  const level = parts.institutionId
    ? `inst/${parts.institutionId}`
    : parts.groupId
      ? `group/${parts.groupId}`
      : 'shared';
  return [
    'org',
    parts.organizationId,
    level,
    parts.module,
    parts.entity,
    parts.entityId,
    `${randomUUID()}-${sanitizeFileName(parts.fileName)}`,
  ].join('/');
}

/** Throws unless `key` is a well-formed key inside the given organization's prefix. */
export function assertTenantKey(key: string, organizationId: string): void {
  if (
    !key.startsWith(`org/${organizationId}/`) ||
    key.split('/').some((s) => s === '' || s === '.' || s === '..') ||
    !/^[A-Za-z0-9/_.-]+$/.test(key)
  ) {
    throw new TenantIsolationError('Storage key is outside the current tenant');
  }
}

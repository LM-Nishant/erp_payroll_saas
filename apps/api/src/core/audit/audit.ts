import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { currentRequestMeta } from '../http/request-context';
import { tryGetTenantContext } from '../tenancy/context';
import { tryGetPrincipal, type ActorType } from '../authz/principal';
import { auditDiff, redact } from './redact';

export interface AuditRecordInput {
  /** `<entity>.<verb>` e.g. `institution.update`, `auth.login_failed`, `user.role.assign`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Previous state (updates/deletes). Sensitive keys are redacted automatically. */
  before?: unknown;
  /** New state (creates/updates). Sensitive keys are redacted automatically. */
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  /** Defaults to the active tenant context (null for platform-level events). */
  organizationId?: string | null;
  /** Defaults to the current principal. */
  actorUserId?: string | null;
  actorType?: ActorType;
}

const json = (v: unknown) =>
  v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue);

/**
 * Append an audit record. Actor, organization, IP, user agent and request id are taken from
 * the request/tenant/principal context unless given explicitly. The audit_logs table is
 * append-only (DB triggers reject UPDATE/DELETE); there is no update/delete API.
 */
export async function recordAudit(input: AuditRecordInput): Promise<void> {
  const principal = tryGetPrincipal();
  const meta = currentRequestMeta();
  const diff = auditDiff(input.before, input.after);
  const metadata: Record<string, unknown> = { ...input.metadata };
  if (principal?.platformAccessReason) {
    metadata.platformAccessReason = principal.platformAccessReason;
  }
  if (principal?.apiClientId) metadata.apiClientId = principal.apiClientId;
  await prisma.auditLog.create({
    data: {
      organizationId:
        input.organizationId !== undefined
          ? input.organizationId
          : (tryGetTenantContext()?.organizationId ?? principal?.organizationId ?? null),
      actorUserId:
        input.actorUserId !== undefined ? input.actorUserId : (principal?.userId ?? null),
      actorType: input.actorType ?? principal?.actorType ?? 'system',
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: json(diff.before),
      after: json(diff.after),
      reason: input.reason ?? null,
      metadata: Object.keys(metadata).length > 0 ? json(redact(metadata)) : Prisma.DbNull,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      requestId: meta.requestId ?? null,
    },
  });
}

export const audit = { record: recordAudit };

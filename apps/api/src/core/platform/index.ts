import { recordAudit } from '../audit/audit';
import { createPrincipal, runWithPrincipal, type Principal } from '../authz/principal';
import { PLATFORM_ROLES } from '../authz/default-roles';
import { createSession, issueTokens } from '../auth/sessions';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { ForbiddenError, NotFoundError, ValidationError } from '../http/errors';
import { runWithTenant } from '../tenancy/context';

/**
 * Platform (cross-tenant) operations. Platform admins NEVER see tenant data implicitly; they
 * must open an audited tenant-access session (HTTP) or use `runAsPlatform` (server code),
 * both of which require a reason and always write an audit record.
 */

function assertReason(reason: string) {
  if (reason.trim().length < 10) {
    throw new ValidationError('A reason (min 10 characters) is required for platform access');
  }
}

/**
 * Open a short-lived (PLATFORM_ACCESS_TTL_MINUTES), non-refreshable session inside a tenant for
 * a platform admin holding `platform.tenant.access`. Audited in the TARGET tenant's log.
 */
export async function openTenantAccess(
  principal: Principal,
  organizationId: string,
  reason: string,
) {
  assertReason(reason);
  if (!principal.userId || !principal.platformPermissions.has('platform.tenant.access')) {
    throw new ForbiddenError(
      'Missing platform permission "platform.tenant.access"',
      'PERMISSION_DENIED',
    );
  }
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { id: true, slug: true, name: true },
  });
  if (!org) throw new NotFoundError('Organization');
  const session = await createSession({
    userId: principal.userId,
    organizationId: org.id,
    mfaVerified: false,
    platformAccessReason: reason,
    deviceName: 'platform-access',
    expiresAt: new Date(Date.now() + env.PLATFORM_ACCESS_TTL_MINUTES * 60_000),
  });
  await recordAudit({
    action: 'platform.tenant_access_opened',
    entityType: 'auth_session',
    entityId: session.id,
    organizationId: org.id,
    actorUserId: principal.userId,
    actorType: 'platform',
    reason,
    metadata: { platformRoles: principal.platformRoles },
  });
  const tokens = await issueTokens(session, { withRefresh: false });
  return { organization: org, sessionExpiresAt: session.expiresAt, ...tokens };
}

/**
 * Run trusted server code inside a tenant as the platform (e.g. support scripts, migrations).
 * Always audited (`platform.run_as`) before `fn` runs. The callback gets a `platform` principal
 * with the super-admin tenant-access permissions, org-wide.
 */
export async function runAsPlatform<T>(
  input: { organizationId: string; reason: string; actorUserId?: string | null },
  fn: () => Promise<T>,
): Promise<T> {
  assertReason(input.reason);
  const org = await prisma.organization.findFirst({
    where: { id: input.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!org) throw new NotFoundError('Organization');
  await recordAudit({
    action: 'platform.run_as',
    entityType: 'organization',
    entityId: org.id,
    organizationId: org.id,
    actorUserId: input.actorUserId ?? null,
    actorType: 'platform',
    reason: input.reason,
  });
  const superAdmin = PLATFORM_ROLES.find((r) => r.key === 'platform_super_admin')!;
  const principal = createPrincipal({
    actorType: 'platform',
    userId: input.actorUserId ?? null,
    sessionId: null,
    organizationId: org.id,
    platformAccessReason: input.reason,
    grants: [
      {
        roleKey: 'platform_access',
        permissions: new Set(superAdmin.tenantAccessPermissions),
        scopes: [{ type: 'ORGANIZATION', id: null }],
      },
    ],
  });
  return runWithTenant({ organizationId: org.id, source: 'system' }, () =>
    runWithPrincipal(principal, fn),
  );
}

/** Organization id for a slug (404 if unknown). Platform-level lookup. */
export async function resolveOrganizationSlug(slug: string): Promise<string> {
  const org = await prisma.organization.findFirst({ where: { slug }, select: { id: true } });
  if (!org) throw new NotFoundError('Organization');
  return org.id;
}
export * from './organizations';

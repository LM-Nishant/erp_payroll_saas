import type {
  ListOrganizationsQuery,
  OrganizationStatus,
  PlatformOrganizationDetailDto,
  PlatformOrganizationDto,
} from '@erp/shared';
import { ORGANIZATION_OWNER_ROLES } from '@erp/shared';
import { recordAudit } from '../audit/audit';
import { provisionOrganizationRoles } from '../authz/provisioning';
import { provisionOrganizationSubscription } from '../features/plans';
import { prisma } from '../db/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../http/errors';
import { toListResponse, toPageWindow } from '../http/pagination';

/**
 * Platform organization (tenant) lifecycle: onboarding, rename and suspend / archive.
 * Organization rows are platform data; every mutation is audited in the target tenant's log
 * with actorType `platform`.
 */

const orgSelect = {
  id: true,
  slug: true,
  name: true,
  status: true,
  kind: true,
  createdAt: true,
  updatedAt: true,
} as const;

type OrgRow = {
  id: string;
  slug: string;
  name: string;
  status: OrganizationStatus;
  kind: 'EDUCATION' | 'COMPANY';
  createdAt: Date;
  updatedAt: Date;
};

const toDto = (o: OrgRow): PlatformOrganizationDto => ({
  id: o.id,
  slug: o.slug,
  name: o.name,
  status: o.status,
  kind: o.kind,
  createdAt: o.createdAt.toISOString(),
  updatedAt: o.updatedAt.toISOString(),
});

export async function listPlatformOrganizations(query: ListOrganizationsQuery) {
  const where = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? { OR: [{ name: { contains: query.search } }, { slug: { contains: query.search } }] }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.organization.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: orgSelect,
      ...toPageWindow(query),
    }),
    prisma.organization.count({ where }),
  ]);
  return toListResponse(rows.map(toDto), total, query);
}

async function loadOrg(id: string): Promise<OrgRow> {
  const org = await prisma.organization.findFirst({
    where: { id, deletedAt: null },
    select: orgSelect,
  });
  if (!org) throw new NotFoundError('Organization');
  return org;
}

export async function getPlatformOrganization(id: string): Promise<PlatformOrganizationDetailDto> {
  const org = await loadOrg(id);
  const base = { organizationId: id, deletedAt: null };
  const [groups, institutions, users, employees, ownerRoles] = await prisma.$transaction([
    prisma.group.count({ where: base }),
    prisma.institution.count({ where: base }),
    prisma.organizationMembership.count({ where: base }),
    prisma.employee.count({ where: base }),
    prisma.userRole.findMany({
      where: {
        organizationId: id,
        role: { key: { in: [...ORGANIZATION_OWNER_ROLES] }, deletedAt: null },
      },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);
  const ownerIds = [...new Set(ownerRoles.map((r) => r.user.id))];
  const memberships = await prisma.organizationMembership.findMany({
    where: { organizationId: id, userId: { in: ownerIds }, deletedAt: null },
    select: { userId: true, status: true },
  });
  const statusOf = new Map(memberships.map((m) => [m.userId, m.status] as const));
  const owners = ownerIds
    .filter((uid) => statusOf.has(uid))
    .map((uid) => {
      const u = ownerRoles.find((r) => r.user.id === uid)!.user;
      return { id: u.id, name: u.name, email: u.email, membershipStatus: statusOf.get(uid)! };
    });
  return { ...toDto(org), counts: { groups, institutions, users, employees }, owners };
}

/**
 * Create the organization row and provision its default roles + subscription. The first owner
 * is invited separately (inside the tenant, via `runAsPlatform`) by the platform module.
 */
export async function createOrganizationRecord(
  actorUserId: string | null,
  input: {
    name: string;
    slug: string;
    kind?: 'EDUCATION' | 'COMPANY';
    planId: string;
    subscriptionStatus: 'TRIAL' | 'ACTIVE';
  },
): Promise<PlatformOrganizationDto> {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: input.planId } });
  if (!plan || plan.status !== 'ACTIVE') {
    throw new ValidationError('Unknown or inactive subscription plan', [
      { path: 'planId', message: 'Select an active plan' },
    ]);
  }
  // Slugs are globally unique, including soft-deleted organizations (login uses them).
  if (await prisma.organization.findUnique({ where: { slug: input.slug }, select: { id: true } })) {
    throw new ConflictError(`Organization slug "${input.slug}" is already taken`);
  }
  const org = await prisma.organization.create({
    data: { name: input.name, slug: input.slug, kind: input.kind ?? 'EDUCATION', status: 'ACTIVE' },
    select: orgSelect,
  });
  await provisionOrganizationRoles(org.id);
  await provisionOrganizationSubscription(org.id, plan.key, input.subscriptionStatus);
  await recordAudit({
    action: 'organization.create',
    entityType: 'organization',
    entityId: org.id,
    organizationId: org.id,
    actorUserId,
    actorType: 'platform',
    after: {
      name: org.name,
      slug: org.slug,
      status: org.status,
      plan: plan.key,
      subscriptionStatus: input.subscriptionStatus,
    },
  });
  return toDto(org);
}

export async function updateOrganizationRecord(
  actorUserId: string | null,
  id: string,
  input: { name: string; kind?: 'EDUCATION' | 'COMPANY'; reason: string },
): Promise<PlatformOrganizationDto> {
  const before = await loadOrg(id);
  const kind = input.kind ?? before.kind;
  if (before.name === input.name && before.kind === kind) return toDto(before);
  const org = await prisma.organization.update({
    where: { id },
    data: { name: input.name, kind },
    select: orgSelect,
  });
  await recordAudit({
    action: 'organization.update',
    entityType: 'organization',
    entityId: id,
    organizationId: id,
    actorUserId,
    actorType: 'platform',
    reason: input.reason,
    before: { name: before.name, kind: before.kind },
    after: { name: org.name, kind: org.kind },
  });
  return toDto(org);
}

/**
 * ACTIVE ⇄ SUSPENDED ⇄ ARCHIVED. Non-active organizations reject every tenant request with
 * 403 TENANT_INACTIVE (data is retained). Sessions in the tenant are revoked on suspend/archive.
 */
export async function setOrganizationStatus(
  actorUserId: string | null,
  id: string,
  input: { status: OrganizationStatus; reason: string },
): Promise<PlatformOrganizationDto> {
  const before = await loadOrg(id);
  if (before.status === input.status) return toDto(before);
  const org = await prisma.organization.update({
    where: { id },
    data: { status: input.status },
    select: orgSelect,
  });
  let revokedSessions = 0;
  if (input.status !== 'ACTIVE') {
    const res = await prisma.authSession.updateMany({
      where: { organizationId: id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'organization_inactive' },
    });
    revokedSessions = res.count;
  }
  await recordAudit({
    action: `organization.${input.status === 'ACTIVE' ? 'activate' : input.status === 'SUSPENDED' ? 'suspend' : 'archive'}`,
    entityType: 'organization',
    entityId: id,
    organizationId: id,
    actorUserId,
    actorType: 'platform',
    reason: input.reason,
    before: { status: before.status },
    after: { status: org.status },
    metadata: { revokedSessions },
  });
  return toDto(org);
}

import type { PrismaClient, ScopeType } from '@prisma/client';
import { hashPassword } from '../src/core/auth/password';
import { provisionOrganizationRoles, syncPermissionCatalog } from '../src/core/authz/provisioning';

/** Default demo password (development only; the seed refuses it in production). */
export const DEV_DEMO_PASSWORD = 'Demo-Passw0rd!';

type DemoScope =
  | { type: 'ORGANIZATION' }
  | { type: 'GROUP'; group: string }
  | { type: 'INSTITUTION'; institution: string }
  | { type: 'DEPARTMENT'; institution: string; department: string };

export interface DemoUser {
  email: string;
  name: string;
  platformRole?: string;
  organization?: string;
  role?: string;
  scope?: DemoScope;
}

/** Demo identities exercising each scope level (see docs/ARCHITECTURE.md §Authorization). */
export const DEMO_USERS: DemoUser[] = [
  {
    email: 'platform@erp.test',
    name: 'Platform Super Admin',
    platformRole: 'platform_super_admin',
  },
  {
    email: 'owner@abbs.test',
    name: 'ABBS Owner',
    organization: 'abbs',
    role: 'group_owner',
    scope: { type: 'ORGANIZATION' },
  },
  {
    email: 'group.admin@abbs.test',
    name: 'ABBS Group Admin',
    organization: 'abbs',
    role: 'group_admin',
    scope: { type: 'GROUP', group: 'ABBS' },
  },
  {
    email: 'eng.admin@abbs.test',
    name: 'ABBS Engineering Admin',
    organization: 'abbs',
    role: 'institution_admin',
    scope: { type: 'INSTITUTION', institution: 'ABBS-ENG' },
  },
  {
    email: 'cse.hod@abbs.test',
    name: 'ABBS Engineering CSE HOD',
    organization: 'abbs',
    role: 'hod',
    scope: { type: 'DEPARTMENT', institution: 'ABBS-ENG', department: 'CSE' },
  },
  {
    email: 'admin@bcc.test',
    name: 'BCC Group Admin',
    organization: 'bcc',
    role: 'group_admin',
    scope: { type: 'GROUP', group: 'BCC' },
  },
  {
    email: 'admin@jp-college.test',
    name: 'JP College Admin',
    organization: 'jp-college',
    role: 'institution_owner',
    scope: { type: 'INSTITUTION', institution: 'JPC' },
  },
];

async function resolveScope(prisma: PrismaClient, organizationId: string, scope: DemoScope) {
  const base = {
    scopeType: scope.type as ScopeType,
    groupId: null as string | null,
    institutionId: null as string | null,
    campusId: null as string | null,
    departmentId: null as string | null,
  };
  if (scope.type === 'GROUP') {
    const group = await prisma.group.findFirstOrThrow({
      where: { organizationId, code: scope.group },
    });
    return { ...base, groupId: group.id };
  }
  if (scope.type === 'INSTITUTION' || scope.type === 'DEPARTMENT') {
    const inst = await prisma.institution.findFirstOrThrow({
      where: { organizationId, code: scope.institution },
    });
    if (scope.type === 'INSTITUTION')
      return { ...base, groupId: inst.groupId, institutionId: inst.id };
    const dept = await prisma.department.findFirstOrThrow({
      where: { institutionId: inst.id, code: scope.department },
    });
    return {
      ...base,
      groupId: inst.groupId,
      institutionId: inst.id,
      campusId: dept.campusId,
      departmentId: dept.id,
    };
  }
  return base;
}

/**
 * Sync the permission catalog, provision default roles for every organization and (optionally)
 * create the demo users. Idempotent. Trusted seed code: uses the base client.
 */
export async function seedAccessControl(
  prisma: PrismaClient,
  organizationIds: Record<string, string>,
  options: { password?: string; users?: DemoUser[] } = {},
): Promise<Record<string, string>> {
  await syncPermissionCatalog();
  for (const id of Object.values(organizationIds)) await provisionOrganizationRoles(id);
  if (!options.password) return {};
  const passwordHash = await hashPassword(options.password);
  const userIds: Record<string, string> = {};
  for (const demo of options.users ?? DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { email: demo.email },
      create: { email: demo.email, name: demo.name, passwordHash, passwordChangedAt: new Date() },
      update: {
        name: demo.name,
        passwordHash,
        status: 'ACTIVE',
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    userIds[demo.email] = user.id;
    if (demo.platformRole) {
      await prisma.platformRoleAssignment.upsert({
        where: { userId_roleKey: { userId: user.id, roleKey: demo.platformRole } },
        create: { userId: user.id, roleKey: demo.platformRole },
        update: {},
      });
    }
    if (!demo.organization || !demo.role || !demo.scope) continue;
    const organizationId = organizationIds[demo.organization];
    if (!organizationId) throw new Error(`Unknown demo organization ${demo.organization}`);
    await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      create: { organizationId, userId: user.id, status: 'ACTIVE', joinedAt: new Date() },
      update: { status: 'ACTIVE', deletedAt: null },
    });
    const role = await prisma.role.findUniqueOrThrow({
      where: { organizationId_key: { organizationId, key: demo.role } },
    });
    const userRole = await prisma.userRole.upsert({
      where: { organizationId_userId_roleId: { organizationId, userId: user.id, roleId: role.id } },
      create: { organizationId, userId: user.id, roleId: role.id },
      update: {},
    });
    await prisma.userScope.deleteMany({ where: { userRoleId: userRole.id } });
    await prisma.userScope.create({
      data: {
        organizationId,
        userId: user.id,
        userRoleId: userRole.id,
        ...(await resolveScope(prisma, organizationId, demo.scope)),
      },
    });
  }
  return userIds;
}

import { PUBLIC_USER_SELECT } from '../../core/auth';
import type { PageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import type { ResolvedScope } from '../../core/authz';

type MembershipStatus = 'INVITED' | 'ACTIVE' | 'DISABLED';

const membershipInclude = { user: { select: PUBLIC_USER_SELECT } } as const;

const scopeInclude = {
  group: { select: { name: true } },
  institution: { select: { name: true } },
  campus: { select: { name: true } },
  department: { select: { name: true } },
} as const;

export const userRepository = {
  async listMemberships(
    filter: PageWindow & { search?: string; status?: MembershipStatus; userIds?: string[] },
  ) {
    const where = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.userIds ? { userId: { in: filter.userIds } } : {}),
      ...(filter.search
        ? {
            user: {
              OR: [{ email: { contains: filter.search } }, { name: { contains: filter.search } }],
            },
          }
        : {}),
    };
    const db = tenantDb();
    const [items, total] = await Promise.all([
      db.organizationMembership.findMany({
        where,
        include: membershipInclude,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      db.organizationMembership.count({ where }),
    ]);
    return { items, total };
  },

  findMembership: (userId: string) =>
    tenantDb().organizationMembership.findFirst({ where: { userId }, include: membershipInclude }),

  createMembership: (userId: string, status: MembershipStatus) =>
    tenantDb().organizationMembership.create({
      data: withTenant({ userId, status, joinedAt: status === 'ACTIVE' ? new Date() : null }),
      include: membershipInclude,
    }),

  setMembershipStatus: (membershipId: string, status: MembershipStatus) =>
    tenantDb().organizationMembership.update({
      where: { id: membershipId },
      data: { status, ...(status === 'ACTIVE' ? { joinedAt: new Date() } : {}) },
      include: membershipInclude,
    }),

  /** Role assignments (+ scope names) of the given users in the current tenant. */
  listAssignments: (userIds: string[]) =>
    tenantDb().userRole.findMany({
      where: { userId: { in: userIds } },
      include: {
        role: { select: { id: true, key: true, name: true } },
        scopes: { include: scopeInclude },
      },
      orderBy: { createdAt: 'asc' },
    }),

  /** Scope rows of one user (all role assignments). */
  listScopes: (userId: string) => tenantDb().userScope.findMany({ where: { userId } }),

  /** Distinct users holding at least one scope matching `where` (scope-filtered user lists). */
  async userIdsWithScopes(where: Record<string, unknown>): Promise<string[]> {
    const rows = await tenantDb().userScope.findMany({
      where,
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((r) => r.userId);
  },

  findRolesWithPermissions: (roleIds: string[]) =>
    tenantDb().role.findMany({
      where: { id: { in: roleIds } },
      include: { rolePermissions: { include: { permission: { select: { code: true } } } } },
    }),

  /** Replace all role assignments of a user atomically (join rows are hard-deleted). */
  replaceAssignments: (
    userId: string,
    assignments: Array<{ roleId: string; scopes: ResolvedScope[] }>,
  ) =>
    tenantDb().$transaction(async (tx) => {
      await tx.userScope.deleteMany({ where: { userId } });
      await tx.userRole.deleteMany({ where: { userId } });
      for (const assignment of assignments) {
        const userRole = await tx.userRole.create({
          data: withTenant({ userId, roleId: assignment.roleId }),
        });
        await tx.userScope.createMany({
          data: assignment.scopes.map((scope) =>
            withTenant({ userId, userRoleId: userRole.id, ...scope }),
          ),
        });
      }
    }),
};

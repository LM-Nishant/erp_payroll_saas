import type {
  CreateUserInput,
  ListUsersQuery,
  RoleAssignmentInput,
  UpdateUserInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import {
  createIdentity,
  findUserByEmail,
  issueUserToken,
  revokeUserSessions,
  scopeSummary,
  updateIdentityName,
  userHasPassword,
} from '../../core/auth';
import {
  accessFor,
  assertPermission,
  authorize,
  can,
  covers,
  currentPrincipal,
  resolveScopeTarget,
  scopeAsResource,
  whereForAccess,
  type Principal,
  type ResolvedScope,
} from '../../core/authz';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { userRepository } from './users.repository';

type Membership = NonNullable<Awaited<ReturnType<typeof userRepository.findMembership>>>;

async function withAssignments(memberships: Membership[]) {
  const assignments = await userRepository.listAssignments(memberships.map((m) => m.userId));
  return memberships.map((m) => ({
    ...m.user,
    membershipStatus: m.status,
    joinedAt: m.joinedAt,
    roles: assignments
      .filter((a) => a.userId === m.userId)
      .map((a) => ({
        id: a.role.id,
        key: a.role.key,
        name: a.role.name,
        scopes: a.scopes.map(scopeSummary),
      })),
  }));
}

/**
 * A user is visible / manageable by a scoped admin only if ALL of the user's role scopes lie
 * within the admin's scopes for `permission` (so an institution admin cannot touch a group
 * admin who happens to also have a scope in their institution). Org-wide grants see everyone.
 * Users without any role scope are manageable only by org-wide grants (unless `allowUnscoped`).
 */
async function isWithinAccess(
  principal: Principal,
  permission: string,
  userId: string,
  options: { allowUnscoped?: boolean } = {},
): Promise<boolean> {
  const access = await accessFor(principal, permission);
  if (access.all) return true;
  const scopes = await userRepository.listScopes(userId);
  if (scopes.length === 0) return Boolean(options.allowUnscoped);
  return scopes.every((s) => s.scopeType !== 'ORGANIZATION' && covers(access, s));
}

async function loadMembership(userId: string): Promise<Membership> {
  const membership = await userRepository.findMembership(userId);
  if (!membership) throw new NotFoundError('User');
  return membership;
}

/** Load a user for a mutation guarded by `permission` (404 if invisible, 403 if out of scope). */
async function loadManageable(
  userId: string,
  permission: string,
  options?: { allowUnscoped?: boolean },
) {
  const principal = currentPrincipal();
  assertPermission(principal, permission);
  const membership = await loadMembership(userId);
  if (!(await isWithinAccess(principal, 'user.view', userId, options)))
    throw new NotFoundError('User');
  if (!(await isWithinAccess(principal, permission, userId, options))) {
    throw new ForbiddenError(
      `Permission "${permission}" is not granted for this user's scope`,
      'SCOPE_DENIED',
    );
  }
  return { principal, membership };
}

/**
 * Validate role assignments against the assigner's own grants (no privilege escalation): for
 * every target scope the assigner needs `user.role.assign` AND every permission of the role,
 * each covering that scope.
 */
async function resolveAssignments(principal: Principal, roles: RoleAssignmentInput[]) {
  const roleIds = [...new Set(roles.map((r) => r.roleId))];
  if (roleIds.length !== roles.length) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      'Each role may be assigned only once; list all its scopes together',
    );
  }
  const found = await userRepository.findRolesWithPermissions(roleIds);
  const byId = new Map(found.map((r) => [r.id, r] as const));
  const resolved: Array<{ roleId: string; roleKey: string; scopes: ResolvedScope[] }> = [];
  for (const assignment of roles) {
    const role = byId.get(assignment.roleId);
    if (!role)
      throw new AppError(422, 'INVALID_REFERENCE', 'roleId does not reference an existing Role', {
        field: 'roleId',
      });
    const scopes: ResolvedScope[] = [];
    for (const input of assignment.scopes) {
      const scope = await resolveScopeTarget(input);
      const resource = scopeAsResource(scope);
      await authorize(principal, 'user.role.assign', resource);
      for (const { permission } of role.rolePermissions) {
        if (!(await can(principal, permission.code, resource))) {
          throw new ForbiddenError(
            `Cannot grant role "${role.key}": you do not hold "${permission.code}" in that scope`,
            'ESCALATION_DENIED',
          );
        }
      }
      scopes.push(scope);
    }
    resolved.push({ roleId: role.id, roleKey: role.key, scopes });
  }
  return resolved;
}

function describeAssignments(assignments: Array<{ roleKey: string; scopes: ResolvedScope[] }>) {
  return assignments.map((a) => ({
    role: a.roleKey,
    scopes: a.scopes.map((s) => ({
      type: s.scopeType,
      id: s.departmentId ?? s.campusId ?? s.institutionId ?? s.groupId ?? null,
    })),
  }));
}

async function currentAssignmentsSnapshot(userId: string) {
  const rows = await userRepository.listAssignments([userId]);
  return rows.map((r) => ({
    role: r.role.key,
    scopes: r.scopes.map(scopeSummary).map(({ type, id }) => ({ type, id })),
  }));
}

export const userService = {
  async list(query: ListUsersQuery) {
    const principal = currentPrincipal();
    assertPermission(principal, 'user.view');
    const access = await accessFor(principal, 'user.view');
    const userIds = access.all
      ? undefined
      : await userRepository.userIdsWithScopes(whereForAccess(access, 'userScope')!);
    // Scoped viewers: keep only users whose scopes ALL fall inside the viewer's access.
    const visible = userIds
      ? (
          await Promise.all(
            userIds.map(async (id) =>
              (await isWithinAccess(principal, 'user.view', id)) ? id : null,
            ),
          )
        ).filter((id): id is string => id !== null)
      : undefined;
    const { items, total } = await userRepository.listMemberships({
      ...toPageWindow(query),
      search: query.search,
      status: query.status,
      userIds: visible,
    });
    return { items: await withAssignments(items), total };
  },

  async get(userId: string) {
    const principal = currentPrincipal();
    assertPermission(principal, 'user.view');
    const membership = await loadMembership(userId);
    if (!(await isWithinAccess(principal, 'user.view', userId))) throw new NotFoundError('User');
    return (await withAssignments([membership]))[0]!;
  },

  async create(input: CreateUserInput) {
    const principal = currentPrincipal();
    assertPermission(principal, 'user.create');
    const assignments = await resolveAssignments(principal, input.roles);
    // The new user must land inside the creator's scope; role-less users need org-wide rights.
    if (assignments.length === 0) await authorize(principal, 'user.create', {});
    for (const a of assignments) {
      for (const s of a.scopes) await authorize(principal, 'user.create', scopeAsResource(s));
    }

    const existing = await findUserByEmail(input.email);
    if (existing && input.password) {
      throw new ConflictError(
        'A user with this email already exists; omit the password to add them',
      );
    }
    if (existing && (await userRepository.findMembership(existing.user.id))) {
      throw new ConflictError('User is already a member of this organization');
    }
    const user = existing?.user ?? (await createIdentity(input));
    const hasPassword = existing ? existing.hasPassword : Boolean(input.password);
    const membership = await userRepository.createMembership(
      user.id,
      hasPassword ? 'ACTIVE' : 'INVITED',
    );
    if (assignments.length > 0) await userRepository.replaceAssignments(user.id, assignments);

    const invite = hasPassword
      ? null
      : await issueUserToken({
          userId: user.id,
          organizationId: membership.organizationId,
          type: 'INVITE',
        });

    await audit.record({
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      after: { email: user.email, name: user.name, membershipStatus: membership.status },
      metadata: { existingIdentity: Boolean(existing) },
    });
    if (assignments.length > 0) {
      await audit.record({
        action: 'user.role.assign',
        entityType: 'user',
        entityId: user.id,
        before: { roles: [] },
        after: { roles: describeAssignments(assignments) },
      });
    }
    const [view] = await withAssignments([await loadMembership(user.id)]);
    // Until the notification engine (Layer 5) delivers invites, the token is returned once here.
    return {
      ...view!,
      ...(invite ? { inviteToken: invite.token, inviteExpiresAt: invite.expiresAt } : {}),
    };
  },

  async update(userId: string, input: UpdateUserInput) {
    const { membership } = await loadManageable(userId, 'user.update');
    if (input.name !== undefined && input.name !== membership.user.name) {
      await updateIdentityName(userId, input.name);
      await audit.record({
        action: 'user.update',
        entityType: 'user',
        entityId: userId,
        before: { name: membership.user.name },
        after: { name: input.name },
      });
    }
    return userService.get(userId);
  },

  async setRoles(userId: string, roles: RoleAssignmentInput[]) {
    const { principal } = await loadManageable(userId, 'user.role.assign', { allowUnscoped: true });
    const assignments = await resolveAssignments(principal, roles);
    const before = await currentAssignmentsSnapshot(userId);
    await userRepository.replaceAssignments(userId, assignments);
    await audit.record({
      action: 'user.role.assign',
      entityType: 'user',
      entityId: userId,
      before: { roles: before },
      after: { roles: describeAssignments(assignments) },
    });
    return userService.get(userId);
  },

  async setActive(userId: string, active: boolean) {
    const { principal, membership } = await loadManageable(userId, 'user.deactivate');
    if (principal.userId === userId) throw new ConflictError('You cannot change your own status');
    const status = active ? ((await userHasPassword(userId)) ? 'ACTIVE' : 'INVITED') : 'DISABLED';
    if (status !== membership.status) {
      await userRepository.setMembershipStatus(membership.id, status);
      if (!active) {
        await revokeUserSessions(userId, 'deactivated', {
          organizationId: membership.organizationId,
        });
      }
      await audit.record({
        action: active ? 'user.reactivate' : 'user.deactivate',
        entityType: 'user',
        entityId: userId,
        before: { membershipStatus: membership.status },
        after: { membershipStatus: status },
      });
    }
    return userService.get(userId);
  },

  /** Issue a one-time password reset token (returned until notifications exist in Layer 5). */
  async issuePasswordReset(userId: string) {
    const { membership } = await loadManageable(userId, 'user.reset_password');
    const reset = await issueUserToken({
      userId,
      organizationId: membership.organizationId,
      type: 'PASSWORD_RESET',
    });
    await audit.record({
      action: 'user.password_reset_issued',
      entityType: 'user',
      entityId: userId,
    });
    return { resetToken: reset.token, expiresAt: reset.expiresAt };
  },
};

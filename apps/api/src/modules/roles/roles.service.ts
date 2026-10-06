import {
  isPlatformPermission,
  type CreateRoleInput,
  type PaginationQuery,
  type UpdateRoleInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import {
  authorize,
  can,
  currentPrincipal,
  permissionIdsFor,
  type Principal,
} from '../../core/authz';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { roleRepository } from './roles.repository';

type RoleRow = NonNullable<Awaited<ReturnType<typeof roleRepository.findById>>>;

function toView(role: RoleRow) {
  const { rolePermissions, _count, ...rest } = role;
  return {
    ...rest,
    permissions: rolePermissions.map((rp) => rp.permission.code).sort(),
    assignedUsers: _count.userRoles,
  };
}

/**
 * Validate a permission set for a custom role: known, tenant-level, and all held org-wide by
 * the editor (a role manager cannot mint permissions they do not have themselves).
 */
async function permissionIds(principal: Principal, codes: string[]) {
  const unique = [...new Set(codes)];
  const platform = unique.filter(isPlatformPermission);
  if (platform.length > 0) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      'Platform permissions cannot be granted to tenant roles',
      {
        permissions: platform,
      },
    );
  }
  const { ids, unknown } = await permissionIdsFor(unique);
  if (unknown.length > 0) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Unknown permissions', { permissions: unknown });
  }
  for (const code of unique) {
    if (!(await can(principal, code, {}))) {
      throw new ForbiddenError(
        `You cannot grant "${code}" which you do not hold organization-wide`,
        'ESCALATION_DENIED',
      );
    }
  }
  return { ids, codes: unique.sort() };
}

async function loadRole(id: string) {
  const role = await roleRepository.findById(id);
  if (!role) throw new NotFoundError('Role');
  return role;
}

async function loadCustomRole(id: string) {
  const role = await loadRole(id);
  if (role.isSystem) throw new ConflictError('System roles are read-only');
  return role;
}

export const roleService = {
  async list(query: PaginationQuery) {
    const { items, total } = await roleRepository.list({
      ...toPageWindow(query),
      search: query.search,
    });
    return { items: items.map(toView), total };
  },

  get: async (id: string) => toView(await loadRole(id)),

  async create(input: CreateRoleInput) {
    const principal = currentPrincipal();
    await authorize(principal, 'role.manage', {});
    if (await roleRepository.findByKey(input.key))
      throw new ConflictError('Role key already exists');
    const perms = await permissionIds(principal, input.permissions);
    const id = await roleRepository.create({
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      permissionIds: perms.ids,
    });
    const view = await roleService.get(id);
    await audit.record({ action: 'role.create', entityType: 'role', entityId: id, after: view });
    return view;
  },

  async update(id: string, input: UpdateRoleInput) {
    const principal = currentPrincipal();
    await authorize(principal, 'role.manage', {});
    const before = toView(await loadCustomRole(id));
    const perms = input.permissions ? await permissionIds(principal, input.permissions) : undefined;
    await roleRepository.update(id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(perms ? { permissionIds: perms.ids } : {}),
    });
    const after = await roleService.get(id);
    await audit.record({ action: 'role.update', entityType: 'role', entityId: id, before, after });
    return after;
  },

  async remove(id: string) {
    await authorize(currentPrincipal(), 'role.manage', {});
    const role = await loadCustomRole(id);
    if (role._count.userRoles > 0) throw new ConflictError('Role is still assigned to users');
    await roleRepository.softDelete(id);
    await audit.record({
      action: 'role.delete',
      entityType: 'role',
      entityId: id,
      before: toView(role),
    });
  },
};

import type { CreateGroupInput, PaginationQuery, UpdateGroupInput } from '@erp/shared';
import { audit } from '../../core/audit';
import { authorize, can, currentPrincipal, hierarchyResource, scopeWhere } from '../../core/authz';
import { ConflictError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { groupRepository } from './groups.repository';

export const groupService = {
  list: async (query: PaginationQuery) =>
    groupRepository.list({
      ...toPageWindow(query),
      search: query.search,
      scope: await scopeWhere(currentPrincipal(), 'group.view', 'group'),
    }),

  /** Out-of-scope rows are reported as not found (no existence leak). */
  async get(id: string) {
    const group = await groupRepository.findById(id);
    if (!group || !(await can(currentPrincipal(), 'group.view', hierarchyResource.group(group)))) {
      throw new NotFoundError('Group');
    }
    return group;
  },

  async create(input: CreateGroupInput) {
    await authorize(currentPrincipal(), 'group.create', {});
    const group = await groupRepository.create(input);
    await audit.record({
      action: 'group.create',
      entityType: 'group',
      entityId: group.id,
      after: group,
    });
    return group;
  },

  async update(id: string, input: UpdateGroupInput) {
    const before = await groupService.get(id);
    await authorize(currentPrincipal(), 'group.update', hierarchyResource.group(before));
    const after = await groupRepository.update(id, input);
    await audit.record({
      action: 'group.update',
      entityType: 'group',
      entityId: id,
      before,
      after,
    });
    return after;
  },

  async remove(id: string) {
    const before = await groupService.get(id);
    await authorize(currentPrincipal(), 'group.delete', hierarchyResource.group(before));
    if ((await groupRepository.countInstitutions(id)) > 0) {
      throw new ConflictError('Group still has institutions; move or delete them first');
    }
    await groupRepository.softDelete(id);
    await audit.record({ action: 'group.delete', entityType: 'group', entityId: id, before });
  },
};

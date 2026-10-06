import type { CreateGroupInput, UpdateGroupInput } from '@erp/shared';
import { ConflictError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import type { PaginationQuery } from '@erp/shared';
import { groupRepository } from './groups.repository';

export const groupService = {
  list: (query: PaginationQuery) =>
    groupRepository.list({ ...toPageWindow(query), search: query.search }),

  async get(id: string) {
    const group = await groupRepository.findById(id);
    if (!group) throw new NotFoundError('Group');
    return group;
  },

  create: (input: CreateGroupInput) => groupRepository.create(input),

  async update(id: string, input: UpdateGroupInput) {
    await groupService.get(id);
    return groupRepository.update(id, input);
  },

  async remove(id: string) {
    await groupService.get(id);
    if ((await groupRepository.countInstitutions(id)) > 0) {
      throw new ConflictError('Group still has institutions; move or delete them first');
    }
    await groupRepository.softDelete(id);
  },
};

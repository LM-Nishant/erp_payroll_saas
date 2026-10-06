import type { CreateInstitutionInput, PaginationQuery, UpdateInstitutionInput } from '@erp/shared';
import { ConflictError, InvalidReferenceError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { groupRepository } from '../groups/groups.repository';
import { institutionRepository } from './institutions.repository';

async function assertGroupExists(groupId: string | null | undefined) {
  if (groupId && !(await groupRepository.findById(groupId))) {
    throw new InvalidReferenceError('groupId', 'Group');
  }
}

export const institutionService = {
  list: (query: PaginationQuery & { groupId?: string; independent?: boolean }) =>
    institutionRepository.list({
      ...toPageWindow(query),
      search: query.search,
      groupId: query.groupId,
      independent: query.independent,
    }),

  async get(id: string) {
    const institution = await institutionRepository.findById(id);
    if (!institution) throw new NotFoundError('Institution');
    return institution;
  },

  async create(input: CreateInstitutionInput) {
    await assertGroupExists(input.groupId);
    return institutionRepository.create(input);
  },

  async update(id: string, input: UpdateInstitutionInput) {
    await institutionService.get(id);
    await assertGroupExists(input.groupId);
    return institutionRepository.update(id, input);
  },

  async remove(id: string) {
    await institutionService.get(id);
    if ((await institutionRepository.countChildren(id)) > 0) {
      throw new ConflictError('Institution still has campuses or departments');
    }
    await institutionRepository.softDelete(id);
  },
};

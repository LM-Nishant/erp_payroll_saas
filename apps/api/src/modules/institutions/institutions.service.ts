import type { CreateInstitutionInput, PaginationQuery, UpdateInstitutionInput } from '@erp/shared';
import { audit } from '../../core/audit';
import { authorize, can, currentPrincipal, hierarchyResource, scopeWhere } from '../../core/authz';
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
  list: async (query: PaginationQuery & { groupId?: string; independent?: boolean }) =>
    institutionRepository.list({
      ...toPageWindow(query),
      search: query.search,
      groupId: query.groupId,
      independent: query.independent,
      scope: await scopeWhere(currentPrincipal(), 'institution.view', 'institution'),
    }),

  async get(id: string) {
    const institution = await institutionRepository.findById(id);
    if (
      !institution ||
      !(await can(
        currentPrincipal(),
        'institution.view',
        hierarchyResource.institution(institution),
      ))
    ) {
      throw new NotFoundError('Institution');
    }
    return institution;
  },

  async create(input: CreateInstitutionInput) {
    await assertGroupExists(input.groupId);
    await authorize(currentPrincipal(), 'institution.create', { groupId: input.groupId ?? null });
    const institution = await institutionRepository.create(input);
    await audit.record({
      action: 'institution.create',
      entityType: 'institution',
      entityId: institution.id,
      after: institution,
    });
    return institution;
  },

  async update(id: string, input: UpdateInstitutionInput) {
    const before = await institutionService.get(id);
    const principal = currentPrincipal();
    await authorize(principal, 'institution.update', hierarchyResource.institution(before));
    if (input.groupId !== undefined && input.groupId !== before.groupId) {
      await assertGroupExists(input.groupId);
      // Moving between groups requires update rights at the destination too.
      await authorize(principal, 'institution.update', { groupId: input.groupId });
    }
    const after = await institutionRepository.update(id, input);
    await audit.record({
      action: 'institution.update',
      entityType: 'institution',
      entityId: id,
      before,
      after,
    });
    return after;
  },

  async remove(id: string) {
    const before = await institutionService.get(id);
    await authorize(
      currentPrincipal(),
      'institution.delete',
      hierarchyResource.institution(before),
    );
    if ((await institutionRepository.countChildren(id)) > 0) {
      throw new ConflictError('Institution still has campuses or departments');
    }
    await institutionRepository.softDelete(id);
    await audit.record({
      action: 'institution.delete',
      entityType: 'institution',
      entityId: id,
      before,
    });
  },
};

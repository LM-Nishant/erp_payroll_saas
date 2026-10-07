import type { CreateCampusInput, PaginationQuery, UpdateCampusInput } from '@erp/shared';
import { audit } from '../../core/audit';
import { authorize, can, currentPrincipal, hierarchyResource, scopeWhere } from '../../core/authz';
import { ConflictError, InvalidReferenceError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { institutionRepository } from '../institutions/institutions.repository';
import { campusRepository } from './campuses.repository';

/** Ensures a campus exists in the current tenant and belongs to the given institution. */
export async function assertCampusInInstitution(
  campusId: string | null | undefined,
  institutionId: string,
): Promise<void> {
  if (!campusId) return;
  const campus = await campusRepository.findById(campusId);
  if (!campus || campus.institutionId !== institutionId) {
    throw new InvalidReferenceError('campusId', 'Campus');
  }
}

export const campusService = {
  list: async (query: PaginationQuery & { institutionId?: string }) =>
    campusRepository.list({
      ...toPageWindow(query),
      search: query.search,
      institutionId: query.institutionId,
      scope: await scopeWhere(currentPrincipal(), 'campus.view', 'campus'),
    }),

  async get(id: string) {
    const campus = await campusRepository.findById(id);
    if (
      !campus ||
      !(await can(currentPrincipal(), 'campus.view', hierarchyResource.campus(campus)))
    ) {
      throw new NotFoundError('Campus');
    }
    return campus;
  },

  async create(input: CreateCampusInput) {
    if (!(await institutionRepository.findById(input.institutionId))) {
      throw new InvalidReferenceError('institutionId', 'Institution');
    }
    await authorize(currentPrincipal(), 'campus.create', { institutionId: input.institutionId });
    const campus = await campusRepository.create(input);
    await audit.record({
      action: 'campus.create',
      entityType: 'campus',
      entityId: campus.id,
      after: campus,
    });
    return campus;
  },

  async update(id: string, input: UpdateCampusInput) {
    const before = await campusService.get(id);
    await authorize(currentPrincipal(), 'campus.update', hierarchyResource.campus(before));
    const after = await campusRepository.update(id, input);
    await audit.record({
      action: 'campus.update',
      entityType: 'campus',
      entityId: id,
      before,
      after,
    });
    return after;
  },

  async remove(id: string) {
    const before = await campusService.get(id);
    await authorize(currentPrincipal(), 'campus.delete', hierarchyResource.campus(before));
    if ((await campusRepository.countChildren(id)) > 0) {
      throw new ConflictError('Campus is still referenced by departments or class sections');
    }
    await campusRepository.softDelete(id);
    await audit.record({ action: 'campus.delete', entityType: 'campus', entityId: id, before });
  },
};

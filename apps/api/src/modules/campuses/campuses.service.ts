import type { CreateCampusInput, PaginationQuery, UpdateCampusInput } from '@erp/shared';
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
  list: (query: PaginationQuery & { institutionId?: string }) =>
    campusRepository.list({
      ...toPageWindow(query),
      search: query.search,
      institutionId: query.institutionId,
    }),

  async get(id: string) {
    const campus = await campusRepository.findById(id);
    if (!campus) throw new NotFoundError('Campus');
    return campus;
  },

  async create(input: CreateCampusInput) {
    if (!(await institutionRepository.findById(input.institutionId))) {
      throw new InvalidReferenceError('institutionId', 'Institution');
    }
    return campusRepository.create(input);
  },

  async update(id: string, input: UpdateCampusInput) {
    await campusService.get(id);
    return campusRepository.update(id, input);
  },

  async remove(id: string) {
    await campusService.get(id);
    if ((await campusRepository.countChildren(id)) > 0) {
      throw new ConflictError('Campus is still referenced by departments or class sections');
    }
    await campusRepository.softDelete(id);
  },
};

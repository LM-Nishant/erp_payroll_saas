import type { CreateDepartmentInput, PaginationQuery, UpdateDepartmentInput } from '@erp/shared';
import { ConflictError, InvalidReferenceError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { assertCampusInInstitution } from '../campuses/campuses.service';
import { institutionRepository } from '../institutions/institutions.repository';
import { departmentRepository } from './departments.repository';

export const departmentService = {
  list: (query: PaginationQuery & { institutionId?: string; campusId?: string }) =>
    departmentRepository.list({
      ...toPageWindow(query),
      search: query.search,
      institutionId: query.institutionId,
      campusId: query.campusId,
    }),

  async get(id: string) {
    const department = await departmentRepository.findById(id);
    if (!department) throw new NotFoundError('Department');
    return department;
  },

  async create(input: CreateDepartmentInput) {
    if (!(await institutionRepository.findById(input.institutionId))) {
      throw new InvalidReferenceError('institutionId', 'Institution');
    }
    await assertCampusInInstitution(input.campusId, input.institutionId);
    return departmentRepository.create(input);
  },

  async update(id: string, input: UpdateDepartmentInput) {
    const existing = await departmentService.get(id);
    await assertCampusInInstitution(input.campusId, existing.institutionId);
    return departmentRepository.update(id, input);
  },

  async remove(id: string) {
    await departmentService.get(id);
    if ((await departmentRepository.countPrograms(id)) > 0) {
      throw new ConflictError('Department still has programs');
    }
    await departmentRepository.softDelete(id);
  },
};

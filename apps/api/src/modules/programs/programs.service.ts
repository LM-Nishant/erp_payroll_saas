import type { CreateProgramInput, PaginationQuery, UpdateProgramInput } from '@erp/shared';
import { ConflictError, InvalidReferenceError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { departmentRepository } from '../departments/departments.repository';
import { programRepository } from './programs.repository';

export const programService = {
  list: (query: PaginationQuery & { institutionId?: string; departmentId?: string }) =>
    programRepository.list({
      ...toPageWindow(query),
      search: query.search,
      institutionId: query.institutionId,
      departmentId: query.departmentId,
    }),

  async get(id: string) {
    const program = await programRepository.findById(id);
    if (!program) throw new NotFoundError('Program');
    return program;
  },

  async create(input: CreateProgramInput) {
    const department = await departmentRepository.findById(input.departmentId);
    if (!department) throw new InvalidReferenceError('departmentId', 'Department');
    // Hierarchy FKs are derived server-side from the (tenant-verified) parent.
    return programRepository.create({ ...input, institutionId: department.institutionId });
  },

  async update(id: string, input: UpdateProgramInput) {
    await programService.get(id);
    return programRepository.update(id, input);
  },

  async remove(id: string) {
    await programService.get(id);
    if ((await programRepository.countClassSections(id)) > 0) {
      throw new ConflictError('Program still has class sections');
    }
    await programRepository.softDelete(id);
  },
};

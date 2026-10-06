import type { CreateProgramInput, PaginationQuery, UpdateProgramInput } from '@erp/shared';
import { audit } from '../../core/audit';
import { authorize, can, currentPrincipal, hierarchyResource, scopeWhere } from '../../core/authz';
import { ConflictError, InvalidReferenceError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { departmentRepository } from '../departments/departments.repository';
import { programRepository } from './programs.repository';

export const programService = {
  list: async (query: PaginationQuery & { institutionId?: string; departmentId?: string }) =>
    programRepository.list({
      ...toPageWindow(query),
      search: query.search,
      institutionId: query.institutionId,
      departmentId: query.departmentId,
      scope: await scopeWhere(currentPrincipal(), 'program.view', 'program'),
    }),

  async get(id: string) {
    const program = await programRepository.findById(id);
    if (
      !program ||
      !(await can(currentPrincipal(), 'program.view', hierarchyResource.program(program)))
    ) {
      throw new NotFoundError('Program');
    }
    return program;
  },

  async create(input: CreateProgramInput) {
    const department = await departmentRepository.findById(input.departmentId);
    if (!department) throw new InvalidReferenceError('departmentId', 'Department');
    await authorize(currentPrincipal(), 'program.create', {
      institutionId: department.institutionId,
      campusId: department.campusId,
      departmentId: department.id,
    });
    // Hierarchy FKs are derived server-side from the (tenant-verified) parent.
    const program = await programRepository.create({
      ...input,
      institutionId: department.institutionId,
    });
    await audit.record({
      action: 'program.create',
      entityType: 'program',
      entityId: program.id,
      after: program,
    });
    return program;
  },

  async update(id: string, input: UpdateProgramInput) {
    const before = await programService.get(id);
    await authorize(currentPrincipal(), 'program.update', hierarchyResource.program(before));
    const after = await programRepository.update(id, input);
    await audit.record({
      action: 'program.update',
      entityType: 'program',
      entityId: id,
      before,
      after,
    });
    return after;
  },

  async remove(id: string) {
    const before = await programService.get(id);
    await authorize(currentPrincipal(), 'program.delete', hierarchyResource.program(before));
    if ((await programRepository.countClassSections(id)) > 0) {
      throw new ConflictError('Program still has class sections');
    }
    await programRepository.softDelete(id);
    await audit.record({ action: 'program.delete', entityType: 'program', entityId: id, before });
  },
};

import type { CreateDepartmentInput, PaginationQuery, UpdateDepartmentInput } from '@erp/shared';
import { audit } from '../../core/audit';
import { authorize, can, currentPrincipal, hierarchyResource, scopeWhere } from '../../core/authz';
import { ConflictError, InvalidReferenceError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { assertCampusInInstitution } from '../campuses/campuses.service';
import { institutionRepository } from '../institutions/institutions.repository';
import { departmentRepository } from './departments.repository';

export const departmentService = {
  list: async (query: PaginationQuery & { institutionId?: string; campusId?: string }) =>
    departmentRepository.list({
      ...toPageWindow(query),
      search: query.search,
      institutionId: query.institutionId,
      campusId: query.campusId,
      scope: await scopeWhere(currentPrincipal(), 'department.view', 'department'),
    }),

  async get(id: string) {
    const department = await departmentRepository.findById(id);
    if (
      !department ||
      !(await can(currentPrincipal(), 'department.view', hierarchyResource.department(department)))
    ) {
      throw new NotFoundError('Department');
    }
    return department;
  },

  async create(input: CreateDepartmentInput) {
    if (!(await institutionRepository.findById(input.institutionId))) {
      throw new InvalidReferenceError('institutionId', 'Institution');
    }
    await assertCampusInInstitution(input.campusId, input.institutionId);
    await authorize(currentPrincipal(), 'department.create', {
      institutionId: input.institutionId,
      campusId: input.campusId ?? null,
    });
    const department = await departmentRepository.create(input);
    await audit.record({
      action: 'department.create',
      entityType: 'department',
      entityId: department.id,
      after: department,
    });
    return department;
  },

  async update(id: string, input: UpdateDepartmentInput) {
    const before = await departmentService.get(id);
    const principal = currentPrincipal();
    await authorize(principal, 'department.update', hierarchyResource.department(before));
    await assertCampusInInstitution(input.campusId, before.institutionId);
    if (input.campusId && input.campusId !== before.campusId) {
      await authorize(principal, 'department.update', {
        institutionId: before.institutionId,
        campusId: input.campusId,
      });
    }
    const after = await departmentRepository.update(id, input);
    await audit.record({
      action: 'department.update',
      entityType: 'department',
      entityId: id,
      before,
      after,
    });
    return after;
  },

  async remove(id: string) {
    const before = await departmentService.get(id);
    await authorize(currentPrincipal(), 'department.delete', hierarchyResource.department(before));
    if ((await departmentRepository.countPrograms(id)) > 0) {
      throw new ConflictError('Department still has programs');
    }
    await departmentRepository.softDelete(id);
    await audit.record({
      action: 'department.delete',
      entityType: 'department',
      entityId: id,
      before,
    });
  },
};

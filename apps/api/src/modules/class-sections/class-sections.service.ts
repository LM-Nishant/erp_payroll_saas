import type {
  CreateClassSectionInput,
  PaginationQuery,
  UpdateClassSectionInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { authorize, can, currentPrincipal, hierarchyResource, scopeWhere } from '../../core/authz';
import { InvalidReferenceError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { assertCampusInInstitution } from '../campuses/campuses.service';
import { programRepository } from '../programs/programs.repository';
import { classSectionRepository } from './class-sections.repository';

type ListQuery = PaginationQuery & {
  institutionId?: string;
  departmentId?: string;
  programId?: string;
  campusId?: string;
  academicYear?: string;
};

export const classSectionService = {
  list: async (query: ListQuery) =>
    classSectionRepository.list({
      ...toPageWindow(query),
      search: query.search,
      institutionId: query.institutionId,
      departmentId: query.departmentId,
      programId: query.programId,
      campusId: query.campusId,
      academicYear: query.academicYear,
      scope: await scopeWhere(currentPrincipal(), 'class_section.view', 'classSection'),
    }),

  async get(id: string) {
    const section = await classSectionRepository.findById(id);
    if (
      !section ||
      !(await can(
        currentPrincipal(),
        'class_section.view',
        hierarchyResource.classSection(section),
      ))
    ) {
      throw new NotFoundError('Class section');
    }
    return section;
  },

  async create(input: CreateClassSectionInput) {
    const program = await programRepository.findById(input.programId);
    if (!program) throw new InvalidReferenceError('programId', 'Program');
    await assertCampusInInstitution(input.campusId, program.institutionId);
    await authorize(currentPrincipal(), 'class_section.create', {
      institutionId: program.institutionId,
      departmentId: program.departmentId,
      campusId: input.campusId ?? null,
    });
    const section = await classSectionRepository.create({
      ...input,
      institutionId: program.institutionId,
      departmentId: program.departmentId,
    });
    await audit.record({
      action: 'class_section.create',
      entityType: 'class_section',
      entityId: section.id,
      after: section,
    });
    return section;
  },

  async update(id: string, input: UpdateClassSectionInput) {
    const before = await classSectionService.get(id);
    const principal = currentPrincipal();
    await authorize(principal, 'class_section.update', hierarchyResource.classSection(before));
    await assertCampusInInstitution(input.campusId, before.institutionId);
    const after = await classSectionRepository.update(id, input);
    await audit.record({
      action: 'class_section.update',
      entityType: 'class_section',
      entityId: id,
      before,
      after,
    });
    return after;
  },

  async remove(id: string) {
    const before = await classSectionService.get(id);
    await authorize(
      currentPrincipal(),
      'class_section.delete',
      hierarchyResource.classSection(before),
    );
    await classSectionRepository.softDelete(id);
    await audit.record({
      action: 'class_section.delete',
      entityType: 'class_section',
      entityId: id,
      before,
    });
  },
};

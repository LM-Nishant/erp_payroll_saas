import type {
  CreateClassSectionInput,
  PaginationQuery,
  UpdateClassSectionInput,
} from '@erp/shared';
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
  list: (query: ListQuery) =>
    classSectionRepository.list({
      ...toPageWindow(query),
      search: query.search,
      institutionId: query.institutionId,
      departmentId: query.departmentId,
      programId: query.programId,
      campusId: query.campusId,
      academicYear: query.academicYear,
    }),

  async get(id: string) {
    const section = await classSectionRepository.findById(id);
    if (!section) throw new NotFoundError('Class section');
    return section;
  },

  async create(input: CreateClassSectionInput) {
    const program = await programRepository.findById(input.programId);
    if (!program) throw new InvalidReferenceError('programId', 'Program');
    await assertCampusInInstitution(input.campusId, program.institutionId);
    return classSectionRepository.create({
      ...input,
      institutionId: program.institutionId,
      departmentId: program.departmentId,
    });
  },

  async update(id: string, input: UpdateClassSectionInput) {
    const existing = await classSectionService.get(id);
    await assertCampusInInstitution(input.campusId, existing.institutionId);
    return classSectionRepository.update(id, input);
  },

  async remove(id: string) {
    await classSectionService.get(id);
    await classSectionRepository.softDelete(id);
  },
};

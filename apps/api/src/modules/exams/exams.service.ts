import type { Prisma } from '@prisma/client';
import type {
  CreateExamTermInput,
  CreateGradingScaleInput,
  EnterMarksInput,
  ExamMarksSheetDto,
  ExamResultDto,
  ExamResultSubjectDto,
  ExamScheduleDto,
  ExamTermDto,
  GradeBand,
  GradingScaleDto,
  ListExamTermsQuery,
  OwnResultsDto,
  UpdateExamTermInput,
  UpsertExamSchedulesInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { authorize, can, currentPrincipal, hierarchyResource } from '../../core/authz';
import { emit } from '../../core/events';
import {
  AppError,
  ConflictError,
  InvalidReferenceError,
  NotFoundError,
} from '../../core/http/errors';
import { tenantDb, withTenant } from '../../core/tenancy';
import {
  accessibleInstitutionIds,
  assertSectionActor,
  dateOnly,
  guardianUserIds,
  institutionWhere,
  loadSection,
  loadVisibleSection,
  notifyUsers,
  ownStudents,
  sectionCoords,
  sectionResource,
  toDate,
} from '../academics/academics.access';
import { studentAttendanceService } from '../academics/attendance.service';
import {
  computeStudentResult,
  cumulativeGpa,
  DEFAULT_GRADE_BANDS,
  rankResults,
} from './exams.logic';

const db = () => tenantDb();
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? null : Number(d));

// ---------------------------------------------------------------- mappers

type TermRow = Prisma.ExamTermGetPayload<{
  include: { institution: { select: { id: true; name: true; code: true } } };
}>;

function toTermDto(t: TermRow, scheduleCount?: number): ExamTermDto {
  return {
    id: t.id,
    institutionId: t.institutionId,
    groupId: t.groupId,
    name: t.name,
    type: t.type,
    academicYear: t.academicYear,
    startDate: t.startDate ? dateOnly(t.startDate) : null,
    endDate: t.endDate ? dateOnly(t.endDate) : null,
    gradingScaleId: t.gradingScaleId,
    status: t.status,
    publishedAt: t.publishedAt?.toISOString() ?? null,
    institution: t.institution,
    ...(scheduleCount !== undefined ? { scheduleCount } : {}),
    createdAt: t.createdAt.toISOString(),
  };
}

const scheduleInclude = {
  subject: { select: { id: true, name: true, code: true } },
  classSection: { select: { id: true, name: true, code: true } },
  term: { select: { id: true, name: true } },
  _count: { select: { marks: true } },
} as const;
type ScheduleRow = Prisma.ExamScheduleGetPayload<{ include: typeof scheduleInclude }>;

function toScheduleDto(s: ScheduleRow): ExamScheduleDto {
  return {
    id: s.id,
    termId: s.termId,
    classSectionId: s.classSectionId,
    subjectId: s.subjectId,
    examDate: dateOnly(s.examDate),
    startTime: s.startTime,
    endTime: s.endTime,
    room: s.room,
    maxMarks: s.maxMarks,
    passMarks: s.passMarks,
    marksStatus: s.marksStatus,
    lockedAt: s.lockedAt?.toISOString() ?? null,
    subject: s.subject,
    classSection: s.classSection,
    term: s.term,
    marksEntered: s._count.marks,
  };
}

type ResultRow = Prisma.ExamResultGetPayload<{
  include: {
    student: { select: { id: true; displayName: true; rollNo: true; admissionNo: true } };
    term: { select: { id: true; name: true; type: true; academicYear: true } };
  };
}>;
const resultInclude = {
  student: { select: { id: true, displayName: true, rollNo: true, admissionNo: true } },
  term: { select: { id: true, name: true, type: true, academicYear: true } },
} as const;

function toResultDto(r: ResultRow): ExamResultDto {
  return {
    id: r.id,
    termId: r.termId,
    studentId: r.studentId,
    classSectionId: r.classSectionId,
    totalMarks: Number(r.totalMarks),
    maxTotal: Number(r.maxTotal),
    percentage: Number(r.percentage),
    grade: r.grade,
    gpa: num(r.gpa),
    rank: r.rank,
    passed: r.passed,
    subjects: r.subjects as unknown as ExamResultSubjectDto[],
    publishedAt: r.publishedAt?.toISOString() ?? null,
    student: r.student,
    term: r.term,
  };
}

function toScaleDto(s: {
  id: string;
  institutionId: string;
  name: string;
  bands: Prisma.JsonValue;
  isDefault: boolean;
}): GradingScaleDto {
  return {
    id: s.id,
    institutionId: s.institutionId,
    name: s.name,
    bands: s.bands as unknown as GradeBand[],
    isDefault: s.isDefault,
  };
}

// ---------------------------------------------------------------- loaders

async function loadInstitution(institutionId: string) {
  const inst = await db().institution.findUnique({ where: { id: institutionId } });
  if (!inst) throw new InvalidReferenceError('institutionId', 'Institution');
  return inst;
}

async function loadVisibleTerm(id: string, permission = 'exam.view') {
  const term = await db().examTerm.findUnique({
    where: { id },
    include: { institution: { select: { id: true, name: true, code: true } } },
  });
  const ids = term ? await accessibleInstitutionIds(permission) : [];
  if (!term || (ids !== undefined && !ids.includes(term.institutionId))) {
    throw new NotFoundError('Exam term');
  }
  return term;
}

const termResource = (t: { groupId: string | null; institutionId: string }) => ({
  groupId: t.groupId,
  institutionId: t.institutionId,
});

async function loadSchedule(id: string) {
  const s = await db().examSchedule.findUnique({ where: { id }, include: scheduleInclude });
  if (!s || !(await can(currentPrincipal(), 'exam.view', sectionResource(s)))) {
    // teachers hold exam.marks_entry (not always exam.view) over their sections
    if (!s || !(await can(currentPrincipal(), 'exam.marks_entry', sectionResource(s)))) {
      throw new NotFoundError('Exam schedule');
    }
  }
  return s;
}

async function bandsFor(term: { gradingScaleId: string | null; institutionId: string }) {
  const scale = term.gradingScaleId
    ? await db().gradingScale.findUnique({ where: { id: term.gradingScaleId } })
    : await db().gradingScale.findFirst({
        where: { institutionId: term.institutionId, isDefault: true },
      });
  return scale ? (scale.bands as unknown as GradeBand[]) : DEFAULT_GRADE_BANDS;
}

function assertTermEditable(term: { status: string }) {
  if (term.status === 'PUBLISHED') {
    throw new ConflictError('Results of this exam term are already published');
  }
}

// ---------------------------------------------------------------- grading scales

export const gradingScaleService = {
  async list(institutionId?: string) {
    const rows = await db().gradingScale.findMany({
      where: {
        ...(await institutionWhere('exam.view')),
        ...(institutionId ? { institutionId } : {}),
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toScaleDto);
  },

  async create(input: CreateGradingScaleInput) {
    const inst = await loadInstitution(input.institutionId);
    await authorize(currentPrincipal(), 'exam.manage', hierarchyResource.institution(inst));
    const row = await db().$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.gradingScale.updateMany({
          where: { institutionId: inst.id, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.gradingScale.create({
        data: withTenant({
          groupId: inst.groupId,
          institutionId: inst.id,
          name: input.name,
          bands: [...input.bands].sort((a, b) => b.minPercent - a.minPercent),
          isDefault: input.isDefault,
        }),
      });
    });
    await audit.record({
      action: 'grading_scale.create',
      entityType: 'grading_scale',
      entityId: row.id,
      after: input,
    });
    return toScaleDto(row);
  },

  async remove(id: string) {
    const row = await db().gradingScale.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('Grading scale');
    await authorize(currentPrincipal(), 'exam.manage', termResource(row));
    if (await db().examTerm.count({ where: { gradingScaleId: id } })) {
      throw new ConflictError('Grading scale is used by exam terms');
    }
    await db().gradingScale.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit.record({
      action: 'grading_scale.delete',
      entityType: 'grading_scale',
      entityId: id,
      before: toScaleDto(row),
    });
  },
};

// ---------------------------------------------------------------- terms

export const examTermService = {
  async list(query: ListExamTermsQuery) {
    const where: Prisma.ExamTermWhereInput = {
      ...(await institutionWhere('exam.view')),
      ...(query.institutionId ? { institutionId: query.institutionId } : {}),
      ...(query.academicYear ? { academicYear: query.academicYear } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { name: { contains: query.search } } : {}),
    };
    const [total, rows] = await Promise.all([
      db().examTerm.count({ where }),
      db().examTerm.findMany({
        where,
        include: {
          institution: { select: { id: true, name: true, code: true } },
          _count: { select: { schedules: true } },
        },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map((r) => toTermDto(r, r._count.schedules)), total };
  },

  async get(id: string) {
    const t = await loadVisibleTerm(id);
    return toTermDto(t, await db().examSchedule.count({ where: { termId: id } }));
  },

  async create(input: CreateExamTermInput) {
    const inst = await loadInstitution(input.institutionId);
    await authorize(currentPrincipal(), 'exam.manage', hierarchyResource.institution(inst));
    if (input.gradingScaleId) {
      const scale = await db().gradingScale.findUnique({ where: { id: input.gradingScaleId } });
      if (!scale || scale.institutionId !== inst.id) {
        throw new InvalidReferenceError('gradingScaleId', 'Grading scale');
      }
    }
    const row = await db().examTerm.create({
      data: withTenant({
        groupId: inst.groupId,
        institutionId: inst.id,
        name: input.name,
        type: input.type,
        academicYear: input.academicYear,
        startDate: input.startDate ? toDate(input.startDate) : null,
        endDate: input.endDate ? toDate(input.endDate) : null,
        gradingScaleId: input.gradingScaleId ?? null,
      }),
      include: { institution: { select: { id: true, name: true, code: true } } },
    });
    await audit.record({
      action: 'exam_term.create',
      entityType: 'exam_term',
      entityId: row.id,
      after: input,
    });
    await emit('exam.term_created', { termId: row.id }, { institutionId: inst.id });
    return toTermDto(row, 0);
  },

  async update(id: string, input: UpdateExamTermInput) {
    const term = await loadVisibleTerm(id);
    await authorize(currentPrincipal(), 'exam.manage', termResource(term));
    assertTermEditable(term);
    if (input.gradingScaleId) {
      const scale = await db().gradingScale.findUnique({ where: { id: input.gradingScaleId } });
      if (!scale || scale.institutionId !== term.institutionId) {
        throw new InvalidReferenceError('gradingScaleId', 'Grading scale');
      }
    }
    const row = await db().examTerm.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.startDate !== undefined
          ? { startDate: input.startDate ? toDate(input.startDate) : null }
          : {}),
        ...(input.endDate !== undefined
          ? { endDate: input.endDate ? toDate(input.endDate) : null }
          : {}),
        ...(input.gradingScaleId !== undefined ? { gradingScaleId: input.gradingScaleId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      include: { institution: { select: { id: true, name: true, code: true } } },
    });
    await audit.record({
      action: 'exam_term.update',
      entityType: 'exam_term',
      entityId: id,
      before: toTermDto(term),
      after: toTermDto(row),
    });
    return toTermDto(row);
  },

  async remove(id: string) {
    const term = await loadVisibleTerm(id);
    await authorize(currentPrincipal(), 'exam.manage', termResource(term));
    const marks = await db().examMark.count({ where: { schedule: { termId: id } } });
    if (marks > 0) throw new ConflictError('Exam term has marks entered');
    await db().$transaction(async (tx) => {
      await tx.examSchedule.deleteMany({ where: { termId: id } });
      await tx.examTerm.update({ where: { id }, data: { deletedAt: new Date() } });
    });
    await audit.record({
      action: 'exam_term.delete',
      entityType: 'exam_term',
      entityId: id,
      before: toTermDto(term),
    });
  },

  // -------------------------------------------------------------- schedules

  async schedules(termId: string, query: { classSectionId?: string; mine?: 'true' | 'false' }) {
    const term = await db().examTerm.findUnique({ where: { id: termId } });
    if (!term) throw new NotFoundError('Exam term');
    const principal = currentPrincipal();
    const rows = await db().examSchedule.findMany({
      where: { termId, ...(query.classSectionId ? { classSectionId: query.classSectionId } : {}) },
      include: scheduleInclude,
      orderBy: [{ examDate: 'asc' }, { startTime: 'asc' }],
    });
    const out: ExamScheduleDto[] = [];
    const allocations =
      query.mine === 'true' && principal.userId
        ? await db().subjectAllocation.findMany({
            where: { teacherUserId: principal.userId },
            select: { classSectionId: true, subjectId: true },
          })
        : [];
    for (const r of rows) {
      const res = sectionResource(r);
      if (query.mine === 'true') {
        const manager = await can(principal, 'exam.manage', res);
        const allocated = allocations.some(
          (a) => a.classSectionId === r.classSectionId && a.subjectId === r.subjectId,
        );
        if (!manager && !(allocated && (await can(principal, 'exam.marks_entry', res)))) continue;
      } else if (!(await can(principal, 'exam.view', res))) {
        continue;
      }
      out.push(toScheduleDto(r));
    }
    if (out.length === 0 && !query.mine) await loadVisibleTerm(termId);
    return out;
  },

  /** Upsert papers by (term, section, subject). */
  async upsertSchedules(termId: string, input: UpsertExamSchedulesInput) {
    const term = await loadVisibleTerm(termId);
    await authorize(currentPrincipal(), 'exam.manage', termResource(term));
    assertTermEditable(term);
    const sections = new Map<string, Awaited<ReturnType<typeof loadSection>>>();
    for (const s of input.schedules) {
      if (!sections.has(s.classSectionId)) {
        const cs = await loadSection(s.classSectionId, 'schedules.classSectionId');
        if (cs.institutionId !== term.institutionId) {
          throw new InvalidReferenceError(
            'schedules.classSectionId',
            'Class section (of the term institution)',
          );
        }
        sections.set(cs.id, cs);
      }
    }
    const subjects = await db().subject.findMany({
      where: { id: { in: [...new Set(input.schedules.map((s) => s.subjectId))] } },
    });
    const subjectById = new Map(subjects.map((s) => [s.id, s]));
    const ids: string[] = [];
    await db().$transaction(async (tx) => {
      for (const s of input.schedules) {
        const cs = sections.get(s.classSectionId)!;
        const subject = subjectById.get(s.subjectId);
        if (!subject || subject.programId !== cs.programId) {
          throw new InvalidReferenceError(
            'schedules.subjectId',
            'Subject (of the section program)',
          );
        }
        const maxMarks = s.maxMarks ?? subject.maxMarks;
        const passMarks = s.passMarks ?? Math.min(subject.passMarks, maxMarks);
        if (passMarks > maxMarks) {
          throw new AppError(422, 'INVALID_MARKS', 'Pass marks cannot exceed max marks');
        }
        const data = {
          examDate: toDate(s.examDate),
          startTime: s.startTime ?? null,
          endTime: s.endTime ?? null,
          room: s.room ?? null,
          maxMarks,
          passMarks,
        };
        const existing = await tx.examSchedule.findFirst({
          where: { termId, classSectionId: cs.id, subjectId: subject.id },
        });
        if (existing) {
          if (
            existing.marksStatus === 'LOCKED' &&
            (existing.maxMarks !== maxMarks || existing.passMarks !== passMarks)
          ) {
            throw new ConflictError('Marks are locked for this paper');
          }
          await tx.examSchedule.update({ where: { id: existing.id }, data });
          ids.push(existing.id);
        } else {
          const row = await tx.examSchedule.create({
            data: withTenant({
              ...sectionCoords(cs),
              termId,
              classSectionId: cs.id,
              subjectId: subject.id,
              ...data,
            }),
          });
          ids.push(row.id);
        }
      }
      if (term.status === 'DRAFT') {
        await tx.examTerm.update({ where: { id: termId }, data: { status: 'SCHEDULED' } });
      }
    });
    await audit.record({
      action: 'exam_schedule.upsert',
      entityType: 'exam_term',
      entityId: termId,
      after: { count: input.schedules.length },
    });
    await emit(
      'exam.scheduled',
      { termId, papers: ids.length },
      { institutionId: term.institutionId },
    );
    const rows = await db().examSchedule.findMany({
      where: { id: { in: ids } },
      include: scheduleInclude,
      orderBy: [{ examDate: 'asc' }],
    });
    return rows.map(toScheduleDto);
  },

  async removeSchedule(scheduleId: string) {
    const s = await loadSchedule(scheduleId);
    await authorize(currentPrincipal(), 'exam.manage', sectionResource(s));
    if (s._count.marks > 0) throw new ConflictError('Marks have been entered for this paper');
    await db().examSchedule.delete({ where: { id: s.id } });
    await audit.record({
      action: 'exam_schedule.delete',
      entityType: 'exam_schedule',
      entityId: s.id,
      before: toScheduleDto(s),
    });
  },

  // -------------------------------------------------------------- marks

  async marksSheet(scheduleId: string): Promise<ExamMarksSheetDto> {
    const s = await loadSchedule(scheduleId);
    const cs = await loadSection(s.classSectionId);
    const { manager } = await assertSectionActor(cs, 'exam.marks_entry', 'exam.manage', {
      subjectId: s.subjectId,
    }).catch(async (err) => {
      // read-only viewers (exam.view) may still see the sheet
      if (await can(currentPrincipal(), 'exam.view', sectionResource(s))) return { manager: null };
      throw err;
    });
    const [students, marks, term] = await Promise.all([
      db().student.findMany({
        where: { classSectionId: s.classSectionId, status: 'ACTIVE' },
        select: { id: true, rollNo: true, displayName: true },
        orderBy: [{ rollNo: 'asc' }, { displayName: 'asc' }],
      }),
      db().examMark.findMany({ where: { scheduleId } }),
      db().examTerm.findUniqueOrThrow({ where: { id: s.termId } }),
    ]);
    const byStudent = new Map(marks.map((m) => [m.studentId, m]));
    return {
      schedule: toScheduleDto(s),
      editable: manager !== null && s.marksStatus === 'OPEN' && term.status !== 'PUBLISHED',
      rows: students.map((st) => {
        const m = byStudent.get(st.id);
        return {
          studentId: st.id,
          rollNo: st.rollNo,
          displayName: st.displayName,
          marks: num(m?.marks),
          isAbsent: m?.isAbsent ?? false,
          remarks: m?.remarks ?? null,
        };
      }),
    };
  },

  async enterMarks(scheduleId: string, input: EnterMarksInput) {
    const s = await loadSchedule(scheduleId);
    const cs = await loadSection(s.classSectionId);
    await assertSectionActor(cs, 'exam.marks_entry', 'exam.manage', { subjectId: s.subjectId });
    const term = await db().examTerm.findUniqueOrThrow({ where: { id: s.termId } });
    assertTermEditable(term);
    if (s.marksStatus === 'LOCKED') throw new ConflictError('Marks are locked for this paper');
    const studentIds = new Set(
      (
        await db().student.findMany({
          where: { classSectionId: s.classSectionId },
          select: { id: true },
        })
      ).map((x) => x.id),
    );
    for (const m of input.marks) {
      if (!studentIds.has(m.studentId)) {
        throw new InvalidReferenceError('marks.studentId', 'Student (of the section)');
      }
      if (m.marks !== null && m.marks > s.maxMarks) {
        throw new AppError(422, 'INVALID_MARKS', `Marks cannot exceed ${s.maxMarks}`, {
          studentId: m.studentId,
        });
      }
    }
    const userId = currentPrincipal().userId;
    await db().$transaction(async (tx) => {
      for (const m of input.marks) {
        const data = {
          marks: m.isAbsent ? null : m.marks,
          isAbsent: m.isAbsent,
          remarks: m.remarks ?? null,
          enteredByUserId: userId,
        };
        const existing = await tx.examMark.findFirst({
          where: { scheduleId, studentId: m.studentId },
        });
        if (existing) await tx.examMark.update({ where: { id: existing.id }, data });
        else {
          await tx.examMark.create({
            data: withTenant({
              institutionId: s.institutionId,
              classSectionId: s.classSectionId,
              scheduleId,
              studentId: m.studentId,
              ...data,
            }),
          });
        }
      }
      if (term.status === 'DRAFT' || term.status === 'SCHEDULED') {
        await tx.examTerm.update({ where: { id: term.id }, data: { status: 'MARKS_ENTRY' } });
      }
    });
    await audit.record({
      action: 'exam_marks.enter',
      entityType: 'exam_schedule',
      entityId: scheduleId,
      after: { count: input.marks.length },
    });
    return this.marksSheet(scheduleId);
  },

  async lockMarks(scheduleId: string, locked: boolean) {
    const s = await loadSchedule(scheduleId);
    const res = sectionResource(s);
    const principal = currentPrincipal();
    if (locked) {
      // the allocated teacher may submit (lock) their own paper; unlocking needs exam.publish
      if (!(await can(principal, 'exam.publish', res))) {
        const cs = await loadSection(s.classSectionId);
        await assertSectionActor(cs, 'exam.marks_entry', 'exam.manage', { subjectId: s.subjectId });
      }
    } else {
      await authorize(principal, 'exam.publish', res);
      const term = await db().examTerm.findUniqueOrThrow({ where: { id: s.termId } });
      assertTermEditable(term);
    }
    await db().examSchedule.update({
      where: { id: s.id },
      data: locked
        ? { marksStatus: 'LOCKED', lockedAt: new Date(), lockedByUserId: principal.userId }
        : { marksStatus: 'OPEN', lockedAt: null, lockedByUserId: null },
    });
    await audit.record({
      action: locked ? 'exam_marks.lock' : 'exam_marks.unlock',
      entityType: 'exam_schedule',
      entityId: s.id,
    });
    return toScheduleDto(await loadSchedule(s.id));
  },

  // -------------------------------------------------------------- results

  /** Compute (or recompute) results for every section of the term the caller manages. */
  async computeResults(termId: string, classSectionId?: string) {
    const term = await loadVisibleTerm(termId);
    assertTermEditable(term);
    const principal = currentPrincipal();
    const schedules = await db().examSchedule.findMany({
      where: { termId, ...(classSectionId ? { classSectionId } : {}) },
      include: { subject: true, marks: true },
    });
    const bySection = new Map<string, typeof schedules>();
    for (const s of schedules) {
      if (!(await can(principal, 'exam.manage', sectionResource(s)))) continue;
      bySection.set(s.classSectionId, [...(bySection.get(s.classSectionId) ?? []), s]);
    }
    if (bySection.size === 0) {
      throw new AppError(422, 'NOTHING_TO_COMPUTE', 'No exam papers to compute in your scope');
    }
    const bands = await bandsFor(term);
    let computed = 0;
    const now = new Date();
    for (const [sectionId, papers] of bySection) {
      const cs = await loadSection(sectionId);
      const students = await db().student.findMany({
        where: { classSectionId: sectionId, status: 'ACTIVE' },
        select: { id: true },
      });
      const results = students.map((st) => {
        const subjects = papers
          .sort((a, b) => a.subject.code.localeCompare(b.subject.code))
          .map((p) => {
            const m = p.marks.find((x) => x.studentId === st.id);
            return {
              subjectId: p.subjectId,
              code: p.subject.code,
              name: p.subject.name,
              maxMarks: p.maxMarks,
              passMarks: p.passMarks,
              credits: num(p.subject.credits),
              marks: num(m?.marks),
              isAbsent: m?.isAbsent ?? false,
            };
          });
        return { studentId: st.id, ...computeStudentResult(subjects, bands) };
      });
      const ranks = rankResults(results);
      await db().$transaction(async (tx) => {
        for (const [i, r] of results.entries()) {
          const data = {
            classSectionId: sectionId,
            totalMarks: r.totalMarks,
            maxTotal: r.maxTotal,
            percentage: r.percentage,
            grade: r.grade,
            gpa: r.gpa,
            rank: ranks[i] ?? null,
            passed: r.passed,
            subjects: r.subjects.map((x): ExamResultSubjectDto => ({
              subjectId: x.subjectId,
              code: x.code,
              name: x.name,
              maxMarks: x.maxMarks,
              passMarks: x.passMarks,
              marks: x.marks,
              isAbsent: x.isAbsent,
              grade: x.grade,
              passed: x.passed,
            })) as unknown as Prisma.InputJsonValue,
            computedAt: now,
          };
          const existing = await tx.examResult.findFirst({
            where: { termId, studentId: r.studentId },
          });
          if (existing) await tx.examResult.update({ where: { id: existing.id }, data });
          else {
            await tx.examResult.create({
              data: withTenant({
                ...sectionCoords(cs),
                termId,
                studentId: r.studentId,
                ...data,
              }),
            });
          }
        }
      });
      computed += results.length;
    }
    await db().examTerm.update({ where: { id: termId }, data: { status: 'RESULTS_COMPUTED' } });
    await audit.record({
      action: 'exam_results.compute',
      entityType: 'exam_term',
      entityId: termId,
      after: { sections: bySection.size, students: computed },
    });
    await emit(
      'exam.results_computed',
      { termId, sections: bySection.size, students: computed },
      { institutionId: term.institutionId },
    );
    return { sections: bySection.size, students: computed };
  },

  async publish(termId: string) {
    const term = await loadVisibleTerm(termId);
    await authorize(currentPrincipal(), 'exam.publish', termResource(term));
    if (term.status !== 'RESULTS_COMPUTED') {
      throw new AppError(409, 'RESULTS_NOT_COMPUTED', 'Compute results before publishing');
    }
    const open = await db().examSchedule.count({ where: { termId, marksStatus: 'OPEN' } });
    if (open > 0) {
      throw new AppError(409, 'MARKS_NOT_LOCKED', `${open} paper(s) still open for marks entry`);
    }
    const now = new Date();
    await db().$transaction(async (tx) => {
      await tx.examResult.updateMany({ where: { termId }, data: { publishedAt: now } });
      await tx.examTerm.update({
        where: { id: termId },
        data: { status: 'PUBLISHED', publishedAt: now },
      });
    });
    const results = await db().examResult.findMany({
      where: { termId },
      include: { student: { select: { id: true, userId: true } } },
    });
    const guardians = await guardianUserIds(results.map((r) => r.studentId));
    await notifyUsers(
      'exam.results_published',
      results.flatMap((r) => [r.student.userId, ...(guardians.get(r.studentId) ?? [])]),
      {
        title: `${term.name} results published`,
        body: `Results for ${term.name} (${term.academicYear}) are now available.`,
        link: '/portal/results',
        institutionId: term.institutionId,
        data: { termId },
      },
    );
    await audit.record({
      action: 'exam_results.publish',
      entityType: 'exam_term',
      entityId: termId,
      after: { students: results.length },
    });
    await emit(
      'exam.results_published',
      { termId, students: results.length },
      { institutionId: term.institutionId },
    );
    return this.get(termId);
  },

  async results(termId: string, classSectionId?: string) {
    await loadVisibleTerm(termId);
    if (classSectionId) await loadVisibleSection(classSectionId, 'exam.view');
    const rows = await db().examResult.findMany({
      where: { termId, ...(classSectionId ? { classSectionId } : {}) },
      include: resultInclude,
      orderBy: [{ classSectionId: 'asc' }, { rank: 'asc' }],
    });
    const principal = currentPrincipal();
    const out: ExamResultDto[] = [];
    for (const r of rows) {
      if (await can(principal, 'exam.view', sectionResource(r))) out.push(toResultDto(r));
    }
    return out;
  },

  /** Student / parent self-service: published results only. */
  async own(studentId?: string): Promise<OwnResultsDto> {
    const [student] = await ownStudents(studentId);
    const rows = await db().examResult.findMany({
      where: { studentId: student!.id, publishedAt: { not: null } },
      include: resultInclude,
      orderBy: [{ publishedAt: 'desc' }],
    });
    const results = rows.map(toResultDto);
    return {
      student: { id: student!.id, displayName: student!.displayName },
      results,
      cgpa: cumulativeGpa(results.map((r) => r.gpa)),
    };
  },

  /** Load a result for the report card: staff (exam.view) or own / ward (published only). */
  async reportCardData(termId: string, studentId: string) {
    const r = await db().examResult.findFirst({
      where: { termId, studentId },
      include: {
        ...resultInclude,
        student: {
          select: {
            id: true,
            displayName: true,
            rollNo: true,
            admissionNo: true,
            userId: true,
            classSection: { select: { name: true, code: true, academicYear: true } },
            program: { select: { name: true } },
          },
        },
        term: true,
      },
    });
    if (!r) throw new NotFoundError('Result');
    const principal = currentPrincipal();
    const staff = await can(principal, 'exam.view', sectionResource(r));
    if (!staff) {
      const own = await ownStudents(studentId).catch(() => []);
      if (!own.length || !r.publishedAt) throw new NotFoundError('Result');
    }
    const [institution, allPublished, attendance, classTeacher] = await Promise.all([
      db().institution.findUniqueOrThrow({ where: { id: r.institutionId } }),
      db().examResult.findMany({
        where: { studentId, publishedAt: { not: null } },
        select: { gpa: true, termId: true },
      }),
      studentAttendanceService.percentFor([studentId], null, r.term.endDate),
      db().classTeacherAssignment.findFirst({ where: { classSectionId: r.classSectionId } }),
    ]);
    const gpas = allPublished.map((x) => num(x.gpa));
    if (!allPublished.some((x) => x.termId === termId)) gpas.push(num(r.gpa));
    return {
      result: toResultDto(r as unknown as ResultRow),
      student: r.student,
      term: r.term,
      institution,
      cgpa: cumulativeGpa(gpas),
      attendancePercent: attendance.get(studentId) ?? null,
      classTeacherUserId: classTeacher?.teacherUserId ?? null,
      scope: {
        groupId: r.groupId,
        institutionId: r.institutionId,
        campusId: r.campusId,
        departmentId: r.departmentId,
      },
    };
  },
};

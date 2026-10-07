import { Router, type Request } from 'express';
import {
  attendanceRegisterQuerySchema,
  createSubjectSchema,
  idParamSchema,
  listAllocationsQuerySchema,
  listSubjectsQuerySchema,
  markStudentAttendanceSchema,
  ownAttendanceQuerySchema,
  sectionAttendanceQuerySchema,
  setClassTeacherSchema,
  teacherOptionsQuerySchema,
  updateSubjectSchema,
  upsertAllocationSchema,
} from '@erp/shared';
import { requirePermission } from '../../core/authz';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { requireAnyPermission } from './academics.access';
import { studentAttendanceService } from './attendance.service';
import { allocationService, subjectService } from './subjects.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

/* ---------------------------------------------------------------- subjects */

export const subjectsRouter = Router();

subjectsRouter.get('/', requirePermission('subject.view'), async (req, res) => {
  const query = parseInput(listSubjectsQuerySchema, req.query);
  const { items, total } = await subjectService.list(query);
  res.json(toListResponse(items, total, query));
});
subjectsRouter.post('/', requirePermission('subject.manage'), async (req, res) => {
  res
    .status(201)
    .json({ data: await subjectService.create(parseInput(createSubjectSchema, req.body)) });
});
subjectsRouter.get('/:id', requirePermission('subject.view'), async (req, res) => {
  res.json({ data: await subjectService.get(idOf(req)) });
});
subjectsRouter.patch('/:id', requirePermission('subject.manage'), async (req, res) => {
  res.json({
    data: await subjectService.update(idOf(req), parseInput(updateSubjectSchema, req.body)),
  });
});
subjectsRouter.delete('/:id', requirePermission('subject.manage'), async (req, res) => {
  await subjectService.remove(idOf(req));
  res.status(204).end();
});

/* ---------------------------------------------------------------- allocations */

export const allocationsRouter = Router();

allocationsRouter.get(
  '/my-classes',
  requireAnyPermission(['student_attendance.mark', 'exam.marks_entry', 'subject.view']),
  async (_req, res) => {
    res.json({ data: await allocationService.myClasses() });
  },
);
allocationsRouter.get(
  '/teacher-options',
  requireAnyPermission(['subject.manage', 'timetable.manage']),
  async (req, res) => {
    const q = parseInput(teacherOptionsQuerySchema, req.query);
    res.json({ data: await allocationService.teacherOptions(q.institutionId, q.q) });
  },
);
allocationsRouter.get('/class-teacher/:id', requirePermission('subject.view'), async (req, res) => {
  res.json({ data: await allocationService.classTeacher(idOf(req)) });
});
allocationsRouter.put('/class-teacher', requirePermission('subject.manage'), async (req, res) => {
  res.json({
    data: await allocationService.setClassTeacher(parseInput(setClassTeacherSchema, req.body)),
  });
});
allocationsRouter.get('/', requirePermission('subject.view'), async (req, res) => {
  const query = parseInput(listAllocationsQuerySchema, req.query);
  const { items, total } = await allocationService.list(query);
  res.json(toListResponse(items, total, query));
});
allocationsRouter.post('/', requirePermission('subject.manage'), async (req, res) => {
  res
    .status(201)
    .json({ data: await allocationService.upsert(parseInput(upsertAllocationSchema, req.body)) });
});
allocationsRouter.delete('/:id', requirePermission('subject.manage'), async (req, res) => {
  await allocationService.remove(idOf(req));
  res.status(204).end();
});

/* ---------------------------------------------------------------- student attendance */

export const studentAttendanceRouter = Router();

studentAttendanceRouter.get(
  '/me',
  requirePermission('student_attendance.view_own'),
  async (req, res) => {
    res.json({
      data: await studentAttendanceService.own(parseInput(ownAttendanceQuerySchema, req.query)),
    });
  },
);
studentAttendanceRouter.get(
  '/section',
  requirePermission('student_attendance.view'),
  async (req, res) => {
    res.json({
      data: await studentAttendanceService.sectionDay(
        parseInput(sectionAttendanceQuerySchema, req.query),
      ),
    });
  },
);
studentAttendanceRouter.get(
  '/register',
  requirePermission('student_attendance.view'),
  async (req, res) => {
    res.json({
      data: await studentAttendanceService.register(
        parseInput(attendanceRegisterQuerySchema, req.query),
      ),
    });
  },
);
studentAttendanceRouter.post(
  '/',
  requireAnyPermission(['student_attendance.mark', 'student_attendance.manage']),
  async (req, res) => {
    res.json({
      data: await studentAttendanceService.mark(parseInput(markStudentAttendanceSchema, req.body)),
    });
  },
);

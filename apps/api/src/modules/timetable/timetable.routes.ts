import { Router, type Request } from 'express';
import {
  createSubstitutionSchema,
  idParamSchema,
  institutionQuerySchema,
  listSubstitutionsQuerySchema,
  replaceBellScheduleSchema,
  replaceTimetableSchema,
  teacherTimetableQuerySchema,
  timetableViewQuerySchema,
} from '@erp/shared';
import { requirePermission } from '../../core/authz';
import { parseInput } from '../../core/http/validation';
import { requireAnyPermission } from '../academics/academics.access';
import { timetableService } from './timetable.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

export const timetableRouter = Router();

timetableRouter.get('/me', requirePermission('timetable.view_own'), async (req, res) => {
  const q = parseInput(timetableViewQuerySchema, req.query);
  res.json({ data: await timetableService.own(q.studentId, q.date) });
});
timetableRouter.get(
  '/teacher',
  requireAnyPermission(['timetable.view', 'student_attendance.mark', 'exam.marks_entry']),
  async (req, res) => {
    const q = parseInput(teacherTimetableQuerySchema, req.query);
    res.json({ data: await timetableService.teacher(q.teacherUserId, q.date) });
  },
);
timetableRouter.get('/periods', requirePermission('timetable.view'), async (req, res) => {
  const q = parseInput(institutionQuerySchema, req.query);
  res.json({ data: await timetableService.periods(q.institutionId) });
});
timetableRouter.put('/periods', requirePermission('timetable.manage'), async (req, res) => {
  res.json({
    data: await timetableService.replacePeriods(parseInput(replaceBellScheduleSchema, req.body)),
  });
});
timetableRouter.get('/clashes', requirePermission('timetable.view'), async (req, res) => {
  const q = parseInput(institutionQuerySchema, req.query);
  res.json({ data: await timetableService.clashes(q.institutionId) });
});
timetableRouter.get('/substitutions', requirePermission('timetable.view'), async (req, res) => {
  res.json({
    data: await timetableService.substitutions(parseInput(listSubstitutionsQuerySchema, req.query)),
  });
});
timetableRouter.post('/substitutions', requirePermission('timetable.manage'), async (req, res) => {
  res.status(201).json({
    data: await timetableService.createSubstitution(parseInput(createSubstitutionSchema, req.body)),
  });
});
timetableRouter.delete(
  '/substitutions/:id',
  requirePermission('timetable.manage'),
  async (req, res) => {
    await timetableService.removeSubstitution(idOf(req));
    res.status(204).end();
  },
);
timetableRouter.get('/sections/:id', requirePermission('timetable.view'), async (req, res) => {
  const q = parseInput(timetableViewQuerySchema.pick({ date: true }), req.query);
  res.json({ data: await timetableService.section(idOf(req), q.date) });
});
timetableRouter.put('/sections/:id', requirePermission('timetable.manage'), async (req, res) => {
  res.json({
    data: await timetableService.replaceSection(
      idOf(req),
      parseInput(replaceTimetableSchema, req.body),
    ),
  });
});

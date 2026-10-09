import { Router, type Request } from 'express';
import {
  addGuardianSchema,
  createAdmissionSchema,
  createStudentSchema,
  enrollAdmissionSchema,
  idParamSchema,
  lifecycleStudentSchema,
  linkUserSchema,
  listAdmissionsQuerySchema,
  listStudentsQuerySchema,
  promoteStudentsSchema,
  transitionAdmissionSchema,
  updateAdmissionSchema,
  updateStudentSchema,
} from '@erp/shared';
import { requirePermission } from '../../core/authz';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { admissionsService } from './admissions.service';
import { studentService } from './students.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

export const studentsRouter = Router();

studentsRouter.get('/me', requirePermission('student.view_own'), async (_req, res) => {
  res.json({ data: await studentService.me() });
});
studentsRouter.get('/my-wards', requirePermission('ward.view'), async (_req, res) => {
  res.json({ data: await studentService.myWards() });
});
studentsRouter.get('/my-wards/:id', requirePermission('ward.view'), async (req, res) => {
  res.json({ data: await studentService.myWard(idOf(req)) });
});
studentsRouter.get('/stats', requirePermission('student.view'), async (_req, res) => {
  res.json({ data: await studentService.stats() });
});
studentsRouter.post('/promotions', requirePermission('student.lifecycle'), async (req, res) => {
  res.json({ data: await studentService.promote(parseInput(promoteStudentsSchema, req.body)) });
});
studentsRouter.get('/', requirePermission('student.view'), async (req, res) => {
  const query = parseInput(listStudentsQuerySchema, req.query);
  const { items, total } = await studentService.list(query);
  res.json(toListResponse(items, total, query));
});
studentsRouter.post('/', requirePermission('student.create'), async (req, res) => {
  res
    .status(201)
    .json({ data: await studentService.create(parseInput(createStudentSchema, req.body)) });
});
studentsRouter.get('/:id', requirePermission('student.view'), async (req, res) => {
  res.json({ data: await studentService.get(idOf(req)) });
});
studentsRouter.patch('/:id', requirePermission('student.update'), async (req, res) => {
  res.json({
    data: await studentService.update(idOf(req), parseInput(updateStudentSchema, req.body)),
  });
});
studentsRouter.delete('/:id', requirePermission('student.delete'), async (req, res) => {
  await studentService.remove(idOf(req));
  res.status(204).end();
});
studentsRouter.post('/:id/guardians', requirePermission('guardian.manage'), async (req, res) => {
  res.status(201).json({
    data: await studentService.addGuardian(idOf(req), parseInput(addGuardianSchema, req.body)),
  });
});
studentsRouter.patch('/:id/login', requirePermission('student.update'), async (req, res) => {
  res.json({
    data: await studentService.linkUser(idOf(req), parseInput(linkUserSchema, req.body)),
  });
});
studentsRouter.patch(
  '/guardians/:id/login',
  requirePermission('guardian.manage'),
  async (req, res) => {
    res.json({
      data: await studentService.linkGuardianUser(idOf(req), parseInput(linkUserSchema, req.body)),
    });
  },
);
studentsRouter.get('/:id/enrollments', requirePermission('student.view'), async (req, res) => {
  res.json({ data: await studentService.enrollments(idOf(req)) });
});
studentsRouter.post('/:id/withdraw', requirePermission('student.lifecycle'), async (req, res) => {
  res.json({
    data: await studentService.lifecycle(
      idOf(req),
      'withdrawn',
      parseInput(lifecycleStudentSchema, req.body),
    ),
  });
});
studentsRouter.post('/:id/graduate', requirePermission('student.lifecycle'), async (req, res) => {
  res.json({
    data: await studentService.lifecycle(
      idOf(req),
      'graduated',
      parseInput(lifecycleStudentSchema, req.body),
    ),
  });
});

export const admissionsRouter = Router();
admissionsRouter.get('/', requirePermission('admission.view'), async (req, res) => {
  const query = parseInput(listAdmissionsQuerySchema, req.query);
  const { items, total } = await admissionsService.list(query);
  res.json(toListResponse(items, total, query));
});
admissionsRouter.post('/', requirePermission('admission.manage'), async (req, res) => {
  res
    .status(201)
    .json({ data: await admissionsService.create(parseInput(createAdmissionSchema, req.body)) });
});
admissionsRouter.get('/:id', requirePermission('admission.view'), async (req, res) => {
  res.json({ data: await admissionsService.get(idOf(req)) });
});
admissionsRouter.patch('/:id', requirePermission('admission.manage'), async (req, res) => {
  res.json({
    data: await admissionsService.update(idOf(req), parseInput(updateAdmissionSchema, req.body)),
  });
});
admissionsRouter.post(
  '/:id/transition',
  requirePermission('admission.manage'),
  async (req, res) => {
    res.json({
      data: await admissionsService.transition(
        idOf(req),
        parseInput(transitionAdmissionSchema, req.body),
      ),
    });
  },
);
admissionsRouter.delete('/:id', requirePermission('admission.manage'), async (req, res) => {
  await admissionsService.remove(idOf(req));
  res.status(204).end();
});
admissionsRouter.post('/:id/enroll', requirePermission('admission.manage'), async (req, res) => {
  res.status(201).json({
    data: await admissionsService.enroll(idOf(req), parseInput(enrollAdmissionSchema, req.body)),
  });
});

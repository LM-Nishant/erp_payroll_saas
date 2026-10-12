import { Router, type Request, type Response } from 'express';
import {
  addGuardianSchema,
  cancelCertificateSchema,
  certificateEligibilityQuerySchema,
  createAdmissionSchema,
  createStudentSchema,
  enrollAdmissionSchema,
  idParamSchema,
  issueCertificateSchema,
  lifecycleStudentSchema,
  linkUserSchema,
  listAdmissionsQuerySchema,
  listStudentsQuerySchema,
  previousSchoolInputSchema,
  promoteStudentsSchema,
  reissueCertificateSchema,
  transitionAdmissionSchema,
  updateAdmissionSchema,
  updatePreviousSchoolSchema,
  updateStudentSchema,
} from '@erp/shared';
import { requireAnyPermission, requirePermission } from '../../core/authz';
import { env } from '../../core/config/env';
import { parseMultipartFile } from '../../core/http/multipart';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { admissionsService } from './admissions.service';
import { certificateService } from './certificates.service';
import { previousSchoolService } from './previous-schools.service';
import { studentService } from './students.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

const sendFile = (
  res: Response,
  file: { body: Buffer; fileName: string; mimeType?: string },
  inline = false,
) => {
  res.setHeader('Content-Type', file.mimeType ?? 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${file.fileName.replace(/"/g, '')}"`,
  );
  res.send(file.body);
};

export const studentsRouter = Router();

studentsRouter.get('/me', requirePermission('student.view_own'), async (_req, res) => {
  res.json({ data: await studentService.me() });
});
studentsRouter.get('/my-wards', requirePermission('ward.view'), async (_req, res) => {
  res.json({ data: await studentService.myWards() });
});
studentsRouter.get(
  '/me/certificates',
  requirePermission('certificate.view_own'),
  async (_req, res) => {
    res.json({ data: await certificateService.mine() });
  },
);
studentsRouter.get(
  '/my-wards/certificates',
  requirePermission('certificate.view_own'),
  async (_req, res) => {
    res.json({ data: await certificateService.forMyWards() });
  },
);
studentsRouter.get('/my-wards/:id', requirePermission('ward.view'), async (req, res) => {
  res.json({ data: await studentService.myWard(idOf(req)) });
});
studentsRouter.get(
  '/my-wards/:id/certificates',
  requirePermission('certificate.view_own'),
  async (req, res) => {
    res.json({ data: await certificateService.forMyWards(idOf(req)) });
  },
);

/* ---- Previous-school records (by record id) ---- */
studentsRouter.patch(
  '/previous-schools/:id',
  requireAnyPermission(['student.update', 'admission.manage']),
  async (req, res) => {
    res.json({
      data: await previousSchoolService.update(
        idOf(req),
        parseInput(updatePreviousSchoolSchema, req.body),
      ),
    });
  },
);
studentsRouter.delete(
  '/previous-schools/:id',
  requireAnyPermission(['student.update', 'admission.manage']),
  async (req, res) => {
    await previousSchoolService.remove(idOf(req));
    res.status(204).end();
  },
);
studentsRouter.post(
  '/previous-schools/:id/tc-file',
  requireAnyPermission(['student.update', 'admission.manage']),
  async (req, res) => {
    const { file } = await parseMultipartFile(req, { maxBytes: env.STORAGE_MAX_UPLOAD_BYTES });
    res.json({ data: await previousSchoolService.uploadTc(idOf(req), file) });
  },
);
studentsRouter.get(
  '/previous-schools/:id/tc-file',
  requireAnyPermission(['student.view', 'admission.view']),
  async (req, res) => {
    sendFile(res, await previousSchoolService.downloadTc(idOf(req)));
  },
);

/* ---- Certificates (by certificate id) ---- */
studentsRouter.post(
  '/certificates/:id/cancel',
  requirePermission('certificate.cancel'),
  async (req, res) => {
    res.json({
      data: await certificateService.cancel(
        idOf(req),
        parseInput(cancelCertificateSchema, req.body),
      ),
    });
  },
);
studentsRouter.post(
  '/certificates/:id/reissue',
  requirePermission('certificate.issue'),
  async (req, res) => {
    res.status(201).json({
      data: await certificateService.reissue(
        idOf(req),
        parseInput(reissueCertificateSchema, req.body),
      ),
    });
  },
);
studentsRouter.get(
  '/certificates/:id/pdf',
  requireAnyPermission(['certificate.view', 'certificate.view_own']),
  async (req, res) => {
    sendFile(res, await certificateService.pdf(idOf(req)));
  },
);
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
studentsRouter.get('/:id/previous-schools', requirePermission('student.view'), async (req, res) => {
  res.json({ data: await previousSchoolService.listForStudent(idOf(req)) });
});
studentsRouter.post(
  '/:id/previous-schools',
  requirePermission('student.update'),
  async (req, res) => {
    res.status(201).json({
      data: await previousSchoolService.createForStudent(
        idOf(req),
        parseInput(previousSchoolInputSchema, req.body),
      ),
    });
  },
);
studentsRouter.get('/:id/certificates', requirePermission('certificate.view'), async (req, res) => {
  res.json({ data: await certificateService.listForStudent(idOf(req)) });
});
studentsRouter.get(
  '/:id/certificates/eligibility',
  requirePermission('certificate.view'),
  async (req, res) => {
    const { type } = parseInput(certificateEligibilityQuerySchema, req.query);
    res.json({ data: await certificateService.eligibility(idOf(req), type) });
  },
);
studentsRouter.post(
  '/:id/certificates',
  requirePermission('certificate.issue'),
  async (req, res) => {
    res.status(201).json({
      data: await certificateService.issue(idOf(req), parseInput(issueCertificateSchema, req.body)),
    });
  },
);
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
admissionsRouter.get(
  '/:id/previous-schools',
  requirePermission('admission.view'),
  async (req, res) => {
    res.json({ data: await previousSchoolService.listForAdmission(idOf(req)) });
  },
);
admissionsRouter.post(
  '/:id/previous-schools',
  requirePermission('admission.manage'),
  async (req, res) => {
    res.status(201).json({
      data: await previousSchoolService.createForAdmission(
        idOf(req),
        parseInput(previousSchoolInputSchema, req.body),
      ),
    });
  },
);
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

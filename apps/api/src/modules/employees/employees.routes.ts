import {
  activateEmployeeSchema,
  confirmEmployeeSchema,
  createChecklistItemSchema,
  createDesignationSchema,
  createEmployeeTypeSchema,
  createEmployeeMovementSchema,
  createEmployeeSchema,
  createProfileChangeRequestSchema,
  createSalaryRevisionSchema,
  employeeChecklistParamsSchema,
  employeeImportJobParamsSchema,
  employeeImportOptionsSchema,
  employeeLetterSchema,
  employeeMovementParamsSchema,
  exitEmployeeSchema,
  exportEmployeesQuerySchema,
  idParamSchema,
  listDesignationsQuerySchema,
  listEmployeeTypesQuerySchema,
  listEmployeesQuerySchema,
  onboardEmployeeSchema,
  rehireEmployeeSchema,
  resignEmployeeSchema,
  revealEmployeeSensitiveSchema,
  updateChecklistItemSchema,
  updateDesignationSchema,
  updateEmployeeTypeSchema,
  updateEmployeeProfileSchema,
  updateEmployeeSchema,
  upsertEmployeeCodeSequenceSchema,
  withdrawResignationSchema,
} from '@erp/shared';
import { Router, type Request } from 'express';
import { employeeHighlights } from './employees.highlights';
import type { z } from 'zod';
import { requirePermission } from '../../core/authz';
import { parseMultipartFile } from '../../core/http/multipart';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { designationService } from './designations.service';
import { employeeTypeService } from './employee-types.service';
import { parseDescriptorField, PHOTO_MAX_BYTES, photoService } from './employees.photo';
import { importService } from './employees.import';
import { generateEmployeeLetter, LETTER_TEMPLATES } from './employees.letters';
import { lifecycleService } from './employees.lifecycle';
import { movementService } from './employees.movements';
import { salaryService } from './employees.salary';
import { selfService } from './employees.self-service';
import { employeeService } from './employees.service';

/**
 * /api/v1/employees — HR employee master (Layer 6). Mounted behind `requireFeature('hr')`.
 * `requirePermission` is the coarse guard; every service call re-checks scope against the
 * employee's CURRENT assignment (group / institution / campus / department).
 */
export const employeesRouter = Router();
const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/* ---- self-service (before /:id) ---- */
employeesRouter.get('/highlights', async (_req, res) => {
  res.json({ data: await employeeHighlights() });
});
employeesRouter.get('/me', requirePermission('employee.view_own'), async (_req, res) => {
  res.json({ data: await selfService.me() });
});
employeesRouter.post('/me/photo', requirePermission('employee.update_own'), async (req, res) => {
  const { file, fields } = await parseMultipartFile(req, {
    maxBytes: PHOTO_MAX_BYTES,
    maxFields: 2,
  });
  const descriptor = parseDescriptorField(fields.faceDescriptor);
  res.status(201).json({ data: await photoService.uploadOwn(file, descriptor) });
});
employeesRouter.get('/me/photo-url', requirePermission('employee.view_own'), async (_req, res) => {
  res.json({ data: await photoService.ownUrl() });
});
employeesRouter.get('/me/face', requirePermission('employee.view_own'), async (_req, res) => {
  res.json({ data: await photoService.ownFace() });
});
employeesRouter.post(
  '/me/change-requests',
  requirePermission('employee.update_own'),
  async (req, res) => {
    const input = parseInput(createProfileChangeRequestSchema, req.body);
    res.status(201).json({ data: await selfService.requestChange(input) });
  },
);

/* ---- list / export / import / numbering ---- */
employeesRouter.get('/', requirePermission('employee.view'), async (req, res) => {
  const query = parseInput(listEmployeesQuerySchema, req.query);
  const { items, total } = await employeeService.list(query);
  res.json(toListResponse(items, total, query));
});
employeesRouter.get('/export', requirePermission('employee.export'), async (req, res) => {
  const query = parseInput(exportEmployeesQuerySchema, req.query);
  const csv = await importService.exportCsv(query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="employees.csv"');
  res.send(csv);
});
employeesRouter.get('/import/template', requirePermission('employee.import'), (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="employee-import-template.csv"');
  res.send(importService.template());
});
employeesRouter.get('/import', requirePermission('employee.import'), async (_req, res) => {
  res.json({ data: await importService.list() });
});
employeesRouter.post('/import', requirePermission('employee.import'), async (req, res) => {
  const { file, fields } = await parseMultipartFile(req, {
    maxBytes: IMPORT_MAX_BYTES,
    maxFields: 2,
  });
  const { dryRun } = parseInput(employeeImportOptionsSchema, fields);
  res.status(202).json({ data: await importService.start(file, dryRun) });
});
employeesRouter.get('/import/:jobId', requirePermission('employee.import'), async (req, res) => {
  const { jobId } = parseInput(employeeImportJobParamsSchema, req.params);
  res.json({ data: await importService.get(jobId) });
});
employeesRouter.get('/code-sequences', requirePermission('employee.create'), async (_req, res) => {
  res.json({ data: await employeeService.listCodeSequences() });
});
employeesRouter.put(
  '/code-sequences',
  requirePermission('designation.manage'),
  async (req, res) => {
    const input = parseInput(upsertEmployeeCodeSequenceSchema, req.body);
    res.json({ data: await employeeService.upsertCodeSequence(input) });
  },
);
employeesRouter.get('/letter-templates', requirePermission('employee.view'), (_req, res) => {
  res.json({
    data: Object.entries(LETTER_TEMPLATES).map(([type, templateKey]) => ({ type, templateKey })),
  });
});

/* ---- CRUD ---- */
employeesRouter.post('/', requirePermission('employee.create'), async (req, res) => {
  const input = parseInput(createEmployeeSchema, req.body);
  res.status(201).json({ data: await employeeService.create(input) });
});
employeesRouter.get('/:id', requirePermission('employee.view'), async (req, res) => {
  res.json({ data: await employeeService.get(idOf(req)) });
});
employeesRouter.patch('/:id', requirePermission('employee.update'), async (req, res) => {
  const input = parseInput(updateEmployeeSchema, req.body);
  res.json({ data: await employeeService.update(idOf(req), input) });
});
employeesRouter.delete('/:id', requirePermission('employee.delete'), async (req, res) => {
  await employeeService.remove(idOf(req));
  res.status(204).end();
});
employeesRouter.put('/:id/profile', requirePermission('employee.update'), async (req, res) => {
  const input = parseInput(updateEmployeeProfileSchema, req.body);
  res.json({ data: await employeeService.updateProfile(idOf(req), input) });
});
employeesRouter.post(
  '/:id/sensitive/reveal',
  requirePermission('employee.view_sensitive'),
  async (req, res) => {
    const { reason } = parseInput(revealEmployeeSensitiveSchema, req.body ?? {});
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: await employeeService.revealSensitive(idOf(req), reason) });
  },
);
employeesRouter.get('/:id/history', requirePermission('employee.view'), async (req, res) => {
  res.json({ data: await employeeService.history(idOf(req)) });
});

/* ---- movements ---- */
employeesRouter.get('/:id/movements', requirePermission('employee.view'), async (req, res) => {
  res.json({ data: await movementService.list(idOf(req)) });
});
employeesRouter.post('/:id/movements', requirePermission('employee.transfer'), async (req, res) => {
  const input = parseInput(createEmployeeMovementSchema, req.body);
  res.status(201).json({ data: await movementService.request(idOf(req), input) });
});
employeesRouter.post(
  '/:id/movements/:movementId/cancel',
  requirePermission('employee.transfer'),
  async (req, res) => {
    const { id, movementId } = parseInput(employeeMovementParamsSchema, req.params);
    res.json({ data: await movementService.cancel(id, movementId) });
  },
);

/* ---- salary history ---- */
employeesRouter.get('/:id/salary', requirePermission('salary.view'), async (req, res) => {
  res.json({ data: await salaryService.list(idOf(req)) });
});
employeesRouter.post('/:id/salary', requirePermission('salary.update'), async (req, res) => {
  const input = parseInput(createSalaryRevisionSchema, req.body);
  res.status(201).json({ data: await salaryService.revise(idOf(req), input) });
});

/* ---- lifecycle ---- */
employeesRouter.get('/:id/checklist', requirePermission('employee.view'), async (req, res) => {
  res.json({ data: await lifecycleService.checklist(idOf(req)) });
});
employeesRouter.post(
  '/:id/checklist',
  requirePermission('employee.lifecycle'),
  async (req, res) => {
    const input = parseInput(createChecklistItemSchema, req.body);
    res.status(201).json({ data: await lifecycleService.addChecklistItem(idOf(req), input) });
  },
);
employeesRouter.patch(
  '/:id/checklist/:itemId',
  requirePermission('employee.lifecycle'),
  async (req, res) => {
    const { id, itemId } = parseInput(employeeChecklistParamsSchema, req.params);
    const input = parseInput(updateChecklistItemSchema, req.body);
    res.json({ data: await lifecycleService.updateChecklistItem(id, itemId, input) });
  },
);

const lifecycleRoute = <S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  run: (id: string, input: z.output<S>) => Promise<string>,
) =>
  employeesRouter.post(
    `/:id/${path}`,
    requirePermission('employee.lifecycle'),
    async (req, res) => {
      const input = parseInput(schema, req.body ?? {});
      const id = await run(idOf(req), input);
      res.json({ data: await employeeService.get(id) });
    },
  );
lifecycleRoute('onboard', onboardEmployeeSchema, lifecycleService.onboard);
lifecycleRoute('activate', activateEmployeeSchema, lifecycleService.activate);
lifecycleRoute('confirm', confirmEmployeeSchema, lifecycleService.confirm);
lifecycleRoute('resign', resignEmployeeSchema, lifecycleService.resign);
lifecycleRoute(
  'withdraw-resignation',
  withdrawResignationSchema,
  lifecycleService.withdrawResignation,
);
lifecycleRoute('exit', exitEmployeeSchema, lifecycleService.exit);
lifecycleRoute('rehire', rehireEmployeeSchema, lifecycleService.rehire);

/* ---- letters / self-service change requests (HR view) ---- */
employeesRouter.post('/:id/letters', requirePermission('employee.view'), async (req, res) => {
  const input = parseInput(employeeLetterSchema, req.body);
  res.status(201).json({ data: await generateEmployeeLetter(idOf(req), input) });
});
employeesRouter.get(
  '/:id/change-requests',
  requirePermission('employee.view'),
  async (req, res) => {
    res.json({ data: await selfService.listFor(idOf(req)) });
  },
);

employeesRouter.post('/:id/photo', requirePermission('employee.update'), async (req, res) => {
  const { file, fields } = await parseMultipartFile(req, {
    maxBytes: PHOTO_MAX_BYTES,
    maxFields: 2,
  });
  const descriptor = parseDescriptorField(fields.faceDescriptor);
  res.status(201).json({ data: await photoService.upload(idOf(req), file, descriptor) });
});
employeesRouter.get('/:id/photo-url', requirePermission('employee.view'), async (req, res) => {
  res.json({ data: await photoService.url(idOf(req)) });
});

/** /api/v1/employee-types — organization-defined employee types (HR masters). */
export const employeeTypesRouter = Router();

employeeTypesRouter.get('/', requirePermission('designation.view'), async (req, res) => {
  const query = parseInput(listEmployeeTypesQuerySchema, req.query);
  const { items, total } = await employeeTypeService.list(query);
  res.json(toListResponse(items, total, query));
});
employeeTypesRouter.post('/', requirePermission('designation.manage'), async (req, res) => {
  const input = parseInput(createEmployeeTypeSchema, req.body);
  res.status(201).json({ data: await employeeTypeService.create(input) });
});
employeeTypesRouter.patch('/:id', requirePermission('designation.manage'), async (req, res) => {
  const input = parseInput(updateEmployeeTypeSchema, req.body);
  res.json({ data: await employeeTypeService.update(idOf(req), input) });
});
employeeTypesRouter.delete('/:id', requirePermission('designation.manage'), async (req, res) => {
  await employeeTypeService.remove(idOf(req));
  res.status(204).end();
});

/** /api/v1/designations — designation / position master. */
export const designationsRouter = Router();

designationsRouter.get('/', requirePermission('designation.view'), async (req, res) => {
  const query = parseInput(listDesignationsQuerySchema, req.query);
  const { items, total } = await designationService.list(query);
  res.json(toListResponse(items, total, query));
});
designationsRouter.get('/:id', requirePermission('designation.view'), async (req, res) => {
  res.json({ data: await designationService.get(idOf(req)) });
});
designationsRouter.post('/', requirePermission('designation.manage'), async (req, res) => {
  const input = parseInput(createDesignationSchema, req.body);
  res.status(201).json({ data: await designationService.create(input) });
});
designationsRouter.patch('/:id', requirePermission('designation.manage'), async (req, res) => {
  const input = parseInput(updateDesignationSchema, req.body);
  res.json({ data: await designationService.update(idOf(req), input) });
});
designationsRouter.delete('/:id', requirePermission('designation.manage'), async (req, res) => {
  await designationService.remove(idOf(req));
  res.status(204).end();
});

import {
  attendanceSummaryQuerySchema,
  createRegularizationSchema,
  dateRangeQuerySchema,
  idParamSchema,
  importPunchesSchema,
  listAttendanceQuerySchema,
  listPeriodLocksQuerySchema,
  listRegularizationsQuerySchema,
  lockAttendancePeriodSchema,
  overrideAttendanceSchema,
  recomputeAttendanceSchema,
  selfPunchSchema,
  unlockAttendancePeriodSchema,
  upsertAttendancePolicySchema,
} from '@erp/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../core/authz';
import { parseMultipartFile } from '../../core/http/multipart';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { regularizationService } from './attendance.regularization';
import { attendanceService } from './attendance.service';
import { parseDescriptorField } from '../employees/employees.photo';
import { attendanceSummaryService } from './attendance.summary';

/** /api/v1/attendance — punches, daily records, regularization, locks, policy, payroll feed. */
export const attendanceRouter = Router();
const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const institutionParamSchema = z.object({ institutionId: z.string().uuid() }).strict();
const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const SELFIE_MAX_BYTES = 3 * 1024 * 1024;

/* ---- self-service (before parameterised routes) ---- */

/** JSON, or multipart with a `file` selfie + fields (direction, source, geo, faceDescriptor JSON). */
attendanceRouter.post('/me/punch', async (req, res) => {
  if (req.is('multipart/form-data')) {
    const { file, fields } = await parseMultipartFile(req, {
      maxBytes: SELFIE_MAX_BYTES,
      maxFields: 8,
    });
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === '') continue;
      body[k] = ['latitude', 'longitude', 'accuracyMeters'].includes(k)
        ? Number(v)
        : k === 'faceDescriptor'
          ? parseDescriptorField(v)
          : v;
    }
    const input = parseInput(selfPunchSchema, body);
    res.status(201).json({ data: await attendanceService.selfPunch(input, file) });
    return;
  }
  const input = parseInput(selfPunchSchema, req.body);
  res.status(201).json({ data: await attendanceService.selfPunch(input) });
});
attendanceRouter.get('/me', async (req, res) => {
  const { from, to } = parseInput(dateRangeQuerySchema, req.query);
  res.json({ data: await attendanceService.mine(from, to) });
});
attendanceRouter.get('/me/regularizations', async (_req, res) => {
  res.json({ data: await regularizationService.mine() });
});
attendanceRouter.post('/me/regularizations', async (req, res) => {
  const input = parseInput(createRegularizationSchema, req.body);
  res.status(201).json({ data: await regularizationService.request(input) });
});
attendanceRouter.post('/me/regularizations/:id/cancel', async (req, res) => {
  res.json({ data: await regularizationService.cancelOwn(idOf(req)) });
});

/* ---- punches / import ---- */

attendanceRouter.post(
  '/punches/import',
  requirePermission('attendance.import'),
  async (req, res) => {
    if (req.is('multipart/form-data')) {
      const { file } = await parseMultipartFile(req, { maxBytes: IMPORT_MAX_BYTES, maxFields: 1 });
      res.status(201).json({ data: await attendanceService.importCsv(file) });
      return;
    }
    const input = parseInput(importPunchesSchema, req.body);
    res.status(201).json({ data: await attendanceService.importJson(input) });
  },
);
attendanceRouter.get(
  '/punches/imports',
  requirePermission('attendance.import'),
  async (_req, res) => {
    res.json({ data: await attendanceService.listImports() });
  },
);
attendanceRouter.get('/employees/:id/punches', async (req, res) => {
  const { from, to } = parseInput(dateRangeQuerySchema, req.query);
  res.json({ data: await attendanceService.listPunches(idOf(req), from, to) });
});

/* ---- records ---- */

attendanceRouter.get('/records', requirePermission('attendance.view'), async (req, res) => {
  const query = parseInput(listAttendanceQuerySchema, req.query);
  const { items, total } = await attendanceService.list(query);
  res.json(toListResponse(items, total, query));
});
attendanceRouter.post('/recompute', requirePermission('attendance.manage'), async (req, res) => {
  const input = parseInput(recomputeAttendanceSchema, req.body);
  res.json({ data: await attendanceService.recompute(input) });
});
attendanceRouter.post('/override', requirePermission('attendance.manage'), async (req, res) => {
  const input = parseInput(overrideAttendanceSchema, req.body);
  res.json({ data: await attendanceService.override(input) });
});

/* ---- regularizations (HR view; decisions go through /workflows) ---- */

attendanceRouter.get('/regularizations', requirePermission('attendance.view'), async (req, res) => {
  const query = parseInput(listRegularizationsQuerySchema, req.query);
  const { items, total } = await regularizationService.list(query);
  res.json(toListResponse(items, total, query));
});

/* ---- period locks ---- */

attendanceRouter.get('/locks', requirePermission('attendance.view'), async (req, res) => {
  const query = parseInput(listPeriodLocksQuerySchema, req.query);
  res.json({ data: await attendanceService.listLocks(query.institutionId) });
});
attendanceRouter.post('/locks', requirePermission('attendance.lock'), async (req, res) => {
  const input = parseInput(lockAttendancePeriodSchema, req.body);
  res.status(201).json({ data: await attendanceService.lock(input) });
});
attendanceRouter.post(
  '/locks/:id/unlock',
  requirePermission('attendance.unlock'),
  async (req, res) => {
    const { reason } = parseInput(unlockAttendancePeriodSchema, req.body);
    res.json({ data: await attendanceService.unlock(idOf(req), reason) });
  },
);

/* ---- policy ---- */

attendanceRouter.get(
  '/policies/:institutionId',
  requirePermission('attendance.view'),
  async (req, res) => {
    const { institutionId } = parseInput(institutionParamSchema, req.params);
    res.json({ data: await attendanceService.getPolicy(institutionId) });
  },
);
attendanceRouter.put(
  '/policies/:institutionId',
  requirePermission('attendance.manage'),
  async (req, res) => {
    const { institutionId } = parseInput(institutionParamSchema, req.params);
    const input = parseInput(upsertAttendancePolicySchema, req.body);
    res.json({ data: await attendanceService.upsertPolicy(institutionId, input) });
  },
);

/* ---- payroll feed ---- */

attendanceRouter.get('/summary', async (req, res) => {
  const query = parseInput(attendanceSummaryQuerySchema, req.query);
  res.json({ data: await attendanceSummaryService.summary(query) });
});

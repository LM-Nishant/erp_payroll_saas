import {
  assignEmployeeSalarySchema,
  createLoanSchema,
  createPayrollAdjustmentSchema,
  createPayrollBatchSchema,
  createPayrollRunSchema,
  createReimbursementClaimSchema,
  createSalaryComponentSchema,
  createSalaryRevisionRequestSchema,
  createSalaryRuleSchema,
  createSalaryStructureSchema,
  createStatutoryRulePackSchema,
  financialYearSchema,
  form16FieldsSchema,
  groupSummaryQuerySchema,
  idParamSchema,
  listComponentsQuerySchema,
  listForm16QuerySchema,
  listLoansQuerySchema,
  listPayrollRunsQuerySchema,
  listPayslipsQuerySchema,
  listReimbursementsQuerySchema,
  listRevisionsQuerySchema,
  listRulesQuerySchema,
  listStructuresQuerySchema,
  markPaymentsPaidSchema,
  paginationQuerySchema,
  reopenPayrollRunSchema,
  runItemsQuerySchema,
  runReportQuerySchema,
  salaryPreviewSchema,
  seedDefaultComponentsSchema,
  statutoryReportQuerySchema,
  structureVersionSchema,
  updateSalaryComponentSchema,
  updateSalaryStructureSchema,
  upsertPayrollSettingsSchema,
  salaryStatementQuerySchema,
} from '@erp/shared';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../core/authz';
import { parseMultipartFile } from '../../core/http/multipart';
import { parseInput } from '../../core/http/validation';
import { loanService, reimbursementService } from './payroll.loans';
import {
  componentService,
  ruleService,
  settingsService,
  statutoryPackService,
  structureService,
} from './payroll.masters';
import { form16Service, payslipService } from './payroll.payslips';
import { exportReport, reportService, type TabularReport } from './payroll.reports';
import { adjustmentService, batchService, paymentService, runService } from './payroll.runs';
import { revisionService, salaryService } from './payroll.salary';
import { selfSalaryService } from './payroll.self';

/**
 * /api/v1/payroll — salary components, rules, structures, statutory packs, employee salary &
 * revisions, payroll runs (compute / review / approve / finalize / reopen), adjustments,
 * payments, payslips, Form 16, loans, reimbursements and reports. Mounted behind
 * `requireFeature('payroll')`. Fine-grained scope checks live in the services.
 */
export const payrollRouter = Router();
const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const employeeParamSchema = z.object({ id: z.string().uuid(), employeeId: z.string().uuid() });
const institutionQuerySchema = z.object({ institutionId: z.string().uuid() }).strict();
const statutoryListQuerySchema = z
  .object({
    financialYear: financialYearSchema,
    region: z.string().trim().toUpperCase().min(2).max(8).optional(),
  })
  .strict();
const decisionSchema = z
  .object({ approved: z.boolean(), comment: z.string().trim().max(1000).optional() })
  .strict();
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const runEmployeesQuerySchema = paginationQuerySchema
  .extend({ status: z.enum(['OK', 'ERROR', 'SKIPPED']).optional() })
  .strict();

async function sendReport(
  res: Response,
  format: z.infer<typeof runReportQuerySchema>['format'],
  json: unknown,
  table: TabularReport,
  scope: { groupId: string | null; institutionId: string | null },
  audit: { kind: string; entityId: string },
) {
  if (format === 'json') {
    res.json({ data: json });
    return;
  }
  const file = await exportReport(table, format, scope);
  await reportService.recordExport(audit.kind, audit.entityId, format);
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  res.send(file.body);
}

function sendPdf(res: Response, file: { fileName: string; contentType: string; body: Buffer }) {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  res.send(file.body);
}

/* ---- employee self-service (before parameterised routes) ---- */

payrollRouter.get('/me/payslips', async (_req, res) => {
  res.json({ data: await payslipService.mine() });
});
payrollRouter.post('/me/payslips/:id/download-url', async (req, res) => {
  res.status(201).json({ data: await payslipService.download(idOf(req)) });
});
payrollRouter.get('/me/form16', async (_req, res) => {
  res.json({ data: await form16Service.mine() });
});
payrollRouter.post('/me/form16/:id/download-url', async (req, res) => {
  res.status(201).json({ data: await form16Service.download(idOf(req)) });
});
payrollRouter.get('/me/salary', async (_req, res) => {
  res.json({ data: await selfSalaryService.mySalary() });
});
payrollRouter.get('/me/salary/pdf', async (_req, res) => {
  sendPdf(res, await selfSalaryService.mySalaryPdf());
});
payrollRouter.get('/me/salary-statement', async (req, res) => {
  const query = parseInput(salaryStatementQuerySchema, req.query);
  res.json({ data: await selfSalaryService.statement(query.fy) });
});
payrollRouter.get('/me/loans', async (_req, res) => {
  res.json({ data: await loanService.mine() });
});
payrollRouter.get('/me/reimbursements', async (_req, res) => {
  res.json({ data: await reimbursementService.mine() });
});
payrollRouter.post('/me/reimbursements', async (req, res) => {
  const input = parseInput(createReimbursementClaimSchema, req.body);
  res.status(201).json({ data: await reimbursementService.claim(input) });
});
payrollRouter.post('/me/reimbursements/:id/cancel', async (req, res) => {
  res.json({ data: await reimbursementService.cancelOwn(idOf(req)) });
});

/* ---- salary components ---- */

payrollRouter.get('/components', requirePermission('payroll.view'), async (req, res) => {
  res.json(await componentService.list(parseInput(listComponentsQuerySchema, req.query)));
});
payrollRouter.post('/components', requirePermission('payroll.manage'), async (req, res) => {
  const input = parseInput(createSalaryComponentSchema, req.body);
  res.status(201).json({ data: await componentService.create(input) });
});
payrollRouter.post(
  '/components/seed-defaults',
  requirePermission('payroll.manage'),
  async (req, res) => {
    const input = parseInput(seedDefaultComponentsSchema, req.body ?? {});
    res.status(201).json({ data: await componentService.seedDefaults(input.institutionId) });
  },
);
payrollRouter.get('/components/:id', requirePermission('payroll.view'), async (req, res) => {
  res.json({ data: await componentService.get(idOf(req)) });
});
payrollRouter.patch('/components/:id', requirePermission('payroll.manage'), async (req, res) => {
  const input = parseInput(updateSalaryComponentSchema, req.body);
  res.json({ data: await componentService.update(idOf(req), input) });
});

/* ---- salary rules ---- */

payrollRouter.get('/rules', requirePermission('payroll.view'), async (req, res) => {
  res.json(await ruleService.list(parseInput(listRulesQuerySchema, req.query)));
});
payrollRouter.post('/rules', requirePermission('payroll.manage'), async (req, res) => {
  const input = parseInput(createSalaryRuleSchema, req.body);
  res.status(201).json({ data: await ruleService.create(input) });
});

/* ---- salary structures ---- */

payrollRouter.get('/structures', requirePermission('payroll.view'), async (req, res) => {
  res.json(await structureService.list(parseInput(listStructuresQuerySchema, req.query)));
});
payrollRouter.post('/structures', requirePermission('payroll.manage'), async (req, res) => {
  const input = parseInput(createSalaryStructureSchema, req.body);
  res.status(201).json({ data: await structureService.create(input) });
});
payrollRouter.get('/structures/:id', requirePermission('payroll.view'), async (req, res) => {
  res.json({ data: await structureService.get(idOf(req)) });
});
payrollRouter.patch('/structures/:id', requirePermission('payroll.manage'), async (req, res) => {
  const input = parseInput(updateSalaryStructureSchema, req.body);
  res.json({ data: await structureService.update(idOf(req), input) });
});
payrollRouter.post(
  '/structures/:id/versions',
  requirePermission('payroll.manage'),
  async (req, res) => {
    const input = parseInput(structureVersionSchema, req.body);
    res.status(201).json({ data: await structureService.addVersion(idOf(req), input) });
  },
);

/* ---- settings & statutory packs ---- */

payrollRouter.get('/settings', requirePermission('payroll.view'), async (req, res) => {
  const { institutionId } = parseInput(institutionQuerySchema, req.query);
  res.json({ data: await settingsService.get(institutionId) });
});
payrollRouter.put('/settings', requirePermission('payroll.manage'), async (req, res) => {
  const input = parseInput(upsertPayrollSettingsSchema, req.body);
  res.json({ data: await settingsService.upsert(input) });
});
payrollRouter.get('/statutory-packs', requirePermission('payroll.view'), async (req, res) => {
  const q = parseInput(statutoryListQuerySchema, req.query);
  res.json({ data: await statutoryPackService.list(q.financialYear, q.region) });
});
payrollRouter.post('/statutory-packs', requirePermission('payroll.manage'), async (req, res) => {
  const input = parseInput(createStatutoryRulePackSchema, req.body);
  res.status(201).json({ data: await statutoryPackService.create(input) });
});

/* ---- employee salary & revisions ---- */

payrollRouter.post('/salary/preview', requirePermission('salary.view'), async (req, res) => {
  const input = parseInput(salaryPreviewSchema, req.body);
  res.json({ data: await salaryService.preview(input) });
});
payrollRouter.get('/employees/:id/salary', requirePermission('salary.view'), async (req, res) => {
  res.json({ data: await salaryService.list(idOf(req)) });
});
payrollRouter.get(
  '/employees/:id/salary/pdf',
  requirePermission('salary.view'),
  async (req, res) => {
    sendPdf(res, await selfSalaryService.employeeSalaryPdf(idOf(req)));
  },
);
payrollRouter.post(
  '/employees/:id/salary',
  requirePermission('salary.update'),
  async (req, res) => {
    const input = parseInput(assignEmployeeSalarySchema, req.body);
    res.status(201).json({ data: await salaryService.assign(idOf(req), input) });
  },
);
payrollRouter.get('/revisions', requirePermission('salary.view'), async (req, res) => {
  res.json(await revisionService.list(parseInput(listRevisionsQuerySchema, req.query)));
});
payrollRouter.post('/revisions', requirePermission('salary.update'), async (req, res) => {
  const input = parseInput(createSalaryRevisionRequestSchema, req.body);
  res.status(201).json({ data: await revisionService.request(input) });
});
payrollRouter.get('/revisions/:id', requirePermission('salary.view'), async (req, res) => {
  res.json({ data: await revisionService.get(idOf(req)) });
});
payrollRouter.post(
  '/revisions/:id/cancel',
  requirePermission('salary.update'),
  async (req, res) => {
    res.json({ data: await revisionService.cancel(idOf(req)) });
  },
);

/* ---- group batches ---- */

payrollRouter.post('/batches', requirePermission('payroll.process'), async (req, res) => {
  const input = parseInput(createPayrollBatchSchema, req.body);
  res.status(201).json({ data: await batchService.create(input) });
});
payrollRouter.get('/batches/:id', requirePermission('payroll.view'), async (req, res) => {
  res.json({ data: await batchService.get(idOf(req)) });
});
payrollRouter.post(
  '/batches/:id/compute',
  requirePermission('payroll.process'),
  async (req, res) => {
    res.status(202).json({ data: await batchService.compute(idOf(req)) });
  },
);

/* ---- payroll runs ---- */

payrollRouter.get('/runs', requirePermission('payroll.view'), async (req, res) => {
  res.json(await runService.list(parseInput(listPayrollRunsQuerySchema, req.query)));
});
payrollRouter.post('/runs', requirePermission('payroll.process'), async (req, res) => {
  const input = parseInput(createPayrollRunSchema, req.body);
  res.status(201).json({ data: await runService.create(input) });
});
payrollRouter.get('/runs/:id', requirePermission('payroll.view'), async (req, res) => {
  res.json({ data: await runService.get(idOf(req)) });
});
payrollRouter.post('/runs/:id/compute', requirePermission('payroll.process'), async (req, res) => {
  res.status(202).json({ data: await runService.compute(idOf(req)) });
});
payrollRouter.get('/runs/:id/employees', requirePermission('payroll.view'), async (req, res) => {
  const query = parseInput(runEmployeesQuerySchema, req.query);
  res.json(await runService.employees(idOf(req), query));
});
payrollRouter.get(
  '/runs/:id/employees/:employeeId',
  requirePermission('payroll.view'),
  async (req, res) => {
    const { id, employeeId } = parseInput(employeeParamSchema, req.params);
    res.json({ data: await runService.employee(id, employeeId) });
  },
);
payrollRouter.get('/runs/:id/items', requirePermission('payroll.view'), async (req, res) => {
  const { employeeId } = parseInput(runItemsQuerySchema, req.query);
  res.json({ data: await runService.items(idOf(req), employeeId) });
});
payrollRouter.post('/runs/:id/submit', requirePermission('payroll.process'), async (req, res) => {
  res.json({ data: await runService.submit(idOf(req)) });
});
payrollRouter.post('/runs/:id/decision', requirePermission('payroll.approve'), async (req, res) => {
  const input = parseInput(decisionSchema, req.body);
  res.json({ data: await runService.approve(idOf(req), input.approved, input.comment) });
});
payrollRouter.post('/runs/:id/finalize', requirePermission('payroll.lock'), async (req, res) => {
  res.json({ data: await runService.finalize(idOf(req)) });
});
payrollRouter.post('/runs/:id/reopen', requirePermission('payroll.reopen'), async (req, res) => {
  const { reason } = parseInput(reopenPayrollRunSchema, req.body);
  res.status(201).json({ data: await runService.reopen(idOf(req), reason) });
});
payrollRouter.post('/runs/:id/cancel', requirePermission('payroll.process'), async (req, res) => {
  res.json({ data: await runService.cancel(idOf(req)) });
});

/* ---- adjustments ---- */

payrollRouter.get('/runs/:id/adjustments', requirePermission('payroll.view'), async (req, res) => {
  res.json({ data: await adjustmentService.list(idOf(req)) });
});
payrollRouter.post(
  '/runs/:id/adjustments',
  requirePermission('payroll.process'),
  async (req, res) => {
    const input = parseInput(createPayrollAdjustmentSchema, req.body);
    res.status(201).json({ data: await adjustmentService.create(idOf(req), input) });
  },
);
payrollRouter.post(
  '/adjustments/:id/cancel',
  requirePermission('payroll.process'),
  async (req, res) => {
    res.json({ data: await adjustmentService.cancel(idOf(req)) });
  },
);

/* ---- payments ---- */

payrollRouter.get('/runs/:id/payments', requirePermission('payroll.view'), async (req, res) => {
  res.json({ data: await paymentService.list(idOf(req)) });
});
payrollRouter.get(
  '/runs/:id/payments/bank-file',
  requirePermission('payroll.disburse'),
  async (req, res) => {
    const file = await paymentService.exportBankFile(idOf(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.content);
  },
);
payrollRouter.post(
  '/runs/:id/payments/mark-paid',
  requirePermission('payroll.disburse'),
  async (req, res) => {
    const input = parseInput(markPaymentsPaidSchema, req.body);
    res.json({ data: await paymentService.markPaid(idOf(req), input) });
  },
);

/* ---- payslips ---- */

payrollRouter.get('/payslips', requirePermission('payroll.view'), async (req, res) => {
  res.json(await payslipService.list(parseInput(listPayslipsQuerySchema, req.query)));
});
payrollRouter.post('/payslips/:id/download-url', async (req, res) => {
  res.status(201).json({ data: await payslipService.download(idOf(req)) });
});
payrollRouter.post(
  '/runs/:id/payslips/regenerate',
  requirePermission('payroll.lock'),
  async (req, res) => {
    res.status(202).json({ data: await payslipService.regenerate(idOf(req)) });
  },
);

/* ---- Form 16 ---- */

payrollRouter.get('/form16', requirePermission('form16.manage'), async (req, res) => {
  res.json(await form16Service.list(parseInput(listForm16QuerySchema, req.query)));
});
payrollRouter.post('/form16', requirePermission('form16.manage'), async (req, res) => {
  const { file, fields } = await parseMultipartFile(req, {
    maxBytes: form16Service.maxBytes,
    maxFields: 4,
  });
  const input = parseInput(form16FieldsSchema, fields);
  res.status(201).json({ data: await form16Service.upload(input, file) });
});
payrollRouter.post('/form16/generate', requirePermission('form16.manage'), async (req, res) => {
  const input = parseInput(form16FieldsSchema, req.body);
  res.status(201).json({ data: await form16Service.generate(input) });
});
payrollRouter.post('/form16/:id/publish', requirePermission('form16.manage'), async (req, res) => {
  res.json({ data: await form16Service.publish(idOf(req)) });
});
payrollRouter.post('/form16/:id/download-url', async (req, res) => {
  res.status(201).json({ data: await form16Service.download(idOf(req)) });
});

/* ---- loans ---- */

payrollRouter.get('/loans', requirePermission('payroll.view'), async (req, res) => {
  res.json(await loanService.list(parseInput(listLoansQuerySchema, req.query)));
});
payrollRouter.post('/loans', requirePermission('payroll.process'), async (req, res) => {
  const input = parseInput(createLoanSchema, req.body);
  res.status(201).json({ data: await loanService.create(input) });
});
payrollRouter.get('/loans/:id', async (req, res) => {
  res.json({ data: await loanService.get(idOf(req)) });
});
payrollRouter.post('/loans/:id/cancel', requirePermission('payroll.process'), async (req, res) => {
  const { reason } = parseInput(reasonSchema, req.body);
  res.json({ data: await loanService.cancel(idOf(req), reason) });
});

/* ---- reimbursements ---- */

payrollRouter.get('/reimbursements', requirePermission('payroll.view'), async (req, res) => {
  res.json(await reimbursementService.list(parseInput(listReimbursementsQuerySchema, req.query)));
});
payrollRouter.post(
  '/reimbursements/:id/decision',
  requirePermission('payroll.process'),
  async (req, res) => {
    const input = parseInput(decisionSchema, req.body);
    res.json({ data: await reimbursementService.decide(idOf(req), input.approved, input.comment) });
  },
);

/* ---- reports ---- */

payrollRouter.get(
  '/reports/runs/:id/register',
  requirePermission('payroll.report'),
  async (req, res) => {
    const { format } = parseInput(runReportQuerySchema, req.query);
    const reg = await reportService.register(idOf(req));
    await sendReport(
      res,
      format,
      reg,
      reportService.registerTable(reg),
      { groupId: reg.run.groupId, institutionId: reg.run.institutionId },
      { kind: 'register', entityId: reg.run.id },
    );
  },
);
payrollRouter.get(
  '/reports/runs/:id/components',
  requirePermission('payroll.report'),
  async (req, res) => {
    const { format } = parseInput(runReportQuerySchema, req.query);
    const r = await reportService.componentSummary(idOf(req));
    await sendReport(
      res,
      format,
      { run: r.run, rows: r.rows },
      r.table,
      { groupId: r.scope.groupId, institutionId: r.scope.id },
      { kind: 'components', entityId: r.run.id },
    );
  },
);
payrollRouter.get('/reports/statutory', requirePermission('payroll.report'), async (req, res) => {
  const q = parseInput(statutoryReportQuerySchema, req.query);
  const r = await reportService.statutory(q.runId, q.pack);
  await sendReport(
    res,
    q.format,
    { run: r.run, pack: r.pack, rows: r.rows, totals: r.totals },
    r.table,
    { groupId: r.scope.groupId, institutionId: r.scope.id },
    { kind: `statutory.${q.pack}`, entityId: r.run.id },
  );
});
payrollRouter.get(
  '/reports/group-summary',
  requirePermission('payroll.report'),
  async (req, res) => {
    const q = parseInput(groupSummaryQuerySchema, req.query);
    const summary = await reportService.groupSummary(q);
    await sendReport(
      res,
      q.format,
      summary,
      reportService.groupTable(summary),
      { groupId: q.groupId ?? null, institutionId: null },
      { kind: 'group_summary', entityId: q.groupId ?? 'organization' },
    );
  },
);

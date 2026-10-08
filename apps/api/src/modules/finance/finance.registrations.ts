import { registerEventType, onEvent } from '../../core/events';
import { currentFeatureContext, isFeatureEnabled } from '../../core/features';
import { logger } from '../../core/logger';
import { tenantDb } from '../../core/tenancy';
import {
  accountFor,
  cancelVoucherInTx,
  ensureChartOfAccounts,
  institutionScope,
  postVoucher,
} from './finance.ledger';
import { fromPaise, toPaise } from './finance.logic';

/*
 * Finance / accounts registrations — imported once from `apps/api/src/engines.ts`.
 */

const EVENTS: [string, string][] = [
  ['finance.voucher_posted', 'Journal voucher posted'],
  ['finance.expense_recorded', 'Expense recorded'],
];
for (const [key, label] of EVENTS) registerEventType({ key, label, webhook: true });

/**
 * Payroll → accounts: a finalized payroll run posts a salary journal (Dr salaries + employer
 * contributions, Cr salary payable + statutory dues). Re-finalized revisions replace the
 * previous journal. Skipped when the finance module is not enabled for the institution.
 */
export async function postPayrollRun(runId: string, revision: number) {
  const db = tenantDb();
  const run = await db.payrollRun.findFirst({ where: { id: runId } });
  if (!run) return null;
  const enabled = await isFeatureEnabled(currentFeatureContext(), 'finance', {
    institutionId: run.institutionId,
  });
  if (!enabled) return null;
  const keys = await ensureChartOfAccounts();
  const gross = toPaise(run.grossTotal);
  const net = toPaise(run.netTotal);
  const employer = toPaise(run.employerTotal);
  if (gross + employer <= 0) return null;
  const scope = await institutionScope(run.institutionId);
  const sourceKey = `payroll:${run.id}:${revision}`;
  return db.$transaction(async (tx) => {
    const previous = await tx.journalVoucher.findMany({
      where: { sourceType: 'PAYROLL', sourceId: run.id, status: { not: 'CANCELLED' } },
      select: { id: true, sourceKey: true },
    });
    for (const v of previous) {
      if (v.sourceKey !== sourceKey) {
        await cancelVoucherInTx(tx, v.id, `Superseded by payroll revision ${revision}`);
      }
    }
    return postVoucher(tx, {
      scope,
      voucherDate: run.periodEnd,
      type: 'JOURNAL',
      narration: `Payroll ${run.label} (revision ${revision})`,
      sourceType: 'PAYROLL',
      sourceId: run.id,
      sourceKey,
      lines: [
        { accountId: accountFor(keys, 'salary_expense'), debit: fromPaise(gross), credit: 0 },
        {
          accountId: accountFor(keys, 'employer_contribution'),
          debit: fromPaise(employer),
          credit: 0,
        },
        { accountId: accountFor(keys, 'salary_payable'), debit: 0, credit: fromPaise(net) },
        {
          accountId: accountFor(keys, 'statutory_payable'),
          debit: 0,
          credit: fromPaise(gross + employer - net),
        },
      ],
    });
  });
}

onEvent('payroll.run_finalized', 'finance.payroll_posting', async (event) => {
  const runId = String(event.payload.runId ?? '');
  if (!runId) return;
  const revision = Number(event.payload.revision ?? 1);
  const voucher = await postPayrollRun(runId, Number.isFinite(revision) ? revision : 1);
  if (voucher) logger.info({ runId, voucherId: voucher.id }, 'Payroll posted to accounts');
});

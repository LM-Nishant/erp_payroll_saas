import type { Response } from 'express';
import type { FinanceTableDto } from '@erp/shared';
import { audit } from '../../core/audit';
import { exportReport } from '../payroll/payroll.reports';

/**
 * Sends a tabular fee / finance report as JSON or as a CSV / XLSX / branded PDF download
 * (reusing the payroll report exporters). File exports are audited.
 */
export async function sendTable(
  res: Response,
  table: FinanceTableDto,
  format: 'json' | 'csv' | 'xlsx' | 'pdf',
  meta: { kind: string; institutionId?: string | null; groupId?: string | null },
) {
  if (format === 'json') {
    res.json({ data: table });
    return;
  }
  const file = await exportReport(table, format, {
    groupId: meta.groupId ?? null,
    institutionId: meta.institutionId ?? null,
  });
  await audit.record({
    action: 'finance.report_exported',
    entityType: 'finance_report',
    entityId: meta.kind,
    after: { kind: meta.kind, format, institutionId: meta.institutionId ?? null },
  });
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  res.send(file.body);
}

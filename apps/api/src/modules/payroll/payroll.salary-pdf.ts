import type { MySalaryComponentDto, MySalaryDto } from '@erp/shared';
import { z } from 'zod';
import { registerPdfTemplate, renderPdfTemplate, type PdfBlock } from '../../core/pdf';
import { tenantDb } from '../../core/tenancy';
import { rupeesInWords } from './amount-words';

/** Salary structure (CTC breakdown) PDF, rendered on demand with the institution's branding. */
export const SALARY_STRUCTURE_TEMPLATE = 'payroll_salary_structure';

const row = z.tuple([z.string().max(200), z.string(), z.string()]);
const inputSchema = z.object({
  employeeName: z.string().max(200),
  employeeCode: z.string().max(64),
  designation: z.string().max(200).optional(),
  department: z.string().max(200).optional(),
  institution: z.string().max(200).optional(),
  dateOfJoining: z.string().max(20).optional(),
  structureName: z.string().max(200).optional(),
  effectiveFrom: z.string(),
  taxRegime: z.string().max(20),
  annualCtc: z.string(),
  monthlyCtc: z.string(),
  earnings: z.array(row),
  deductions: z.array(row),
  employer: z.array(row),
  grossMonthly: z.string(),
  grossAnnual: z.string(),
  deductionsMonthly: z.string(),
  deductionsAnnual: z.string(),
  netMonthly: z.string(),
  netAnnual: z.string(),
  ctcInWords: z.string().max(300),
});
type Input = z.infer<typeof inputSchema>;

const money = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COLUMNS = ['Component', 'Monthly (INR)', 'Annual (INR)'];

registerPdfTemplate<Input>({
  key: SALARY_STRUCTURE_TEMPLATE,
  version: 1,
  name: 'Salary structure',
  description: 'Current salary structure / CTC breakdown of an employee (branded per institution).',
  inputSchema,
  defaultCategory: 'payroll',
  defaultDocumentType: 'salary_structure',
  title: (i) => `Salary structure - ${i.employeeName} (${i.employeeCode})`,
  build(input) {
    const opt = (label: string, value: string | undefined, text: string): [string, string][] =>
      value ? [[label, text]] : [];
    const blocks: PdfBlock[] = [
      { type: 'heading', level: 1, text: 'Salary structure' },
      {
        type: 'keyValue',
        rows: [
          ['Employee name', '{{employeeName}}, {{employeeCode}}'],
          ...opt('Designation', input.designation, '{{designation}}'),
          ...opt('Department', input.department, '{{department}}'),
          ...opt('Institution', input.institution, '{{institution}}'),
          ...opt('Date of joining', input.dateOfJoining, '{{dateOfJoining}}'),
          ...opt('Salary structure', input.structureName, '{{structureName}}'),
          ['Effective from', '{{effectiveFrom}}'],
          ['Tax regime', '{{taxRegime}}'],
          ['Annual CTC', 'INR {{annualCtc}} ({{monthlyCtc}} per month)'],
          ['CTC in words', '{{ctcInWords}}'],
        ],
      },
      { type: 'heading', level: 2, text: 'Earnings' },
      {
        type: 'table',
        columns: COLUMNS,
        rows: [...input.earnings, ['Gross earnings', input.grossMonthly, input.grossAnnual]],
      },
      { type: 'heading', level: 2, text: 'Deductions' },
      {
        type: 'table',
        columns: COLUMNS,
        rows: [
          ...(input.deductions.length ? input.deductions : [['None', '0.00', '0.00']]),
          ['Total deductions', input.deductionsMonthly, input.deductionsAnnual],
        ],
      },
    ];
    if (input.employer.length) {
      blocks.push(
        { type: 'heading', level: 2, text: 'Employer contributions (part of CTC, not net pay)' },
        { type: 'table', columns: COLUMNS, rows: input.employer },
      );
    }
    blocks.push(
      {
        type: 'keyValue',
        rows: [
          ['Net take-home (monthly)', 'INR {{netMonthly}}'],
          ['Net take-home (annual)', 'INR {{netAnnual}}'],
        ],
      },
      {
        type: 'paragraph',
        text: 'Amounts are for a full month with no loss of pay; actual payslips reflect attendance, arrears and tax. This is a computer-generated statement issued by {{branding.displayName}} and does not require a signature.',
      },
    );
    return blocks;
  },
});

const rows = (xs: MySalaryComponentDto[]) =>
  xs.map((c) => [c.name, money(c.monthly), money(c.annual)] as [string, string, string]);

export async function salaryStructurePdfFile(dto: MySalaryDto, institutionId: string) {
  const inst = await tenantDb().institution.findFirst({
    where: { id: institutionId },
    select: { groupId: true },
  });
  const opt = <K extends string>(key: K, v: string | null) => (v ? { [key]: v } : {});
  const input: Input = {
    employeeName: dto.employeeName,
    employeeCode: dto.employeeCode,
    ...opt('designation', dto.designation),
    ...opt('department', dto.department),
    ...opt('institution', dto.institution),
    ...opt('dateOfJoining', dto.dateOfJoining),
    ...opt('structureName', dto.structureName),
    effectiveFrom: dto.effectiveFrom,
    taxRegime: dto.taxRegime === 'OLD' ? 'Old regime' : 'New regime',
    annualCtc: money(dto.annualCtc),
    monthlyCtc: money(dto.monthlyCtc),
    earnings: rows(dto.earnings),
    deductions: rows(dto.deductions),
    employer: rows(dto.employerContributions),
    grossMonthly: money(dto.grossMonthly),
    grossAnnual: money(dto.grossMonthly * 12),
    deductionsMonthly: money(dto.deductionsMonthly),
    deductionsAnnual: money(dto.deductionsMonthly * 12),
    netMonthly: money(dto.netMonthly),
    netAnnual: money(dto.netMonthly * 12),
    ctcInWords: rupeesInWords(dto.annualCtc),
  };
  const rendered = await renderPdfTemplate(SALARY_STRUCTURE_TEMPLATE, input, {
    groupId: inst?.groupId ?? null,
    institutionId,
    campusId: null,
    departmentId: null,
  });
  const slug = `${dto.employeeCode}`.replace(/[^A-Za-z0-9_-]+/g, '-');
  return {
    fileName: `salary-structure-${slug}.pdf`,
    contentType: 'application/pdf',
    body: rendered.body,
  };
}

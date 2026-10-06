import type { EmployeeLetterInput } from '@erp/shared';
import { z } from 'zod';
import { authorize, currentPrincipal, hierarchyResource } from '../../core/authz';
import { audit } from '../../core/audit';
import { AppError } from '../../core/http/errors';
import { generatePdf, registerPdfTemplate, type PdfBlock } from '../../core/pdf';
import { tenantDb } from '../../core/tenancy';
import { dateStr, todayStr } from './employees.mappers';
import { loadEmployeeFor } from './employees.service';

/*
 * HR letters (spec acceptance 24-26): offer, experience and relieving letters are code-registered
 * PDF templates rendered with the institution's branding and stored as `employee` documents
 * (category `employment`), so the employee can download them via self-service.
 */

const s = (max: number) => z.string().trim().max(max);
const baseLetter = {
  date: s(20),
  reference: s(100).optional(),
  employeeName: s(200).min(1),
  employeeCode: s(40).min(1),
  designation: s(200).default(''),
  department: s(200).default(''),
  institution: s(200).min(1),
  signatoryName: s(200).optional(),
  signatoryTitle: s(200).optional(),
  remarks: s(1000).optional(),
};

const offerSchema = z
  .object({
    ...baseLetter,
    dateOfJoining: s(20).min(1),
    employmentType: s(40),
    annualCtc: s(40).optional(),
    acceptBy: s(20).optional(),
  })
  .strict();
const experienceSchema = z
  .object({ ...baseLetter, dateOfJoining: s(20).min(1), lastWorkingDate: s(20).min(1) })
  .strict();
const relievingSchema = experienceSchema;

type OfferInput = z.infer<typeof offerSchema>;
type ServiceInput = z.infer<typeof experienceSchema>;

const header = (input: { reference?: string }): PdfBlock => ({
  type: 'keyValue',
  rows: [
    ...(input.reference ? ([['Ref', '{{reference}}']] as [string, string][]) : []),
    ['Date', '{{date}}'],
  ],
});
const signature = (
  input: { signatoryName?: string; signatoryTitle?: string },
  ctx: { branding: { displayName: string | null } },
): PdfBlock => ({
  type: 'signature',
  label: 'For {{institution}}',
  name: input.signatoryName ?? null,
  designation: input.signatoryTitle ?? ctx.branding.displayName ?? 'Authorised signatory',
});
const remarks = (input: { remarks?: string }): PdfBlock[] =>
  input.remarks ? [{ type: 'paragraph', text: '{{remarks}}', align: 'justify' }] : [];

export const LETTER_TEMPLATES = {
  offer: 'hr_offer_letter',
  experience: 'hr_experience_letter',
  relieving: 'hr_relieving_letter',
} as const;

registerPdfTemplate<OfferInput>({
  key: LETTER_TEMPLATES.offer,
  version: 1,
  name: 'Offer letter',
  description: 'Employment offer with designation, joining date and CTC.',
  inputSchema: offerSchema,
  defaultCategory: 'employment',
  defaultDocumentType: 'offer_letter',
  title: (i) => `Offer letter - ${i.employeeName} (${i.employeeCode})`,
  build(input, ctx) {
    return [
      header(input),
      { type: 'heading', level: 1, text: 'Offer of Employment' },
      { type: 'paragraph', text: 'Dear {{employeeName}},' },
      {
        type: 'paragraph',
        align: 'justify',
        text:
          'We are pleased to offer you the position of {{designation}}' +
          (input.department ? ' in the {{department}} department' : '') +
          ' at {{institution}} ({{employmentType}}). Your expected date of joining is {{dateOfJoining}}.',
      },
      ...(input.annualCtc
        ? [
            {
              type: 'keyValue',
              rows: [
                ['Employee code', '{{employeeCode}}'],
                ['Annual CTC', '{{annualCtc}}'],
              ],
            } as PdfBlock,
          ]
        : []),
      ...(input.acceptBy
        ? [
            {
              type: 'paragraph',
              text: 'Please confirm your acceptance of this offer by {{acceptBy}}.',
            } as PdfBlock,
          ]
        : []),
      ...remarks(input),
      { type: 'paragraph', text: 'We look forward to welcoming you to {{branding.displayName}}.' },
      signature(input, ctx),
    ];
  },
});

registerPdfTemplate<ServiceInput>({
  key: LETTER_TEMPLATES.experience,
  version: 1,
  name: 'Experience letter',
  description: 'Certificate of service with tenure and last designation.',
  inputSchema: experienceSchema,
  defaultCategory: 'employment',
  defaultDocumentType: 'experience_letter',
  title: (i) => `Experience letter - ${i.employeeName} (${i.employeeCode})`,
  build(input, ctx) {
    return [
      header(input),
      { type: 'heading', level: 1, text: 'Experience Certificate' },
      { type: 'paragraph', text: 'To whomsoever it may concern,' },
      {
        type: 'paragraph',
        align: 'justify',
        text:
          'This is to certify that {{employeeName}} (employee code {{employeeCode}}) was employed ' +
          'with {{institution}} from {{dateOfJoining}} to {{lastWorkingDate}}' +
          (input.designation ? ', last holding the position of {{designation}}' : '') +
          (input.department ? ' in the {{department}} department' : '') +
          '.',
      },
      ...remarks(input),
      { type: 'paragraph', text: 'We wish them every success in their future endeavours.' },
      signature(input, ctx),
    ];
  },
});

registerPdfTemplate<ServiceInput>({
  key: LETTER_TEMPLATES.relieving,
  version: 1,
  name: 'Relieving letter',
  description: 'Confirms the employee has been relieved of their duties.',
  inputSchema: relievingSchema,
  defaultCategory: 'employment',
  defaultDocumentType: 'relieving_letter',
  title: (i) => `Relieving letter - ${i.employeeName} (${i.employeeCode})`,
  build(input, ctx) {
    return [
      header(input),
      { type: 'heading', level: 1, text: 'Relieving Letter' },
      { type: 'paragraph', text: 'Dear {{employeeName}},' },
      {
        type: 'paragraph',
        align: 'justify',
        text:
          'This is to confirm that you have been relieved of your duties' +
          (input.designation ? ' as {{designation}}' : '') +
          ' at {{institution}} with effect from the close of business on {{lastWorkingDate}}. ' +
          'Your tenure with us was from {{dateOfJoining}} to {{lastWorkingDate}}.',
      },
      ...remarks(input),
      {
        type: 'paragraph',
        text: 'We thank you for your contributions and wish you the very best.',
      },
      signature(input, ctx),
    ];
  },
});

const typeLabel: Record<string, string> = {
  TEACHING: 'Teaching',
  NON_TEACHING: 'Non-teaching',
  CONTRACT: 'Contract',
  VISITING: 'Visiting',
};

/**
 * Generate a letter for an employee and store it as one of their documents. Requires
 * `employee.view` (visibility) + `pdf.generate` and `document.upload` in the employee's scope.
 */
export async function generateEmployeeLetter(employeeId: string, input: EmployeeLetterInput) {
  const employee = await loadEmployeeFor(employeeId, 'employee.view');
  await authorize(currentPrincipal(), 'document.upload', hierarchyResource.employee(employee));
  const base = {
    date: input.date ?? todayStr(),
    employeeName: employee.displayName,
    employeeCode: employee.employeeCode,
    designation: employee.designation?.name ?? '',
    department: employee.department?.name ?? '',
    institution: employee.institution.name,
    ...(input.signatoryName ? { signatoryName: input.signatoryName } : {}),
    ...(input.signatoryTitle ? { signatoryTitle: input.signatoryTitle } : {}),
    ...(input.remarks ? { remarks: input.remarks } : {}),
  };
  let data: Record<string, unknown>;
  if (input.type === 'offer') {
    let ctc = input.annualCtc;
    let currency = 'INR';
    if (ctc === undefined) {
      const latest = await tenantDb().employeeSalaryHistory.findFirst({
        where: { employeeId },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      });
      if (latest) {
        ctc = Number(latest.annualCtc);
        currency = latest.currency;
      }
    }
    data = {
      ...base,
      dateOfJoining: employee.dateOfJoining ? dateStr(employee.dateOfJoining) : 'to be confirmed',
      employmentType: typeLabel[employee.employmentType] ?? employee.employmentType,
      ...(ctc !== undefined ? { annualCtc: `${currency} ${ctc.toLocaleString('en-IN')}` } : {}),
      ...(input.acceptBy ? { acceptBy: input.acceptBy } : {}),
    };
  } else {
    if (!employee.dateOfJoining) {
      throw new AppError(422, 'VALIDATION_ERROR', 'The employee has no date of joining');
    }
    const lastDay = employee.lastWorkingDate ?? employee.exitDate;
    if (input.type === 'relieving' && !lastDay) {
      throw new AppError(
        409,
        'INVALID_STATE',
        'A relieving letter needs a resignation (last working date) or an exit',
      );
    }
    data = {
      ...base,
      dateOfJoining: dateStr(employee.dateOfJoining),
      lastWorkingDate: lastDay ? dateStr(lastDay) : 'present',
    };
  }
  const doc = await generatePdf({
    templateKey: LETTER_TEMPLATES[input.type],
    data,
    ownerType: 'employee',
    ownerId: employeeId,
  });
  await audit.record({
    action: 'employee.letter.generate',
    entityType: 'employee',
    entityId: employeeId,
    metadata: { type: input.type, documentId: doc.id },
  });
  return doc;
}

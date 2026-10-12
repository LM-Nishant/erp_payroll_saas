import { z } from 'zod';
import { registerPdfTemplate, type PdfBlock } from '../../core/pdf';

/*
 * Branded Transfer Certificate and Character Certificate PDF templates. The PDF renderer adds the
 * tenant letterhead (logo top-right, brand colour) to every page. The input is a snapshot of the
 * certificate (stored with the document), so the PDF can be re-rendered after a logo change.
 */

export const TRANSFER_CERTIFICATE_TEMPLATE = 'transfer_certificate';
export const CHARACTER_CERTIFICATE_TEMPLATE = 'character_certificate';

const certificateInputSchema = z
  .object({
    certificateNo: z.string(),
    issueDate: z.string(),
    institution: z.string(),
    institutionAddress: z.string(),
    studentName: z.string(),
    admissionNo: z.string(),
    dateOfBirth: z.string(),
    gender: z.string(),
    guardianName: z.string(),
    admissionDate: z.string(),
    program: z.string(),
    lastClass: z.string(),
    academicYear: z.string(),
    leavingDate: z.string(),
    reason: z.string(),
    conduct: z.string(),
    promotionStatus: z.string(),
    feeStatus: z.string(),
    remarks: z.string(),
    replacesNo: z.string(),
  })
  .strict();
export type CertificatePdfInput = z.infer<typeof certificateInputSchema>;

const dash = (v: string) => (v.trim() ? v : '—');

function header(title: string, i: CertificatePdfInput): PdfBlock[] {
  const blocks: PdfBlock[] = [{ type: 'heading', level: 1, text: title }];
  blocks.push({ type: 'paragraph', text: i.institution, align: 'center', bold: true });
  if (i.institutionAddress)
    blocks.push({ type: 'paragraph', text: i.institutionAddress, align: 'center' });
  blocks.push({
    type: 'keyValue',
    rows: [
      ['Certificate no.', i.certificateNo],
      ['Date of issue', i.issueDate],
    ],
  });
  return blocks;
}

function footer(i: CertificatePdfInput): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  if (i.replacesNo) {
    blocks.push({
      type: 'paragraph',
      text: `This certificate is a reissue and supersedes certificate no. ${i.replacesNo}, which stands cancelled.`,
    });
  }
  blocks.push(
    { type: 'spacer', size: 24 },
    {
      type: 'signature',
      label: 'Principal / Head of Institution',
      name: null,
      designation: i.institution,
    },
  );
  return blocks;
}

registerPdfTemplate<CertificatePdfInput>({
  key: TRANSFER_CERTIFICATE_TEMPLATE,
  version: 1,
  name: 'Transfer certificate',
  description: 'Branded school leaving / transfer certificate (TC).',
  inputSchema: certificateInputSchema,
  defaultCategory: 'student',
  defaultDocumentType: 'transfer_certificate',
  title: (i) => `Transfer certificate ${i.certificateNo}`,
  build: (i) => [
    ...header('Transfer Certificate', i),
    {
      type: 'keyValue',
      rows: [
        ['Name of student', i.studentName],
        ['Admission no.', i.admissionNo],
        ["Parent / guardian's name", dash(i.guardianName)],
        ['Date of birth', dash(i.dateOfBirth)],
        ['Gender', dash(i.gender)],
        ['Date of admission', dash(i.admissionDate)],
        ['Programme', dash(i.program)],
        ['Class last studied', dash(i.lastClass)],
        ['Academic year', i.academicYear],
        ['Whether qualified for promotion', dash(i.promotionStatus)],
        ['Date of leaving', dash(i.leavingDate)],
        ['Reason for leaving', dash(i.reason)],
        ['General conduct', i.conduct],
        ['Fee dues', i.feeStatus],
        ['Remarks', dash(i.remarks)],
      ],
    },
    {
      type: 'paragraph',
      align: 'justify',
      text: `Certified that the above particulars are in accordance with the school records. ${i.studentName} has been struck off the rolls of the institution with effect from ${dash(i.leavingDate)}.`,
    },
    ...footer(i),
  ],
});

registerPdfTemplate<CertificatePdfInput>({
  key: CHARACTER_CERTIFICATE_TEMPLATE,
  version: 1,
  name: 'Character certificate',
  description: 'Branded character / conduct certificate.',
  inputSchema: certificateInputSchema,
  defaultCategory: 'student',
  defaultDocumentType: 'character_certificate',
  title: (i) => `Character certificate ${i.certificateNo}`,
  build: (i) => {
    const period = i.leavingDate
      ? `from ${dash(i.admissionDate)} to ${i.leavingDate}`
      : `since ${dash(i.admissionDate)}`;
    const blocks: PdfBlock[] = [
      ...header('Character Certificate', i),
      { type: 'paragraph', text: 'TO WHOMSOEVER IT MAY CONCERN', align: 'center', bold: true },
      {
        type: 'paragraph',
        align: 'justify',
        text:
          `This is to certify that ${i.studentName} (Admission no. ${i.admissionNo})` +
          (i.guardianName ? `, ward of ${i.guardianName},` : '') +
          ` has been a bonafide student of ${i.institution} ${period}` +
          (i.lastClass ? `, studying in ${i.lastClass}` : '') +
          ` during the academic year ${i.academicYear}.`,
      },
      {
        type: 'paragraph',
        align: 'justify',
        text: `To the best of our knowledge, the student bears a good moral character. The student's conduct during the period of study has been ${i.conduct.toLowerCase()}.`,
      },
    ];
    if (i.remarks) blocks.push({ type: 'paragraph', text: `Remarks: ${i.remarks}` });
    blocks.push({ type: 'paragraph', text: 'We wish the student every success in life.' });
    return [...blocks, ...footer(i)];
  },
});

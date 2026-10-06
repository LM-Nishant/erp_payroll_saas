import { genericLetterInputSchema, type GenericLetterInput } from '@erp/shared';
import type { PdfBlock } from './model';
import { registerPdfTemplate } from './templates';

/** Sample template: a generic branded letter (subject + free body + signatory). */
registerPdfTemplate<GenericLetterInput>({
  key: 'generic_letter',
  version: 1,
  name: 'Generic letter',
  description: 'Branded letter with recipient, subject, body and signatory.',
  inputSchema: genericLetterInputSchema,
  defaultCategory: 'correspondence',
  defaultDocumentType: 'letter',
  title: (input) => input.subject,
  build(input, ctx) {
    const blocks: PdfBlock[] = [
      {
        type: 'keyValue',
        rows: [
          ...(input.reference ? ([['Ref', '{{reference}}']] as [string, string][]) : []),
          ['Date', input.date ? '{{date}}' : '{{today}}'],
        ],
      },
      { type: 'paragraph', text: '{{recipientName}}', bold: true },
    ];
    if (input.recipientAddress) blocks.push({ type: 'paragraph', text: '{{recipientAddress}}' });
    blocks.push(
      { type: 'heading', level: 2, text: 'Subject: {{subject}}' },
      { type: 'paragraph', text: input.salutation ?? 'Dear {{recipientName}},' },
      ...input.body
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p): PdfBlock => ({ type: 'paragraph', text: p, align: 'justify' })),
      {
        type: 'signature',
        label: input.closing ?? 'Sincerely,',
        name: input.signatoryName ?? null,
        designation: input.signatoryDesignation ?? ctx.branding.displayName,
      },
    );
    return blocks;
  },
});

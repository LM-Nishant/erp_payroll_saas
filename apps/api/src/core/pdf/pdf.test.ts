import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { interpolate, interpolateBlocks, type PdfBranding, type PdfDocumentModel } from './model';
import { PdfKitRenderer } from './renderer';
import { pdfTemplate, pdfTemplates, registerPdfTemplate, unregisterPdfTemplate } from './templates';
import './generic-letter';

// 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const branding = (logo: boolean): PdfBranding => ({
  displayName: 'ABBS School',
  letterheadText: 'Excellence in education',
  footerText: 'Registered office: Bengaluru',
  address: '1 Main Road',
  contactEmail: 'info@abbs.test',
  contactPhone: null,
  website: null,
  primaryColor: '#AA0000',
  secondaryColor: '#00AA00',
  accentColor: '#0000AA',
  logoFileId: logo ? 'logo-doc' : null,
  logo: logo ? { mimeType: 'image/png', body: PNG } : null,
});

describe('pdf model', () => {
  it('interpolates placeholders (dot paths, missing → empty)', () => {
    expect(
      interpolate('Dear {{ name }} of {{branding.displayName}}{{missing}}', {
        name: 'Asha',
        branding: { displayName: 'ABBS' },
      }),
    ).toBe('Dear Asha of ABBS');
    const blocks = interpolateBlocks(
      [
        { type: 'keyValue', rows: [['Name', '{{name}}']] },
        { type: 'signature', name: '{{name}}', designation: null },
      ],
      { name: 'Asha' },
    );
    expect(blocks).toEqual([
      { type: 'keyValue', rows: [['Name', 'Asha']] },
      { type: 'signature', name: 'Asha', designation: null, label: undefined },
    ]);
  });
});

describe('pdf templates', () => {
  it('registers versioned templates and returns the latest version', () => {
    const base = {
      key: 'test_tpl',
      name: 'T',
      description: 'd',
      inputSchema: z.object({}).strict(),
      defaultCategory: 'other' as const,
      defaultDocumentType: 'test',
      title: () => 'T',
      build: () => [],
    };
    registerPdfTemplate({ ...base, version: 1 });
    registerPdfTemplate({ ...base, version: 2 });
    expect(() => registerPdfTemplate({ ...base, version: 2 })).toThrow(/already registered/);
    expect(pdfTemplate('test_tpl').version).toBe(2);
    expect(pdfTemplate('test_tpl', 1).version).toBe(1);
    expect(pdfTemplates().map((t) => t.key)).toEqual(
      expect.arrayContaining(['generic_letter', 'test_tpl']),
    );
    unregisterPdfTemplate('test_tpl');
    expect(() => pdfTemplate('test_tpl')).toThrow(/Unknown PDF template/);
  });

  it('generic letter builds a branded letter body', () => {
    const t = pdfTemplate('generic_letter');
    const input = t.inputSchema.parse({
      recipientName: 'Asha',
      subject: 'Welcome',
      body: 'Para one.\n\nPara two.',
    });
    const blocks = t.build(input, {
      branding: branding(false),
      now: new Date(),
      today: '2026-01-01',
    });
    expect(blocks.filter((b) => b.type === 'paragraph').length).toBeGreaterThanOrEqual(4);
    expect(blocks.at(-1)).toMatchObject({ type: 'signature', designation: 'ABBS School' });
  });
});

describe('pdfkit renderer', () => {
  const model = (logo: boolean): PdfDocumentModel => ({
    title: 'Offer letter',
    author: 'ABBS School',
    branding: branding(logo),
    blocks: [
      { type: 'heading', text: 'Subject' },
      { type: 'paragraph', text: 'Hello '.repeat(800) },
      { type: 'table', columns: ['A', 'B'], rows: [['1', '2']] },
      { type: 'signature', name: 'Principal', designation: 'Head' },
    ],
  });

  it('renders a PDF with the logo image, brand colours and page footers', async () => {
    const pdf = await new PdfKitRenderer({ compress: false }).render(model(true));
    const raw = pdf.toString('latin1');
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).toContain('/Subtype /Image');
    // Primary (#AA0000), accent (#0000AA) and secondary (#00AA00) colours are applied.
    expect(raw).toMatch(/0\.6666\d* 0 0 scn/);
    expect(raw).toMatch(/0 0 0\.6666\d* SCN/);
    expect(raw).toMatch(/0 0\.6666\d* 0 SCN/);
    // Multi-page body → "Page 2 of N" footers (kerned hex text: "P" + "age 2 of").
    expect(raw).toContain(Buffer.from('age 2 of').toString('hex'));
  });

  it('renders without a logo', async () => {
    const pdf = await new PdfKitRenderer({ compress: false }).render(model(false));
    expect(pdf.toString('latin1')).not.toContain('/Subtype /Image');
  });
});

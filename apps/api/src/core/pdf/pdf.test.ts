import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { interpolate, interpolateBlocks, type PdfBranding, type PdfDocumentModel } from './model';
import { LOGO_BOX, PdfKitRenderer } from './renderer';
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

  const A4 = { width: 595.28, height: 841.89 };
  /** Page content streams (those drawing text), in page order. */
  const pageStreams = (raw: string) => raw.split('endstream').filter((s) => / Tm\b/.test(s));
  /** Logo draws: `w 0 0 -h x y cm /In Do` (pdfkit's flipped y → top = y - h). */
  const logoDraws = (stream: string) =>
    [...stream.matchAll(/([\d.]+) 0 0 -([\d.]+) ([\d.]+) ([\d.]+) cm\s*\/(I\d+) Do/g)].map((m) => ({
      width: Number(m[1]),
      height: Number(m[2]),
      x: Number(m[3]),
      top: Number(m[4]) - Number(m[2]),
      name: m[5],
    }));
  /** Top-down y of the first text line drawn on a page. */
  const firstTextTop = (stream: string) => {
    const m = stream.match(/1 0 0 1 [\d.]+ ([\d.]+) Tm/);
    return A4.height - Number(m![1]);
  };

  it('draws the brand logo in the top-right corner of every page (embedded once)', async () => {
    const pdf = await new PdfKitRenderer({ compress: false }).render(model(true));
    const raw = pdf.toString('latin1');
    const pages = pageStreams(raw);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const page of pages) {
      const draws = logoDraws(page);
      expect(draws).toHaveLength(1);
      const [logo] = draws;
      // Right edge flush with the right margin, top edge on the top margin, within the box.
      expect(logo!.x + logo!.width).toBeCloseTo(A4.width - 50, 1);
      expect(logo!.top).toBeCloseTo(50, 1);
      expect(logo!.width).toBeLessThanOrEqual(LOGO_BOX.width);
      expect(logo!.height).toBeLessThanOrEqual(LOGO_BOX.height);
    }
    // The same image XObject is reused on every page.
    expect(new Set(pages.flatMap((p) => logoDraws(p).map((d) => d.name))).size).toBe(1);
    // Continuation pages start their body below the logo.
    for (const page of pages.slice(1)) {
      expect(firstTextTop(page)).toBeGreaterThan(50 + LOGO_BOX.height);
    }
    // Page 1 letterhead text stays on the left, clear of the logo column.
    const textXs = [...pages[0]!.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)]
      .filter((m) => A4.height - Number(m[2]) < 50 + LOGO_BOX.height)
      .map((m) => Number(m[1]));
    expect(textXs.length).toBeGreaterThan(0);
    expect(Math.max(...textXs)).toBeLessThan(A4.width - 50 - LOGO_BOX.width);
  });

  it('keeps the plain layout when there is no logo', async () => {
    const pdf = await new PdfKitRenderer({ compress: false }).render(model(false));
    const pages = pageStreams(pdf.toString('latin1'));
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const page of pages) expect(logoDraws(page)).toHaveLength(0);
    // Continuation pages use the normal top margin.
    expect(firstTextTop(pages[1]!)).toBeLessThan(50 + LOGO_BOX.height);
  });

  it('renders without the logo when the image is unreadable', async () => {
    const broken = model(true);
    broken.branding.logo = { mimeType: 'image/png', body: Buffer.from('not an image') };
    const pdf = await new PdfKitRenderer({ compress: false }).render(broken);
    const raw = pdf.toString('latin1');
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).not.toContain('/Subtype /Image');
    expect(raw).toContain(Buffer.from('age 2 of').toString('hex'));
  });

  it('breaks long tables between rows and repeats the header row', async () => {
    const rows = Array.from({ length: 70 }, (_, i) => [`Row ${i + 1}`, `${i + 1}`]);
    const pdf = await new PdfKitRenderer({ compress: false }).render({
      ...model(true),
      blocks: [{ type: 'table', columns: ['Component', 'Amount'], rows }],
    });
    const pages = pageStreams(pdf.toString('latin1'));
    // Two or three pages — not one page per cell.
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.length).toBeLessThanOrEqual(3);
    const header = Buffer.from('Component').toString('hex');
    for (const page of pages) expect(page).toContain(header);
    // Continuation pages start below the logo.
    for (const page of pages.slice(1)) {
      expect(firstTextTop(page)).toBeGreaterThan(50 + LOGO_BOX.height);
    }
  });
});

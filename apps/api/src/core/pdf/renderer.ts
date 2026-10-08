import PDFDocument from 'pdfkit';
import type { PdfBlock, PdfDocumentModel } from './model';

/** Pluggable renderer (pdfkit by default; a headless-browser HTML renderer can implement it). */
export interface PdfRenderer {
  readonly id: string;
  render(model: PdfDocumentModel): Promise<Buffer>;
}

const MARGIN = 50;
const FOOTER_HEIGHT = 40;
/** Brand logo box, anchored to the top-right corner of every page. */
export const LOGO_BOX = { width: 110, height: 55 } as const;
const LOGO_GAP = 15;
/** Top margin of continuation pages when a logo is drawn (keeps body text clear of it). */
const LOGO_TOP_MARGIN = MARGIN + LOGO_BOX.height + LOGO_GAP;

/**
 * An image decoded once by pdfkit's `openImage` (missing from @types/pdfkit) and reused on every
 * page — `doc.image()` accepts it and embeds the XObject a single time.
 */
interface OpenedImage {
  width: number;
  height: number;
}
type ImageOpener = { openImage(src: Buffer): OpenedImage };
const TEXT = '#111827';
const MUTED = '#6B7280';

/**
 * pdfkit renderer: A4 letterhead (name + contact on page 1), the brand logo in the top-right
 * corner of EVERY page, body blocks, footer + page numbers.
 */
export class PdfKitRenderer implements PdfRenderer {
  readonly id = 'pdfkit';

  constructor(private readonly options: { compress?: boolean } = {}) {}

  render(model: PdfDocumentModel): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: MARGIN + FOOTER_HEIGHT },
        bufferPages: true,
        compress: this.options.compress ?? true,
        info: {
          Title: model.title,
          ...(model.author ? { Author: model.author } : {}),
          Producer: 'ERP PDF engine',
          Creator: 'ERP PDF engine',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      try {
        const logo = this.openLogo(doc, model);
        if (logo) {
          // Continuation pages start below the logo so body content never collides with it.
          doc.on('pageAdded', () => {
            doc.page.margins.top = LOGO_TOP_MARGIN;
            doc.y = LOGO_TOP_MARGIN;
          });
        }
        this.letterhead(doc, model, logo !== null);
        for (const block of model.blocks) this.block(doc, block, model);
        this.pageDecorations(doc, model, logo);
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /** Decode the logo once; an unreadable image renders the PDF without it instead of failing. */
  private openLogo(doc: PDFKit.PDFDocument, model: PdfDocumentModel): OpenedImage | null {
    if (!model.branding.logo) return null;
    try {
      return (doc as unknown as ImageOpener).openImage(model.branding.logo.body);
    } catch {
      return null;
    }
  }

  private letterhead(doc: PDFKit.PDFDocument, model: PdfDocumentModel, hasLogo: boolean) {
    const b = model.branding;
    const width = doc.page.width - MARGIN * 2;
    const top = MARGIN;
    const textX = MARGIN;
    // Name / letterhead text / contact sit on the left, clear of the top-right logo.
    const textWidth = hasLogo ? width - LOGO_BOX.width - LOGO_GAP : width;
    doc.fillColor(b.primaryColor).font('Helvetica-Bold').fontSize(18);
    doc.text(b.displayName ?? '', textX, top, { width: textWidth });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    if (b.letterheadText) doc.text(b.letterheadText, textX, doc.y + 2, { width: textWidth });
    const contact = [b.address, b.contactPhone, b.contactEmail, b.website]
      .filter(Boolean)
      .join('  ·  ');
    if (contact) doc.text(contact, textX, doc.y + 2, { width: textWidth });
    const ruleY = Math.max(doc.y, hasLogo ? top + LOGO_BOX.height + 3 : doc.y) + 8;
    doc
      .moveTo(MARGIN, ruleY)
      .lineTo(MARGIN + width, ruleY)
      .lineWidth(2)
      .strokeColor(b.primaryColor)
      .stroke();
    doc
      .moveTo(MARGIN, ruleY + 3)
      .lineTo(MARGIN + width, ruleY + 3)
      .lineWidth(0.5)
      .strokeColor(b.accentColor)
      .stroke();
    doc.x = MARGIN;
    doc.y = ruleY + 20;
    doc.fillColor(TEXT).font('Helvetica').fontSize(11);
  }

  private block(doc: PDFKit.PDFDocument, block: PdfBlock, model: PdfDocumentModel) {
    const width = doc.page.width - MARGIN * 2;
    doc.x = MARGIN;
    switch (block.type) {
      case 'heading':
        doc.moveDown(0.4);
        doc
          .font('Helvetica-Bold')
          .fontSize(block.level === 2 ? 12 : 14)
          .fillColor(model.branding.primaryColor);
        doc.text(block.text, { width });
        doc.moveDown(0.3);
        break;
      case 'paragraph':
        doc
          .font(block.bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(11)
          .fillColor(TEXT);
        doc.text(block.text, { width, align: block.align ?? 'left', lineGap: 2 });
        doc.moveDown(0.6);
        break;
      case 'keyValue':
        for (const [label, value] of block.rows) {
          const y = doc.y;
          doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .fillColor(MUTED)
            .text(label, MARGIN, y, { width: 150 });
          const labelBottom = doc.y;
          doc
            .font('Helvetica')
            .fontSize(10)
            .fillColor(TEXT)
            .text(value, MARGIN + 160, y, { width: width - 160 });
          doc.y = Math.max(doc.y, labelBottom) + 2;
        }
        doc.x = MARGIN;
        doc.moveDown(0.5);
        break;
      case 'table': {
        const colWidth = width / Math.max(block.columns.length, 1);
        const rowHeight = (cells: string[], bold: boolean) =>
          Math.max(
            ...cells.map((cell) =>
              doc
                .font(bold ? 'Helvetica-Bold' : 'Helvetica')
                .fontSize(10)
                .heightOfString(cell, { width: colWidth - 4 }),
            ),
            0,
          ) + 6;
        const fits = (cells: string[], bold: boolean) =>
          doc.y + rowHeight(cells, bold) <= doc.page.height - doc.page.margins.bottom;
        const row = (cells: string[], bold: boolean) => {
          // Break before a row that does not fit (otherwise pdfkit would move every cell of the
          // row to its own page) and repeat the header row on the new page.
          if (!fits(cells, bold)) {
            doc.addPage();
            if (!bold) row(block.columns, true);
          }
          const y = doc.y;
          let bottom = y;
          cells.forEach((cell, i) => {
            doc
              .font(bold ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(10)
              .fillColor(bold ? model.branding.primaryColor : TEXT);
            doc.text(cell, MARGIN + i * colWidth + 2, y, { width: colWidth - 4 });
            bottom = Math.max(bottom, doc.y);
          });
          doc.y = bottom + 3;
          doc
            .moveTo(MARGIN, doc.y)
            .lineTo(MARGIN + width, doc.y)
            .lineWidth(0.5)
            .strokeColor('#E5E7EB')
            .stroke();
          doc.y += 3;
        };
        row(block.columns, true);
        for (const r of block.rows) row(r, false);
        doc.x = MARGIN;
        doc.moveDown(0.5);
        break;
      }
      case 'signature':
        doc.moveDown(2);
        doc.font('Helvetica').fontSize(10).fillColor(TEXT);
        if (block.label) doc.text(block.label, { width });
        doc.moveDown(2);
        if (block.name) doc.font('Helvetica-Bold').text(block.name, { width });
        if (block.designation)
          doc.font('Helvetica').fillColor(MUTED).text(block.designation, { width });
        doc.fillColor(TEXT);
        break;
      case 'spacer':
        doc.moveDown(block.size ?? 1);
        break;
      case 'image': {
        const w = Math.min(block.width ?? 140, width);
        if (doc.y + w + 30 > doc.page.height - MARGIN) doc.addPage();
        const x = block.align === 'left' ? MARGIN : MARGIN + (width - w) / 2;
        const y = doc.y;
        doc.image(block.data, x, y, { width: w });
        doc.y = y + w + 4;
        if (block.caption) {
          doc.font('Helvetica').fontSize(9).fillColor(MUTED);
          doc.text(block.caption, MARGIN, doc.y, {
            width,
            align: block.align === 'left' ? 'left' : 'center',
          });
        }
        doc.x = MARGIN;
        doc.moveDown(0.5);
        break;
      }
    }
  }

  /** Per-page pass over the buffered pages: top-right logo, footer rule/text, page numbers. */
  private pageDecorations(
    doc: PDFKit.PDFDocument,
    model: PdfDocumentModel,
    logo: OpenedImage | null,
  ) {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const width = doc.page.width - MARGIN * 2;
      if (logo) {
        doc.image(logo as unknown as Buffer, doc.page.width - MARGIN - LOGO_BOX.width, MARGIN, {
          fit: [LOGO_BOX.width, LOGO_BOX.height],
          align: 'right',
        });
      }
      const y = doc.page.height - MARGIN - FOOTER_HEIGHT / 2;
      doc
        .moveTo(MARGIN, y - 6)
        .lineTo(MARGIN + width, y - 6)
        .lineWidth(0.5)
        .strokeColor(model.branding.secondaryColor)
        .stroke();
      doc.font('Helvetica').fontSize(8).fillColor(MUTED);
      if (model.branding.footerText) {
        doc.text(model.branding.footerText, MARGIN, y, {
          width: width - 80,
          lineBreak: false,
          ellipsis: true,
        });
      }
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN + width - 80, y, {
        width: 80,
        align: 'right',
        lineBreak: false,
      });
      doc.page.margins.bottom = bottom;
    }
  }
}

let renderer: PdfRenderer = new PdfKitRenderer();

export const pdfRenderer = (): PdfRenderer => renderer;

/** Swap the renderer (tests, or a headless-browser renderer). `null` restores pdfkit. */
export function setPdfRenderer(next: PdfRenderer | null): void {
  renderer = next ?? new PdfKitRenderer();
}

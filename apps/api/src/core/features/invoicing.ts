import type {
  InvoiceDto,
  InvoiceLineItem,
  InvoiceUpiPaymentDto,
  PlatformBillingSettingsDto,
  PlatformBillingSettingsInput,
} from '@erp/shared';
import type { PlatformBillingSettings } from '@prisma/client';
import QRCode from 'qrcode';
import { audit } from '../audit';
import { prisma } from '../db/prisma';
import { ValidationError } from '../http/errors';
import type { PdfBlock, PdfBranding } from '../pdf/model';
import { PdfKitRenderer } from '../pdf/renderer';

/*
 * Platform invoicing helpers: seller settings (single global row), totals with GST, UPI payment
 * deep links / QR codes and the invoice PDF. Payments are manual UPI transfers: the organization
 * reports the UTR and the platform verifies it before marking the invoice PAID.
 */

const SETTINGS_ID = 'default';

const DEFAULT_SETTINGS: PlatformBillingSettingsDto = {
  sellerName: 'ERP Platform',
  sellerAddress: null,
  gstin: null,
  contactEmail: null,
  contactPhone: null,
  upiId: null,
  upiPayeeName: null,
  defaultTaxRateBps: 1800,
  invoiceTerms: null,
  updatedAt: null,
};

function toSettingsDto(row: PlatformBillingSettings | null): PlatformBillingSettingsDto {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    sellerName: row.sellerName,
    sellerAddress: row.sellerAddress,
    gstin: row.gstin,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    upiId: row.upiId,
    upiPayeeName: row.upiPayeeName,
    defaultTaxRateBps: row.defaultTaxRateBps,
    invoiceTerms: row.invoiceTerms,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getBillingSettings(): Promise<PlatformBillingSettingsDto> {
  return toSettingsDto(
    await prisma.platformBillingSettings.findUnique({ where: { id: SETTINGS_ID } }),
  );
}

export async function updateBillingSettings(input: PlatformBillingSettingsInput) {
  const before = await prisma.platformBillingSettings.findUnique({ where: { id: SETTINGS_ID } });
  const data = {
    sellerName: input.sellerName,
    sellerAddress: input.sellerAddress ?? null,
    gstin: input.gstin ?? null,
    contactEmail: input.contactEmail ?? null,
    contactPhone: input.contactPhone ?? null,
    upiId: input.upiId ?? null,
    upiPayeeName: input.upiPayeeName ?? null,
    defaultTaxRateBps: input.defaultTaxRateBps,
    invoiceTerms: input.invoiceTerms ?? null,
  };
  const after = await prisma.platformBillingSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...data },
    update: data,
  });
  await audit.record({
    action: 'platform_billing_settings.update',
    entityType: 'platform_billing_settings',
    entityId: SETTINGS_ID,
    organizationId: null,
    before: before ? toSettingsDto(before) : null,
    after: toSettingsDto(after),
  });
  return toSettingsDto(after);
}

/** Subtotal, tax and total in minor units (paise). Tax is rounded half-up once on the subtotal. */
export function invoiceTotals(lineItems: InvoiceLineItem[], taxRateBps: number) {
  const subtotalCents = lineItems.reduce((n, li) => n + Math.round(li.quantity * li.unitCents), 0);
  const taxCents = Math.round((subtotalCents * taxRateBps) / 10_000);
  return { subtotalCents, taxCents, amountCents: subtotalCents + taxCents };
}

export function formatMoney(cents: number, currency: string) {
  const value = (cents / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${value}`;
}

const fmtDate = (d: Date | string | null) =>
  d
    ? new Date(d).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '-';

/** NPCI UPI deep link (`upi://pay`). Amount is in rupees with two decimals. */
export function upiUri(
  settings: PlatformBillingSettingsDto,
  invoice: Pick<InvoiceDto, 'number' | 'amountCents' | 'currency'>,
) {
  if (!settings.upiId) return null;
  const params = new URLSearchParams({
    pa: settings.upiId,
    pn: settings.upiPayeeName || settings.sellerName,
    am: (invoice.amountCents / 100).toFixed(2),
    cu: invoice.currency,
    tn: `Invoice ${invoice.number}`,
    tr: invoice.number,
  });
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

const PAYABLE = new Set(['OPEN', 'OVERDUE']);

export async function invoiceUpiPayment(invoice: InvoiceDto): Promise<InvoiceUpiPaymentDto> {
  if (!PAYABLE.has(invoice.status))
    throw new ValidationError(`Invoice is ${invoice.status.toLowerCase()} and cannot be paid`);
  if (invoice.currency !== 'INR') throw new ValidationError('UPI payments support INR only');
  const settings = await getBillingSettings();
  const uri = upiUri(settings, invoice);
  if (!uri) throw new ValidationError('UPI payments are not configured yet. Contact support.');
  return {
    invoiceId: invoice.id,
    number: invoice.number,
    amountCents: invoice.amountCents,
    currency: invoice.currency,
    upiId: settings.upiId!,
    payeeName: settings.upiPayeeName || settings.sellerName,
    upiUri: uri,
    qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 280 }),
  };
}

export interface InvoiceBillTo {
  name: string;
  address?: string | null;
  email?: string | null;
}

/** Render the invoice PDF (seller = platform billing settings; buyer = organization). */
export async function renderInvoicePdf(
  invoice: InvoiceDto,
  billTo: InvoiceBillTo,
  planName: string | null,
) {
  const settings = await getBillingSettings();
  const branding: PdfBranding = {
    displayName: settings.sellerName,
    letterheadText: settings.gstin ? `GSTIN: ${settings.gstin}` : null,
    footerText: settings.invoiceTerms ? null : 'This is a computer-generated invoice.',
    address: settings.sellerAddress,
    contactEmail: settings.contactEmail,
    contactPhone: settings.contactPhone,
    website: null,
    primaryColor: '#1E3A8A',
    secondaryColor: '#0EA5E9',
    accentColor: '#F59E0B',
    logoFileId: null,
    logo: null,
  };
  const money = (c: number) => formatMoney(c, invoice.currency);
  const lines = invoice.lineItems.length
    ? invoice.lineItems
    : [
        {
          description: planName ? `${planName} subscription` : 'Subscription',
          quantity: 1,
          unitCents: invoice.subtotalCents || invoice.amountCents,
        },
      ];

  const blocks: PdfBlock[] = [
    { type: 'heading', text: invoice.status === 'PAID' ? 'TAX INVOICE (PAID)' : 'TAX INVOICE' },
    {
      type: 'keyValue',
      rows: [
        ['Invoice number', invoice.number],
        ['Invoice date', fmtDate(invoice.issuedAt ?? invoice.createdAt)],
        ['Billing period', `${fmtDate(invoice.periodStart)} - ${fmtDate(invoice.periodEnd)}`],
        ['Due date', fmtDate(invoice.dueAt)],
        ['Status', invoice.status.replace('_', ' ')],
      ],
    },
    { type: 'heading', level: 2, text: 'Bill to' },
    {
      type: 'paragraph',
      text: [billTo.name, billTo.address, billTo.email].filter(Boolean).join('\n'),
    },
    {
      type: 'table',
      columns: ['#', 'Description', 'Qty', 'Unit price', 'Amount'],
      rows: lines.map((li, i) => [
        String(i + 1),
        li.description,
        String(li.quantity),
        money(li.unitCents),
        money(Math.round(li.quantity * li.unitCents)),
      ]),
    },
    {
      type: 'keyValue',
      rows: [
        ['Subtotal', money(invoice.subtotalCents || invoice.amountCents - invoice.taxCents)],
        [
          `GST (${(invoice.taxRateBps / 100).toFixed(2).replace(/\.00$/, '')}%)`,
          money(invoice.taxCents),
        ],
        ['Total payable', money(invoice.amountCents)],
      ],
    },
  ];
  if (invoice.status === 'PAID') {
    blocks.push({
      type: 'paragraph',
      bold: true,
      text: `Paid on ${fmtDate(invoice.paidAt)}${invoice.paymentMethod ? ` via ${invoice.paymentMethod}` : ''}${invoice.paymentReference ? ` (Ref ${invoice.paymentReference})` : ''}.`,
    });
  } else if (PAYABLE.has(invoice.status) && invoice.currency === 'INR') {
    const uri = upiUri(settings, invoice);
    if (uri) {
      blocks.push(
        { type: 'heading', level: 2, text: 'Pay via UPI' },
        {
          type: 'paragraph',
          text: `Scan with any UPI app or pay to ${settings.upiId} (${settings.upiPayeeName || settings.sellerName}). After paying, submit the UPI transaction reference (UTR) under Settings > Subscription.`,
        },
        {
          type: 'image',
          data: await QRCode.toBuffer(uri, { margin: 1, width: 360 }),
          width: 140,
          caption: `${money(invoice.amountCents)} - ${invoice.number}`,
        },
      );
    }
  }
  if (invoice.notes)
    blocks.push(
      { type: 'heading', level: 2, text: 'Notes' },
      { type: 'paragraph', text: invoice.notes },
    );
  if (settings.invoiceTerms)
    blocks.push(
      { type: 'heading', level: 2, text: 'Terms' },
      { type: 'paragraph', text: settings.invoiceTerms },
    );

  return new PdfKitRenderer().render({
    title: `Invoice ${invoice.number}`,
    author: settings.sellerName,
    branding,
    blocks,
  });
}

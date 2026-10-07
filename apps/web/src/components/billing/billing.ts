import type { InvoiceStatus } from '@erp/shared';

export const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(cents / 100);

export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

export const invoiceStatusColor = (s: InvoiceStatus) =>
  ({
    DRAFT: 'default',
    OPEN: 'info',
    PAYMENT_SUBMITTED: 'warning',
    PAID: 'success',
    OVERDUE: 'error',
    VOID: 'default',
  })[s];

export const invoiceStatusLabel = (s: InvoiceStatus) =>
  s === 'PAYMENT_SUBMITTED' ? 'Payment submitted' : s.charAt(0) + s.slice(1).toLowerCase();

/** `YYYY-MM-DD` for date inputs. */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

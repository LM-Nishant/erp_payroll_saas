import { describe, expect, it } from 'vitest';
import {
  feeUpiSettingSchema,
  recordPaymentSchema,
  refundPaymentSchema,
  submitUpiPaymentSchema,
} from './fees';
import { collectLibraryFineSchema } from './library';

const id = '11111111-1111-4111-8111-111111111111';

describe('UPI-only fee payments', () => {
  it('defaults counter collection to UPI and requires a UTR', () => {
    expect(
      recordPaymentSchema.parse({ studentId: id, amount: 10, reference: 'UTR123456' }).mode,
    ).toBe('UPI');
    expect(recordPaymentSchema.safeParse({ studentId: id, amount: 10 }).success).toBe(false);
    for (const mode of ['CASH', 'CHEQUE', 'CARD', 'BANK_TRANSFER', 'ONLINE']) {
      expect(
        recordPaymentSchema.safeParse({ studentId: id, amount: 10, mode, reference: 'UTR123456' })
          .success,
      ).toBe(false);
    }
    expect(
      recordPaymentSchema.safeParse({ studentId: id, amount: 10, reference: 'bad utr!' }).success,
    ).toBe(false);
  });

  it('refunds only via UPI with a UTR', () => {
    expect(
      refundPaymentSchema.safeParse({ amount: 5, reference: 'UTR998877', reason: 'Excess' })
        .success,
    ).toBe(true);
    expect(
      refundPaymentSchema.safeParse({
        amount: 5,
        mode: 'CASH',
        reference: 'UTR998877',
        reason: 'x1',
      }).success,
    ).toBe(false);
  });

  it('validates UPI IDs, payer submissions and library desk collection', () => {
    const setting = { institutionId: id, payeeName: 'School' };
    expect(feeUpiSettingSchema.safeParse({ ...setting, upiId: 'school@okhdfcbank' }).success).toBe(
      true,
    );
    expect(feeUpiSettingSchema.safeParse({ ...setting, upiId: 'school' }).success).toBe(false);
    expect(
      submitUpiPaymentSchema.safeParse({ studentId: id, invoiceIds: [id], utr: '412345678901' })
        .success,
    ).toBe(true);
    expect(submitUpiPaymentSchema.safeParse({ studentId: id, invoiceIds: [id] }).success).toBe(
      false,
    );
    expect(collectLibraryFineSchema.safeParse({ note: 'paid' }).success).toBe(false);
    expect(collectLibraryFineSchema.safeParse({ utr: 'UTR123456' }).success).toBe(true);
  });
});

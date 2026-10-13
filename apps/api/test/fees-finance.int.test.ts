import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import { provisionOrganizationSubscription, syncPlanCatalog } from '../src/core/features';
import { asTenant, hasTestDatabase } from './helpers';

type Row = Array<string | number>;

describe.skipIf(!hasTestDatabase)('fees and finance', () => {
  const app = createApp();
  const t = asTenant(app, 'fees-org');
  const other = asTenant(app, 'fees-other-org');

  beforeAll(async () => {
    await syncPlanCatalog();
    for (const slug of ['fees-org', 'fees-other-org']) {
      const org = await prisma.organization.upsert({
        where: { slug },
        create: { slug, name: slug },
        update: {},
      });
      await provisionOrganizationSubscription(org.id, 'enterprise');
    }
  });
  afterAll(() => prisma.$disconnect());

  async function setup(suffix: string) {
    const group = (
      await t
        .post('/api/v1/groups', { name: `Fees Group ${suffix}`, code: `FG${suffix}` })
        .expect(201)
    ).body.data;
    const institution = (
      await t
        .post('/api/v1/institutions', {
          groupId: group.id,
          name: `Fees School ${suffix}`,
          code: `FS${suffix}`,
          type: 'SCHOOL',
        })
        .expect(201)
    ).body.data;
    const campus = (
      await t
        .post('/api/v1/campuses', { institutionId: institution.id, name: 'Main', code: 'MAIN' })
        .expect(201)
    ).body.data;
    const department = (
      await t
        .post('/api/v1/departments', {
          institutionId: institution.id,
          campusId: campus.id,
          name: 'Primary',
          code: 'PRI',
        })
        .expect(201)
    ).body.data;
    const program = (
      await t
        .post('/api/v1/programs', { departmentId: department.id, name: 'Grade 1', code: 'G1' })
        .expect(201)
    ).body.data;
    const section = (
      await t
        .post('/api/v1/class-sections', {
          programId: program.id,
          campusId: campus.id,
          name: 'Grade 1 A',
          code: 'A',
          academicYear: '2026-27',
        })
        .expect(201)
    ).body.data;
    const students = [];
    for (const firstName of ['Asha', 'Ravi']) {
      students.push(
        (
          await t
            .post('/api/v1/students', {
              classSectionId: section.id,
              academicYear: '2026-27',
              firstName,
            })
            .expect(201)
        ).body.data,
      );
    }
    return { institution, section, students };
  }

  it('runs structure → invoices → collection → receipt → refund with balanced books', async () => {
    const { institution, section, students } = await setup('1');
    const [asha, ravi] = students;
    const tuition = (
      await t
        .post('/api/v1/fees/heads', {
          institutionId: institution.id,
          code: 'TUITION',
          name: 'Tuition fee',
          category: 'TUITION',
        })
        .expect(201)
    ).body.data;
    const exam = (
      await t
        .post('/api/v1/fees/heads', {
          institutionId: institution.id,
          code: 'EXAM',
          name: 'Exam fee',
          category: 'EXAM',
        })
        .expect(201)
    ).body.data;
    await t
      .post('/api/v1/fees/concessions', {
        institutionId: institution.id,
        name: 'Merit',
        kind: 'SCHOLARSHIP',
        appliesTo: 'STUDENT',
        studentId: ravi.id,
        feeHeadId: tuition.id,
        valueType: 'PERCENT',
        value: 50,
      })
      .expect(201);
    const structure = (
      await t
        .post('/api/v1/fees/structures', {
          institutionId: institution.id,
          classSectionId: section.id,
          academicYear: '2026-27',
          code: 'G1-2026',
          name: 'Grade 1 2026-27',
          installments: [
            {
              label: 'Term 1',
              dueDate: '2025-04-10',
              items: [
                { feeHeadId: tuition.id, amount: 10000 },
                { feeHeadId: exam.id, amount: 1000 },
              ],
            },
            {
              label: 'Term 2',
              dueDate: '2099-10-10',
              items: [{ feeHeadId: tuition.id, amount: 8000 }],
            },
          ],
        })
        .expect(201)
    ).body.data;
    const gen = (
      await t.post('/api/v1/fees/invoices/generate', { structureId: structure.id }).expect(200)
    ).body.data;
    expect(gen).toMatchObject({ created: 4, skipped: 0 });
    const again = (
      await t.post('/api/v1/fees/invoices/generate', { structureId: structure.id }).expect(200)
    ).body.data;
    expect(again).toMatchObject({ created: 0, skipped: 4 });

    const raviInv = (await t.get(`/api/v1/fees/invoices?studentId=${ravi.id}`).expect(200)).body;
    const raviTerm1 = raviInv.data.find((i: { netAmount: number }) => i.netAmount === 6000);
    expect(raviTerm1).toBeTruthy();

    // generic charge API used by other modules
    const charge = (
      await t
        .post('/api/v1/fees/charges', {
          studentId: asha.id,
          feeHeadCode: 'EXAM',
          amount: 250,
          dueDate: '2099-01-01',
          sourceType: 'LIBRARY_FINE',
          sourceId: 'loan-1',
        })
        .expect(201)
    ).body.data;
    expect(charge.netAmount).toBe(250);

    const payment = (
      await t
        .post('/api/v1/fees/payments', {
          studentId: asha.id,
          amount: 5000,
          reference: 'utr100200300',
        })
        .expect(201)
    ).body.data;
    expect(payment.allocatedAmount).toBe(5000);
    expect(payment.mode).toBe('UPI');
    expect(payment.reference).toBe('UTR100200300');
    // UPI only: no cash / cheque, UTR mandatory and unique
    await t
      .post('/api/v1/fees/payments', {
        studentId: asha.id,
        amount: 10,
        mode: 'CASH',
        reference: 'UTR999999',
      })
      .expect(400);
    await t.post('/api/v1/fees/payments', { studentId: asha.id, amount: 10 }).expect(400);
    await t
      .post('/api/v1/fees/payments', { studentId: asha.id, amount: 10, reference: 'UTR100200300' })
      .expect(409);
    const ashaTerm1 = (await t.get(`/api/v1/fees/invoices?studentId=${asha.id}&status=PARTIAL`))
      .body.data;
    expect(ashaTerm1).toHaveLength(1);
    expect(ashaTerm1[0].paidAmount).toBe(5000);

    const pdf = await t.get(`/api/v1/fees/payments/${payment.id}/receipt`).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');

    const refunded = (
      await t
        .post(`/api/v1/fees/payments/${payment.id}/refund`, {
          amount: 1000,
          reference: 'UTRREFUND001',
          reason: 'Excess paid',
        })
        .expect(200)
    ).body.data;
    expect(refunded.refundedAmount).toBe(1000);

    const defaulters = (
      await t.get(`/api/v1/fees/defaulters?institutionId=${institution.id}`).expect(200)
    ).body;
    expect(defaulters.meta.total).toBe(2);

    // UPI "pay now": institution UPI ID → QR → payer reports UTR → accountant verifies
    await t
      .post('/api/v1/fees/upi/intent', { studentId: ravi.id, invoiceIds: [raviTerm1.id] })
      .expect(409);
    await t
      .put('/api/v1/fees/upi/settings', {
        institutionId: institution.id,
        upiId: 'bad id',
        payeeName: 'Fees School',
      })
      .expect(400);
    const setting = (
      await t
        .put('/api/v1/fees/upi/settings', {
          institutionId: institution.id,
          upiId: 'feesschool@okhdfcbank',
          payeeName: 'Fees School 1',
        })
        .expect(200)
    ).body.data;
    expect(setting).toMatchObject({ upiId: 'feesschool@okhdfcbank', active: true });
    const settings = (await t.get('/api/v1/fees/upi/settings').expect(200)).body.data;
    expect(settings).toHaveLength(1);
    expect((await other.get('/api/v1/fees/upi/settings').expect(200)).body.data).toHaveLength(0);

    const intent = (
      await t
        .post('/api/v1/fees/upi/intent', { studentId: ravi.id, invoiceIds: [raviTerm1.id] })
        .expect(200)
    ).body.data;
    expect(intent).toMatchObject({ upiId: 'feesschool@okhdfcbank', amount: 6000 });
    expect(intent.upiUri).toMatch(/^upi:\/\/pay\?pa=feesschool%40okhdfcbank/);
    expect(intent.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    await t
      .post('/api/v1/fees/upi/payments', {
        studentId: ravi.id,
        invoiceIds: [raviTerm1.id],
        utr: 'UTR100200300',
      })
      .expect(409);
    await t
      .post('/api/v1/fees/upi/payments', {
        studentId: ravi.id,
        invoiceIds: [raviTerm1.id],
        utr: 'UTR777888999',
        paidOn: '2099-01-01',
      })
      .expect(400);
    const wrong = (
      await t
        .post('/api/v1/fees/upi/payments', {
          studentId: ravi.id,
          invoiceIds: [raviTerm1.id],
          utr: 'utr555000111',
        })
        .expect(201)
    ).body.data;
    expect(wrong).toMatchObject({ status: 'PENDING', amount: 6000, utr: 'UTR555000111' });
    await t
      .post('/api/v1/fees/upi/payments', {
        studentId: ravi.id,
        invoiceIds: [raviTerm1.id],
        utr: 'UTR555000222',
      })
      .expect(409);
    await t.post(`/api/v1/fees/upi/payments/${wrong.id}/reject`, { reason: 'x' }).expect(400);
    const rejected = (
      await t
        .post(`/api/v1/fees/upi/payments/${wrong.id}/reject`, { reason: 'UTR not in statement' })
        .expect(200)
    ).body.data;
    expect(rejected.status).toBe('REJECTED');
    await t.post(`/api/v1/fees/upi/payments/${wrong.id}/verify`, {}).expect(409);

    const upi = (
      await t
        .post('/api/v1/fees/upi/payments', {
          studentId: ravi.id,
          invoiceIds: [raviTerm1.id],
          utr: 'UTR555000333',
        })
        .expect(201)
    ).body.data;
    const pending = (await t.get('/api/v1/fees/upi/payments?status=PENDING').expect(200)).body;
    expect(pending.data.map((r: { id: string }) => r.id)).toEqual([upi.id]);
    await other.post(`/api/v1/fees/upi/payments/${upi.id}/verify`, {}).expect(404);
    const verified = (await t.post(`/api/v1/fees/upi/payments/${upi.id}/verify`, {}).expect(200))
      .body.data;
    expect(verified.status).toBe('VERIFIED');
    expect(verified.receiptNumber).toBeTruthy();
    await t.post(`/api/v1/fees/upi/payments/${upi.id}/verify`, {}).expect(409);
    const summary = (await t.get(`/api/v1/fees/students/${ravi.id}/summary`).expect(200)).body.data;
    expect(summary.upi).toMatchObject({ upiId: 'feesschool@okhdfcbank' });
    expect(summary.upiPayments).toHaveLength(2);
    const paid = (await t.get(`/api/v1/fees/invoices/${raviTerm1.id}`).expect(200)).body.data;
    expect(paid.status).toBe('PAID');

    const tb = (await t.get('/api/v1/finance/reports/trial_balance').expect(200)).body.data;
    const total = tb.rows.at(-1) as Row;
    expect(total[1]).toBe('Total');
    expect(total[3]).toBe(total[4]);
    expect(Number(total[3])).toBeGreaterThan(0);

    const accounts = (await t.get('/api/v1/finance/accounts').expect(200)).body.data as Array<{
      id: string;
      isGroup: boolean;
    }>;
    const [a, b] = accounts.filter((x) => !x.isGroup);
    await t
      .post('/api/v1/finance/vouchers', {
        institutionId: institution.id,
        voucherDate: '2026-05-01',
        type: 'JOURNAL',
        narration: 'Unbalanced',
        lines: [
          { accountId: a?.id, debit: 100, credit: 0 },
          { accountId: b?.id, debit: 0, credit: 90 },
        ],
      })
      .expect(400);

    // tenant isolation: the other organization sees none of it
    await other.get(`/api/v1/fees/invoices/${raviTerm1.id}`).expect(404);
    await other.get(`/api/v1/fees/payments/${payment.id}`).expect(404);
    expect((await other.get('/api/v1/fees/invoices').expect(200)).body.meta.total).toBe(0);
    await other
      .post('/api/v1/fees/payments', { studentId: asha.id, amount: 10, reference: 'UTR1234567' })
      .expect(404);
  });
});

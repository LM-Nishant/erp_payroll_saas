// Academic operations for the demo: student attendance, exams, fees and finance.
import { ACADEMIC_YEAR, AY_START, TODAY, addDays, all, bump, dow, rand, step } from './lib.mjs';

/** Mark student attendance for the last `days` school days (all sections). */
export async function seedStudentAttendance(ctx, sections, days = 10) {
  let done = 0;
  for (let back = days + 4; back >= 0 && done < days; back--) {
    const date = addDays(TODAY, -back);
    if (dow(date) === 0) continue;
    for (const sec of sections) {
      const sheet = (
        await ctx.api('GET', `/student-attendance/section?classSectionId=${sec.id}&date=${date}`)
      ).data;
      if (!sheet.rows.length || sheet.rows.every((r) => r.status)) continue;
      await ctx.api('POST', '/student-attendance', {
        classSectionId: sec.id,
        date,
        records: sheet.rows.map((r) => {
          const x = rand(r.studentId, date);
          return {
            studentId: r.studentId,
            status: x < 0.06 ? 'ABSENT' : x < 0.1 ? 'LATE' : 'PRESENT',
          };
        }),
        notifyGuardians: false,
      });
      bump('student_attendance_sheets');
    }
    done++;
  }
}

const GRADES = [
  { grade: 'A1', minPercent: 91, points: 10, isPass: true },
  { grade: 'A2', minPercent: 81, points: 9, isPass: true },
  { grade: 'B1', minPercent: 71, points: 8, isPass: true },
  { grade: 'B2', minPercent: 61, points: 7, isPass: true },
  { grade: 'C1', minPercent: 51, points: 6, isPass: true },
  { grade: 'C2', minPercent: 41, points: 5, isPass: true },
  { grade: 'D', minPercent: 33, points: 4, isPass: true },
  { grade: 'E', minPercent: 0, points: 0, isPass: false },
];

/** A published unit test (marks entered, locked, computed) + an upcoming half-yearly term. */
export async function seedExams(ctx, inst, classes) {
  const scale = (
    await ctx.api('POST', '/exams/grading-scales', {
      institutionId: inst.id,
      name: 'CBSE 10-point',
      bands: GRADES,
      isDefault: true,
    })
  ).data;
  const utStart = addDays(TODAY, -40);
  const ut = (
    await ctx.api('POST', '/exams/terms', {
      institutionId: inst.id,
      name: 'Unit Test 1',
      type: 'UNIT_TEST',
      academicYear: ACADEMIC_YEAR,
      startDate: utStart,
      endDate: addDays(utStart, 10),
      gradingScaleId: scale.id,
    })
  ).data;
  const hyStart = addDays(TODAY, 30);
  const hy = (
    await ctx.api('POST', '/exams/terms', {
      institutionId: inst.id,
      name: 'Half Yearly Examination',
      type: 'MID_TERM',
      academicYear: ACADEMIC_YEAR,
      startDate: hyStart,
      endDate: addDays(hyStart, 12),
      gradingScaleId: scale.id,
    })
  ).data;
  const schedule = async (term, start, maxMarks, passMarks) => {
    for (const cls of classes) {
      for (const sec of cls.sections) {
        let d = start;
        const schedules = [];
        for (const s of cls.subjects) {
          while (dow(d) === 0) d = addDays(d, 1);
          schedules.push({
            classSectionId: sec.id,
            subjectId: s.id,
            examDate: d,
            startTime: '09:30',
            endTime: maxMarks > 50 ? '12:30' : '10:30',
            maxMarks,
            passMarks,
          });
          d = addDays(d, 1);
        }
        await ctx.api('PUT', `/exams/terms/${term.id}/schedules`, { schedules });
      }
    }
  };
  await schedule(ut, utStart, 25, 9);
  await step(`${ctx.slug} half-yearly schedule`, () => schedule(hy, hyStart, 80, 27));
  for (const cls of classes) {
    for (const sec of cls.sections) {
      const papers = (
        await ctx.api('GET', `/exams/terms/${ut.id}/schedules?classSectionId=${sec.id}`)
      ).data;
      for (const paper of papers) {
        const sheet = (await ctx.api('GET', `/exams/schedules/${paper.id}/marks`)).data;
        if (sheet.rows.length) {
          await ctx.api('PUT', `/exams/schedules/${paper.id}/marks`, {
            marks: sheet.rows.map((r) => {
              const ability = 0.4 + rand(r.studentId, 'ability') * 0.5;
              const pct = Math.min(
                1,
                Math.max(0.15, ability + (rand(r.studentId, paper.id) - 0.5) * 0.2),
              );
              return {
                studentId: r.studentId,
                marks: Math.round(pct * paper.maxMarks),
                isAbsent: false,
              };
            }),
          });
        }
        await ctx.api('POST', `/exams/schedules/${paper.id}/lock`, { locked: true });
        bump('exam_papers_marked');
      }
    }
  }
  await ctx.api('POST', `/exams/terms/${ut.id}/compute`, {});
  await ctx.api('POST', `/exams/terms/${ut.id}/publish`);
  bump('exam_terms_published');
}

const HEADS = [
  { code: 'TUITION', name: 'Tuition fee', category: 'TUITION', sortOrder: 1 },
  { code: 'ADMISSION', name: 'Admission & registration', category: 'ADMISSION', sortOrder: 2 },
  { code: 'EXAM', name: 'Examination fee', category: 'EXAM', sortOrder: 3 },
  { code: 'LIBRARY', name: 'Library fee', category: 'LIBRARY', sortOrder: 4 },
  { code: 'TRANSPORT', name: 'Transport fee', category: 'TRANSPORT', sortOrder: 5 },
  { code: 'ACTIVITY', name: 'Activities & sports', category: 'MISC', sortOrder: 6 },
];

/** Fee heads, late rule, a sibling concession, per-section structures, invoices and payments. */
export async function seedFees(ctx, inst, sections, { tuition = 15000 } = {}) {
  const heads = {};
  for (const h of HEADS) {
    heads[h.code] = (await ctx.api('POST', '/fees/heads', { institutionId: inst.id, ...h })).data;
  }
  const rule = (
    await ctx.api('POST', '/fees/late-rules', {
      institutionId: inst.id,
      name: 'Standard late fee',
      mode: 'PER_DAY',
      amount: 10,
      graceDays: 7,
      maxAmount: 500,
    })
  ).data;
  await step(`${ctx.slug} concession`, () =>
    ctx.api('POST', '/fees/concessions', {
      institutionId: inst.id,
      academicYear: ACADEMIC_YEAR,
      name: 'Sibling discount 10%',
      kind: 'SIBLING',
      appliesTo: 'SIBLING',
      feeHeadId: heads.TUITION.id,
      valueType: 'PERCENT',
      value: 10,
      reason: 'Second and later children of the same guardian',
    }),
  );
  const item = (c, amount) => ({ feeHeadId: heads[c].id, amount });
  const y = Number(ACADEMIC_YEAR.slice(0, 4));
  for (const sec of sections) {
    const structure = (
      await ctx.api('POST', '/fees/structures', {
        institutionId: inst.id,
        classSectionId: sec.id,
        academicYear: ACADEMIC_YEAR,
        code: `FS-${sec.code}`.slice(0, 32),
        name: `${sec.name} fees ${ACADEMIC_YEAR}`,
        lateRuleId: rule.id,
        installments: [
          {
            label: 'Term 1',
            dueDate: `${y}-06-15`,
            items: [
              item('TUITION', tuition),
              item('ADMISSION', 2000),
              item('LIBRARY', 800),
              item('ACTIVITY', 1500),
            ],
          },
          {
            label: 'Term 2',
            dueDate: `${y}-09-15`,
            items: [item('TUITION', tuition), item('EXAM', 1200)],
          },
          {
            label: 'Term 3',
            dueDate: `${y + 1}-01-15`,
            items: [item('TUITION', tuition), item('EXAM', 1200)],
          },
        ],
      })
    ).data;
    bump('fee_structures');
    const gen = (
      await ctx.api('POST', '/fees/invoices/generate', {
        structureId: structure.id,
        issueDate: AY_START,
      })
    ).data;
    bump('fee_invoices', gen.created ?? 0);
  }
  const invoices = await all(ctx.api, `/fees/invoices?institutionId=${inst.id}`);
  const byStudent = new Map();
  for (const inv of invoices)
    byStudent.set(inv.studentId, [...(byStudent.get(inv.studentId) ?? []), inv]);
  const modes = ['UPI', 'CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD'];
  let k = 0;
  for (const [studentId, list] of byStudent) {
    k++;
    if (k % 4 === 0) continue; // defaulters
    list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const amount = k % 3 === 0 ? list[0].balance : list[0].balance + (list[1]?.balance ?? 0);
    if (amount <= 0) continue;
    const mode = modes[k % modes.length];
    const paidOn = k % 3 === 0 ? `${y}-06-10` : `${y}-09-10`;
    await ctx.api('POST', '/fees/payments', {
      studentId,
      amount,
      paidOn,
      mode,
      reference: mode === 'CASH' ? null : `TXN${String(700000 + k * 913)}`,
      bankName: mode === 'CHEQUE' ? 'State Bank of India' : null,
      instrumentDate: mode === 'CHEQUE' ? paidOn : null,
      remarks: 'Collected at fee counter',
    });
    bump('fee_payments');
  }
}

/** Vendors, expenses and manual journal vouchers on the default chart of accounts. */
export async function seedFinance(ctx, inst) {
  const accounts = (await ctx.api('GET', '/finance/accounts')).data;
  const sys = (key) => accounts.find((a) => a.systemKey === key);
  const vendor = async (suffix, name, extra) =>
    (
      await ctx.api('POST', '/finance/vendors', {
        institutionId: inst.id,
        code: `${inst.code}-${suffix}`.slice(0, 32),
        name,
        ...extra,
      })
    ).data;
  const v1 = await vendor('STAT', 'Sri Lakshmi Stationers', {
    gstin: '29ABCDE1234F1Z5',
    phone: '+91 9845012345',
  });
  const v2 = await vendor('ELEC', 'BESCOM Electricity', { phone: '+91 8022873333' });
  bump('vendors', 2);
  const y = Number(ACADEMIC_YEAR.slice(0, 4));
  const expenses = [
    [v1, sys('admin_expense'), 18450, `${y}-08-05`, 'Exam answer booklets & stationery'],
    [v2, sys('utilities'), 42300, `${y}-09-11`, 'Electricity bill'],
    [
      null,
      sys('general_expense') ?? sys('admin_expense'),
      12500,
      `${y}-08-15`,
      'Independence Day celebration',
    ],
  ];
  for (const [i, [v, acct, amount, date, description]] of expenses.entries()) {
    if (!acct) continue;
    await ctx.api('POST', '/finance/expenses', {
      institutionId: inst.id,
      expenseDate: date,
      vendorId: v?.id ?? null,
      expenseAccountId: acct.id,
      amount,
      mode: v ? 'BANK_TRANSFER' : 'CASH',
      reference: `${inst.code}-EXP-${i + 1}`,
      description,
    });
    bump('expenses');
  }
  const bank = sys('bank');
  const fund = sys('corpus_fund');
  const cash = sys('cash');
  if (bank && fund) {
    await ctx.api('POST', '/finance/vouchers', {
      institutionId: inst.id,
      post: true,
      narration: 'Opening balance - corpus fund',
      type: 'JOURNAL',
      voucherDate: AY_START,
      lines: [
        { accountId: bank.id, debit: 500000, credit: 0 },
        { accountId: fund.id, debit: 0, credit: 500000 },
      ],
    });
    bump('vouchers');
  }
  if (bank && cash) {
    await ctx.api('POST', '/finance/vouchers', {
      institutionId: inst.id,
      post: true,
      narration: 'Cash deposited into bank',
      type: 'CONTRA',
      voucherDate: `${y}-07-01`,
      lines: [
        { accountId: bank.id, debit: 50000, credit: 0 },
        { accountId: cash.id, debit: 0, credit: 50000 },
      ],
    });
    bump('vouchers');
  }
}

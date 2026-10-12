// Student records demo: previous-school history plus issued transfer / character certificates.
import { TODAY, addDays, bump } from './lib.mjs';

const PREVIOUS = [
  {
    schoolName: 'St. Joseph Convent School',
    board: 'CBSE',
    location: 'Mysuru',
    marksPercent: 91.2,
  },
  { schoolName: 'Little Angels Primary', board: 'State Board', location: 'Hubballi', grade: 'A' },
  { schoolName: 'Kendriya Vidyalaya No. 2', board: 'CBSE', location: 'Chennai', marksPercent: 84 },
  { schoolName: 'Delhi Public School', board: 'CBSE', location: 'Pune', marksPercent: 88.6 },
];

/**
 * Previous schools for the first few students, a character certificate for the portal student
 * and a transfer certificate (fee dues waived) for the last student, who becomes WITHDRAWN.
 * Idempotent: existing records / certificates are left alone.
 */
export async function seedStudentRecords(ctx, students) {
  const withPrevious = [0, 1, 2, students.length - 1].map((i) => students[i]).filter(Boolean);
  for (const [i, s] of withPrevious.entries()) {
    const existing = (await ctx.api('GET', `/students/${s.id}/previous-schools`)).data;
    if (existing.length) continue;
    const p = PREVIOUS[i % PREVIOUS.length];
    await ctx.api('POST', `/students/${s.id}/previous-schools`, {
      ...p,
      lastClass: 'Grade 1',
      lastAcademicYear: '2024-25',
      tcNumber: `OLD/TC/${2025}/${String(101 + i)}`,
      tcDate: '2025-03-31',
      remarks: 'Transferred on parent relocation',
    });
    bump('previous schools');
  }

  const issueOnce = async (student, body) => {
    const certs = (await ctx.api('GET', `/students/${student.id}/certificates`)).data;
    if (certs.some((c) => c.type === body.type && c.status === 'ISSUED')) return;
    await ctx.api('POST', `/students/${student.id}/certificates`, body);
    bump('certificates');
  };
  await issueOnce(students[0], {
    type: 'CHARACTER',
    conduct: 'Very good',
    remarks: 'Sincere and well behaved; active in the school choir.',
  });
  const leaver = students[students.length - 1];
  if (leaver && leaver !== students[0]) {
    await issueOnce(leaver, {
      type: 'TRANSFER',
      leavingDate: addDays(TODAY, -2),
      reason: 'Family relocation to Hyderabad',
      conduct: 'Good',
      promotionStatus: 'Qualified for promotion',
      waiveFeeDues: true,
      waiverReason: 'Dues settled through the trust scholarship (demo)',
    });
    await issueOnce(leaver, {
      type: 'CHARACTER',
      issueDate: addDays(TODAY, -2),
      conduct: 'Good',
    });
  }
}

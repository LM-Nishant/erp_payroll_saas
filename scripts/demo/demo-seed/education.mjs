// Composite academic seeding for one institution: classes, students, teaching, attendance, exams, fees.
import { seedExams, seedFees, seedStudentAttendance } from './academic.mjs';
import { ensureClasses, ensureStudents, ensureTeaching } from './core.mjs';
import { step } from './lib.mjs';

export async function academicOps(ctx, inst, dept, campus, opts) {
  const label = `${ctx.slug}/${inst.code}`;
  const classes =
    (await step(`${label} classes`, () =>
      ensureClasses(ctx, inst, dept, campus, {
        prefix: opts.prefix,
        grades: opts.grades,
        sections: opts.sections,
      }),
    )) ?? [];
  const sections = classes.flatMap((c) => c.sections);
  const students =
    (await step(`${label} students`, () =>
      ensureStudents(ctx, sections, opts.students, { seed: opts.seed, special: opts.special }),
    )) ?? [];
  if (opts.teacherIds?.length) {
    await step(`${label} teaching`, () => ensureTeaching(ctx, inst, classes, opts.teacherIds));
  }
  await step(`${label} student attendance`, () => seedStudentAttendance(ctx, sections, 10));
  if (opts.exams) await step(`${label} exams`, () => seedExams(ctx, inst, classes));
  if (opts.fees) await step(`${label} fees`, () => seedFees(ctx, inst, sections, opts.fees));
  return { classes, sections, students };
}

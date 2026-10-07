import type { Prisma } from '@prisma/client';
import { tenantDb } from '../../core/tenancy';

/*
 * Student performance / at-risk signals. Today only students-module data exists (status,
 * enrollment history, guardian/contact completeness). Exams / student-attendance modules plug
 * in more signals with `registerStudentInsightSource` from their registrations file; sources
 * receive the ALREADY SCOPED student where-clause and must not widen it.
 */

export interface StudentInsightContribution {
  signals?: { label: string; value: string }[];
  /** Per-student reasons (studentId → reasons). */
  flags?: Map<string, string[]>;
}

export interface StudentInsightSource {
  key: string;
  label: string;
  collect(scopedWhere: Prisma.StudentWhereInput): Promise<StudentInsightContribution | null>;
}

const sources = new Map<string, StudentInsightSource>();

export function registerStudentInsightSource(source: StudentInsightSource): void {
  sources.set(source.key, source);
}

const MAX_STUDENTS = 5_000;

export interface StudentInsightFacts {
  totals: { total: number; active: number; byStatus: Record<string, number> };
  signals: { label: string; value: string }[];
  atRisk: { studentId: string; name: string; admissionNo: string; reasons: string[] }[];
  topReasons: { reason: string; count: number }[];
  dataSources: string[];
}

export async function collectStudentInsightSignals(
  where: Prisma.StudentWhereInput,
): Promise<StudentInsightFacts> {
  const db = tenantDb();
  const byStatusRows = await db.student.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  });
  const byStatus: Record<string, number> = {};
  for (const r of byStatusRows) byStatus[r.status] = r._count._all;
  const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
  const active = byStatus.ACTIVE ?? 0;

  const students = await db.student.findMany({
    where: { AND: [where, { status: 'ACTIVE' }] },
    select: { id: true, displayName: true, admissionNo: true, phone: true, email: true },
    orderBy: { admissionNo: 'asc' },
    take: MAX_STUDENTS,
  });
  const ids = students.map((s) => s.id);
  const [guardianLinks, detained] = await Promise.all([
    db.studentGuardian.groupBy({
      by: ['studentId'],
      where: { studentId: { in: ids } },
      _count: { _all: true },
    }),
    db.studentEnrollment.findMany({
      where: { studentId: { in: ids }, status: 'DETAINED' },
      select: { studentId: true, academicYear: true },
    }),
  ]);
  const withGuardian = new Set(guardianLinks.map((g) => g.studentId));
  const detainedBy = new Map<string, string[]>();
  for (const d of detained) {
    detainedBy.set(d.studentId, [...(detainedBy.get(d.studentId) ?? []), d.academicYear]);
  }

  const flags = new Map<string, string[]>();
  const flag = (id: string, reason: string) => flags.set(id, [...(flags.get(id) ?? []), reason]);
  let noContact = 0;
  for (const s of students) {
    if (!withGuardian.has(s.id)) flag(s.id, 'No guardian linked');
    if (!s.phone && !s.email) {
      noContact += 1;
      flag(s.id, 'No contact details');
    }
    const years = detainedBy.get(s.id);
    if (years) flag(s.id, `Detained earlier (${years.join(', ')})`);
  }

  const signals = [
    { label: 'Active students', value: String(active) },
    {
      label: 'Withdrawn / inactive',
      value: String((byStatus.WITHDRAWN ?? 0) + (byStatus.INACTIVE ?? 0)),
    },
    { label: 'Previously detained', value: String(detainedBy.size) },
    { label: 'Without a linked guardian', value: String(ids.length - withGuardian.size) },
    { label: 'Without contact details', value: String(noContact) },
  ];
  const dataSources = ['student records', 'enrollment history', 'guardian links'];

  for (const source of sources.values()) {
    const extra = await source.collect(where);
    if (!extra) continue;
    dataSources.push(source.label);
    signals.push(...(extra.signals ?? []));
    for (const [id, reasons] of extra.flags ?? []) {
      if (!ids.includes(id)) continue;
      for (const r of reasons) flag(id, r);
    }
  }

  const byId = new Map(students.map((s) => [s.id, s]));
  const atRisk = [...flags.entries()]
    .map(([id, reasons]) => {
      const s = byId.get(id)!;
      return { studentId: id, name: s.displayName, admissionNo: s.admissionNo, reasons };
    })
    .sort(
      (a, b) => b.reasons.length - a.reasons.length || a.admissionNo.localeCompare(b.admissionNo),
    );

  const reasonCounts = new Map<string, number>();
  for (const r of atRisk) {
    for (const reason of r.reasons) {
      const key = reason.replace(/\s*\(.*\)$/, '');
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
  }
  const topReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { totals: { total, active, byStatus }, signals, atRisk, topReasons, dataSources };
}

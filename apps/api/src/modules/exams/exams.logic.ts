import type { GradeBand } from '@erp/shared';

/** Pure grading / result computation (no I/O). */

export const DEFAULT_GRADE_BANDS: GradeBand[] = [
  { grade: 'A1', minPercent: 91, points: 10, isPass: true },
  { grade: 'A2', minPercent: 81, points: 9, isPass: true },
  { grade: 'B1', minPercent: 71, points: 8, isPass: true },
  { grade: 'B2', minPercent: 61, points: 7, isPass: true },
  { grade: 'C1', minPercent: 51, points: 6, isPass: true },
  { grade: 'C2', minPercent: 41, points: 5, isPass: true },
  { grade: 'D', minPercent: 33, points: 4, isPass: true },
  { grade: 'E', minPercent: 0, points: 0, isPass: false },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Highest band whose minPercent ≤ percent (bands may be given in any order). */
export function gradeFor(percent: number, bands: readonly GradeBand[]): GradeBand | null {
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  return sorted.find((b) => percent >= b.minPercent) ?? null;
}

export interface SubjectMarkInput {
  subjectId: string;
  code: string;
  name: string;
  maxMarks: number;
  passMarks: number;
  credits?: number | null;
  /** null = not entered */
  marks: number | null;
  isAbsent: boolean;
}

export interface SubjectResult extends SubjectMarkInput {
  grade: string | null;
  points: number | null;
  passed: boolean;
}

export interface StudentResult {
  totalMarks: number;
  maxTotal: number;
  percentage: number;
  grade: string | null;
  gpa: number | null;
  passed: boolean;
  subjects: SubjectResult[];
}

/**
 * Compute one student's term result. A subject is passed when marks ≥ passMarks (absent or
 * missing marks fail). GPA = credit-weighted mean of subject grade points (credits default 1).
 */
export function computeStudentResult(
  subjects: readonly SubjectMarkInput[],
  bands: readonly GradeBand[],
): StudentResult {
  let total = 0;
  let maxTotal = 0;
  let weighted = 0;
  let creditSum = 0;
  const rows: SubjectResult[] = subjects.map((s) => {
    const marks = s.isAbsent ? 0 : (s.marks ?? 0);
    total += marks;
    maxTotal += s.maxMarks;
    const pct = s.maxMarks > 0 ? (marks / s.maxMarks) * 100 : 0;
    const band = gradeFor(pct, bands);
    const credits = s.credits && s.credits > 0 ? s.credits : 1;
    weighted += (band?.points ?? 0) * credits;
    creditSum += credits;
    const passed = !s.isAbsent && s.marks !== null && s.marks >= s.passMarks;
    return { ...s, grade: band?.grade ?? null, points: band?.points ?? null, passed };
  });
  const percentage = maxTotal > 0 ? round2((total / maxTotal) * 100) : 0;
  const band = gradeFor(percentage, bands);
  return {
    totalMarks: round2(total),
    maxTotal,
    percentage,
    grade: band?.grade ?? null,
    gpa: creditSum > 0 ? round2(weighted / creditSum) : null,
    passed: rows.length > 0 && rows.every((r) => r.passed) && (band?.isPass ?? true),
    subjects: rows,
  };
}

/**
 * Competition ranking ("1224") by percentage, descending. Only passed students are ranked
 * when `passedOnly` (failed students get null).
 */
export function rankResults<T extends { percentage: number; passed: boolean }>(
  results: readonly T[],
  passedOnly = false,
): (number | null)[] {
  const order = results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !passedOnly || r.passed)
    .sort((a, b) => b.r.percentage - a.r.percentage);
  const ranks: (number | null)[] = results.map(() => null);
  order.forEach(({ r, i }, pos) => {
    const prev = order[pos - 1];
    ranks[i] = prev && prev.r.percentage === r.percentage ? ranks[prev.i]! : pos + 1;
  });
  return ranks;
}

/** CGPA = mean of term GPAs (ignores nulls). */
export function cumulativeGpa(gpas: readonly (number | null)[]): number | null {
  const values = gpas.filter((g): g is number => g !== null);
  return values.length ? round2(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

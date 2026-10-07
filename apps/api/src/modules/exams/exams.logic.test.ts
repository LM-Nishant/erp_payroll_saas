import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRADE_BANDS,
  computeStudentResult,
  cumulativeGpa,
  gradeFor,
  rankResults,
} from './exams.logic';

const subject = (code: string, marks: number | null, isAbsent = false) => ({
  subjectId: code,
  code,
  name: code,
  maxMarks: 50,
  passMarks: 17,
  marks,
  isAbsent,
});

describe('gradeFor', () => {
  it('picks the highest band at or below the percentage', () => {
    expect(gradeFor(91, DEFAULT_GRADE_BANDS)?.grade).toBe('A1');
    expect(gradeFor(90.99, DEFAULT_GRADE_BANDS)?.grade).toBe('A2');
    expect(gradeFor(0, DEFAULT_GRADE_BANDS)?.grade).toBe('E');
  });
});

describe('computeStudentResult', () => {
  it('totals marks, grades and averages grade points', () => {
    const r = computeStudentResult([subject('MATH', 46), subject('SCI', 36)], DEFAULT_GRADE_BANDS);
    expect(r).toMatchObject({ totalMarks: 82, maxTotal: 100, percentage: 82, grade: 'A2' });
    expect(r.subjects.map((s) => s.grade)).toEqual(['A1', 'B1']);
    expect(r.gpa).toBe(9);
    expect(r.passed).toBe(true);
  });

  it('fails a student who is absent or below pass marks in any subject', () => {
    expect(
      computeStudentResult([subject('A', 45), subject('B', 10)], DEFAULT_GRADE_BANDS).passed,
    ).toBe(false);
    const absent = computeStudentResult(
      [subject('A', 45), subject('B', null, true)],
      DEFAULT_GRADE_BANDS,
    );
    expect(absent.passed).toBe(false);
    expect(absent.totalMarks).toBe(45);
  });

  it('weights GPA by credits', () => {
    const r = computeStudentResult(
      [
        { ...subject('A', 50), credits: 3 },
        { ...subject('B', 20), credits: 1 },
      ],
      DEFAULT_GRADE_BANDS,
    );
    // A: 100% → 10 pts × 3 credits; B: 40% → D (4 pts) × 1 credit → 34 / 4
    expect(r.gpa).toBe(8.5);
  });
});

describe('rankResults', () => {
  it('uses competition ranking with ties', () => {
    const ranks = rankResults([
      { percentage: 70, passed: true },
      { percentage: 90, passed: true },
      { percentage: 70, passed: true },
      { percentage: 50, passed: false },
    ]);
    expect(ranks).toEqual([2, 1, 2, 4]);
  });

  it('skips failed students when passedOnly', () => {
    expect(
      rankResults(
        [
          { percentage: 95, passed: false },
          { percentage: 60, passed: true },
        ],
        true,
      ),
    ).toEqual([null, 1]);
  });
});

describe('cumulativeGpa', () => {
  it('averages non-null GPAs', () => {
    expect(cumulativeGpa([8, 9, null])).toBe(8.5);
    expect(cumulativeGpa([])).toBeNull();
  });
});

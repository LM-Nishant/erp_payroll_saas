import { describe, expect, it } from 'vitest';
import { findPayrollOutliers, percentChange, type RunEmployeeLike } from './ai.logic';
import { extractSubject } from './ai.tools';
import { __test } from './ai.service';

const emp = (id: string, net: number, extra: Partial<RunEmployeeLike> = {}): RunEmployeeLike => ({
  employeeId: id,
  employeeCode: id.toUpperCase(),
  employeeName: `Employee ${id}`,
  status: 'OK',
  net,
  lopDays: 0,
  warnings: [],
  ...extra,
});

describe('payroll anomaly detection', () => {
  it('computes percent change', () => {
    expect(percentChange(120, 100)).toBe(20);
    expect(percentChange(50, 0)).toBeNull();
  });

  it('flags big changes, joiners, leavers, LOP and errors', () => {
    const previous = [emp('a', 50_000), emp('b', 40_000), emp('c', 30_000), emp('x', 20_000)];
    const current = [
      emp('a', 50_500),
      emp('b', 60_000),
      emp('c', 27_000, { lopDays: 3 }),
      emp('n', 25_000),
      emp('e', 0, { status: 'ERROR', error: 'No salary structure' }),
    ];
    const out = findPayrollOutliers(current, previous);
    const by = new Map(out.map((o) => [o.employeeId, o]));
    expect(by.has('a')).toBe(false);
    expect(by.get('b')!.reasons[0]).toMatch(/up 50%/);
    expect(by.get('c')!.reasons).toContain('3 LOP day(s)');
    expect(by.get('n')!.reasons[0]).toMatch(/new joiner/);
    expect(by.get('e')!.reasons[0]).toMatch(/No salary structure/);
    expect(by.get('x')!.reasons[0]).toMatch(/missing from this run/);
  });

  it('works without a previous run', () => {
    const out = findPayrollOutliers([emp('a', 1000), emp('b', 1000)], null);
    expect(out).toEqual([]);
  });
});

describe('AI module helpers', () => {
  it('parses drafts into subject and body', () => {
    expect(__test.parseDraft('Subject: Offer\n\nDear Asha,\nWelcome')).toEqual({
      subject: 'Offer',
      body: 'Dear Asha,\nWelcome',
    });
    expect(__test.parseDraft('No subject here')).toEqual({ subject: '', body: 'No subject here' });
  });

  it('parses summaries and highlights', () => {
    expect(__test.parseSummary('A good fit.\nHighlights:\n- Vue\n- Node')).toEqual({
      summary: 'A good fit.',
      highlights: ['Vue', 'Node'],
    });
  });

  it('extracts the subject of a lookup question', () => {
    expect(extractSubject('Find employee Priya please')).toBe('Priya');
    expect(extractSubject('leave balance of EMP-0042?')).toBe('EMP-0042');
    expect(extractSubject('how are you')).toBeUndefined();
  });
});

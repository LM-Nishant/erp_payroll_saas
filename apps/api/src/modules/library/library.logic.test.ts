import { describe, expect, it } from 'vitest';
import {
  addDays,
  computeOverdueFine,
  dueDateFor,
  formatAccessionNo,
  mapImportRow,
  overdueDays,
  parseCsv,
  shouldSendOverdueReminder,
  splitList,
} from './library.logic';

describe('library logic', () => {
  it('computes due dates and overdue days', () => {
    expect(dueDateFor('2026-01-25', { loanDays: 14 })).toBe('2026-02-08');
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(overdueDays('2026-02-08', '2026-02-08')).toBe(0);
    expect(overdueDays('2026-02-08', '2026-02-01')).toBe(0);
    expect(overdueDays('2026-02-08', '2026-02-11')).toBe(3);
  });

  it('caps the overdue fine at maxFine (0 = uncapped)', () => {
    const policy = { finePerDay: 2.5, maxFine: 20 };
    expect(computeOverdueFine('2026-02-08', '2026-02-08', policy)).toBe(0);
    expect(computeOverdueFine('2026-02-08', '2026-02-11', policy)).toBe(7.5);
    expect(computeOverdueFine('2026-02-08', '2026-03-30', policy)).toBe(20);
    expect(computeOverdueFine('2026-02-08', '2026-03-30', { finePerDay: 1, maxFine: 0 })).toBe(50);
  });

  it('spaces overdue reminders', () => {
    const base = { dueDate: '2026-02-08', lastReminderAt: null, reminderCount: 0 };
    expect(shouldSendOverdueReminder(base, '2026-02-08')).toBe(false);
    expect(shouldSendOverdueReminder(base, '2026-02-09')).toBe(true);
    const sent = { ...base, lastReminderAt: '2026-02-09T05:00:00.000Z', reminderCount: 1 };
    expect(shouldSendOverdueReminder(sent, '2026-02-10')).toBe(false);
    expect(shouldSendOverdueReminder(sent, '2026-02-12')).toBe(true);
    expect(shouldSendOverdueReminder({ ...sent, reminderCount: 5 }, '2026-03-12')).toBe(false);
  });

  it('formats accession numbers and splits lists', () => {
    expect(formatAccessionNo('AEC', 42)).toBe('AEC-000042');
    expect(splitList('B. Kernighan; D. Ritchie')).toEqual(['B. Kernighan', 'D. Ritchie']);
    expect(splitList(['a', ' ', 'b'])).toEqual(['a', 'b']);
    expect(splitList(null)).toEqual([]);
  });

  it('parses CSV and maps import headers', () => {
    const rows = parseCsv(
      '\uFEFFTitle,Authors,"Publication Year"\r\n"C, The Language","K; R",1988\r\n\r\n',
    );
    expect(rows).toEqual([
      ['Title', 'Authors', 'Publication Year'],
      ['C, The Language', 'K; R', '1988'],
    ]);
    expect(
      mapImportRow({
        Title: 'X',
        'Publication Year': '1988',
        Subject: 'CS',
        Unknown: 'y',
        ISBN: '',
      }),
    ).toEqual({ title: 'X', publicationYear: '1988', category: 'CS' });
    expect(parseCsv('a,"he said ""hi"""\n')).toEqual([['a', 'he said "hi"']]);
  });
});

import { describe, expect, it } from 'vitest';
import { promptPreview, redactPii, truncate } from './redact';

describe('AI PII redaction', () => {
  it('redacts e-mails, phones, ids and government numbers', () => {
    const out = redactPii(
      'Mail priya.sharma@abbs.edu or call +91 98765 43210 / 9876543210. PAN ABCDE1234F, Aadhaar 2345 6789 0123, id 3f2b1c4d-1111-4222-8333-944455556666, acct 123456789012345.',
    );
    expect(out).not.toMatch(/priya\.sharma|98765|ABCDE1234F|2345 6789|3f2b1c4d|123456789012345/);
    expect(out).toContain('[EMAIL]');
    expect(out).toContain('[PHONE]');
    expect(out).toContain('[PAN]');
    expect(out).toContain('[AADHAAR]');
    expect(out).toContain('[ID]');
  });

  it('redacts pasted API keys and bearer tokens', () => {
    const out = redactPii('key sk-abcdefghijklmnop1234 and Bearer abcdefghijklmnopqrstuvwxyz');
    expect(out).not.toContain('sk-abcdefghijklmnop1234');
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  it('keeps ordinary numbers, dates and amounts', () => {
    expect(redactPii('Net pay 125000 for 2026-09-01, 42 employees')).toBe(
      'Net pay 125000 for 2026-09-01, 42 employees',
    );
  });

  it('truncates previews', () => {
    expect(truncate('abcdef', 4).length).toBeLessThanOrEqual(4);
    expect(promptPreview('x'.repeat(5000)).length).toBeLessThanOrEqual(1000);
    expect(promptPreview('mail a@b.co')).toBe('mail [EMAIL]');
  });
});

import { describe, expect, it } from 'vitest';
import { mergeBranding, PLATFORM_DEFAULT_BRANDING } from '.';

describe('branding merge', () => {
  it('falls back institution → group → organization → platform', () => {
    const r = mergeBranding(
      [
        {
          scopeType: 'INSTITUTION',
          values: { displayName: 'ENG', customDomain: 'eng.example.edu' },
        },
        { scopeType: 'GROUP', values: { primaryColor: '#112233', logoStorageKey: 'g/logo.png' } },
        {
          scopeType: 'ORGANIZATION',
          values: { footerText: 'Org footer', subdomain: 'org', logoFileId: 'f1' },
        },
      ],
      { scopeType: 'INSTITUTION', id: 'i1' },
    );
    expect(r.displayName).toBe('ENG');
    expect(r.primaryColor).toBe('#112233');
    expect(r.sources.primaryColor).toBe('GROUP');
    expect(r.footerText).toBe('Org footer');
    expect(r.secondaryColor).toBe(PLATFORM_DEFAULT_BRANDING.secondaryColor);
    expect(r.sources.secondaryColor).toBe('PLATFORM');
    // Domains are never inherited.
    expect(r.customDomain).toBe('eng.example.edu');
    expect(r.subdomain).toBeNull();
    // Logo resolved as a pair from the most specific level that has one.
    expect(r.logoStorageKey).toBe('g/logo.png');
    expect(r.logoFileId).toBeNull();
    expect(r.sources.logoStorageKey).toBe('GROUP');
  });
});

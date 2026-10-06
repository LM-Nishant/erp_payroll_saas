import { describe, expect, it } from 'vitest';
import {
  currentOrganizationId,
  getTenantContext,
  runWithTenant,
  tryGetTenantContext,
} from './context';
import { TenantContextMissingError, TenantIsolationError } from './errors';

describe('TenantContext (AsyncLocalStorage)', () => {
  it('throws when no context is active', () => {
    expect(tryGetTenantContext()).toBeUndefined();
    expect(() => getTenantContext()).toThrow(TenantContextMissingError);
  });

  it('propagates across async boundaries', async () => {
    const result = await runWithTenant({ organizationId: 'org-a', source: 'system' }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return currentOrganizationId();
    });
    expect(result).toBe('org-a');
    expect(tryGetTenantContext()).toBeUndefined();
  });

  it('keeps concurrent contexts isolated', async () => {
    const run = (org: string, delay: number) =>
      runWithTenant({ organizationId: org, source: 'system' }, async () => {
        await new Promise((r) => setTimeout(r, delay));
        return currentOrganizationId();
      });
    expect(await Promise.all([run('a', 15), run('b', 1), run('c', 8)])).toEqual(['a', 'b', 'c']);
  });

  it('forbids switching tenant inside an active context', () => {
    runWithTenant({ organizationId: 'org-a', source: 'request' }, () => {
      expect(() =>
        runWithTenant({ organizationId: 'org-b', source: 'system' }, () => undefined),
      ).toThrow(TenantIsolationError);
      expect(
        runWithTenant({ organizationId: 'org-a', source: 'system' }, () => currentOrganizationId()),
      ).toBe('org-a');
    });
  });

  it('freezes the context', () => {
    runWithTenant({ organizationId: 'org-a', source: 'system' }, () => {
      expect(Object.isFrozen(getTenantContext())).toBe(true);
    });
  });
});

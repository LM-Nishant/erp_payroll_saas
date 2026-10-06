import { describe, expect, it } from 'vitest';
import { TenantIsolationError } from './errors';
import { scopeTenantArgs, scopeTenantRootArgs, type ScopeOptions } from './scope-args';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const opts: ScopeOptions = {
  organizationId: ORG,
  softDelete: true,
  relationFields: new Set(['organization', 'institutions']),
};

describe('scopeTenantArgs', () => {
  it.each(['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy'])(
    'adds organizationId + soft-delete filter for %s',
    (op) => {
      const out = scopeTenantArgs('Group', op, { where: { code: 'X' } }, opts);
      expect(out.where).toEqual({ code: 'X', organizationId: ORG, deletedAt: null });
    },
  );

  it('handles missing args', () => {
    expect(scopeTenantArgs('Group', 'count', undefined, opts).where).toEqual({
      organizationId: ORG,
      deletedAt: null,
    });
  });

  it('respects an explicit deletedAt filter', () => {
    const out = scopeTenantArgs('Group', 'findMany', { where: { deletedAt: { not: null } } }, opts);
    expect(out.where).toEqual({ deletedAt: { not: null }, organizationId: ORG });
  });

  it('skips soft-delete filter for models without soft delete', () => {
    const out = scopeTenantArgs('Log', 'findMany', {}, { ...opts, softDelete: false });
    expect(out.where).toEqual({ organizationId: ORG });
  });

  it('allows a matching organizationId filter but rejects others', () => {
    expect(() =>
      scopeTenantArgs('Group', 'findMany', { where: { organizationId: ORG } }, opts),
    ).not.toThrow();
    expect(() =>
      scopeTenantArgs('Group', 'findMany', { where: { organizationId: OTHER } }, opts),
    ).toThrow(TenantIsolationError);
    expect(() =>
      scopeTenantArgs(
        'Group',
        'findMany',
        { where: { organizationId: { in: [ORG, OTHER] } } },
        opts,
      ),
    ).toThrow(TenantIsolationError);
  });

  it('stamps organizationId on create and createMany', () => {
    expect(scopeTenantArgs('Group', 'create', { data: { code: 'A' } }, opts).data).toEqual({
      code: 'A',
      organizationId: ORG,
    });
    expect(
      scopeTenantArgs('Group', 'createMany', { data: [{ code: 'A' }, { code: 'B' }] }, opts).data,
    ).toEqual([
      { code: 'A', organizationId: ORG },
      { code: 'B', organizationId: ORG },
    ]);
  });

  it('rejects cross-tenant creates', () => {
    expect(() =>
      scopeTenantArgs('Group', 'create', { data: { code: 'A', organizationId: OTHER } }, opts),
    ).toThrow(TenantIsolationError);
    expect(() =>
      scopeTenantArgs(
        'Group',
        'createMany',
        { data: [{ code: 'A' }, { code: 'B', organizationId: OTHER }] },
        opts,
      ),
    ).toThrow(TenantIsolationError);
  });

  it('scopes update/delete where clauses and blocks tenant moves', () => {
    const out = scopeTenantArgs(
      'Group',
      'update',
      { where: { id: 'g1' }, data: { name: 'N' } },
      opts,
    );
    expect(out.where).toEqual({ id: 'g1', organizationId: ORG, deletedAt: null });
    expect(out.data).toEqual({ name: 'N' });

    expect(scopeTenantArgs('Group', 'deleteMany', {}, opts).where).toEqual({
      organizationId: ORG,
      deletedAt: null,
    });

    expect(() =>
      scopeTenantArgs('Group', 'updateMany', { data: { organizationId: OTHER } }, opts),
    ).toThrow(TenantIsolationError);
    expect(() =>
      scopeTenantArgs(
        'Group',
        'update',
        { where: { id: 'g1' }, data: { organizationId: { set: OTHER } } },
        opts,
      ),
    ).toThrow(TenantIsolationError);
  });

  it('rejects nested relation writes', () => {
    expect(() =>
      scopeTenantArgs(
        'Group',
        'create',
        { data: { code: 'A', institutions: { create: [{ code: 'I' }] } } },
        opts,
      ),
    ).toThrow(/Nested relation write/);
    expect(() =>
      scopeTenantArgs(
        'Group',
        'update',
        { where: { id: 'x' }, data: { organization: { connect: { id: OTHER } } } },
        opts,
      ),
    ).toThrow(TenantIsolationError);
  });

  it('scopes upsert', () => {
    const out = scopeTenantArgs(
      'Group',
      'upsert',
      { where: { id: 'g' }, create: { code: 'A' }, update: { name: 'B' } },
      opts,
    );
    expect(out).toEqual({
      where: { id: 'g', organizationId: ORG, deletedAt: null },
      create: { code: 'A', organizationId: ORG },
      update: { name: 'B' },
    });
  });

  it('rejects unknown operations', () => {
    expect(() => scopeTenantArgs('Group', 'findRaw', {}, opts)).toThrow(TenantIsolationError);
  });
});

describe('scopeTenantRootArgs', () => {
  it('restricts organization reads to the current organization id', () => {
    expect(scopeTenantRootArgs('Organization', 'findMany', {}, opts).where).toEqual({
      id: ORG,
      deletedAt: null,
    });
    expect(() =>
      scopeTenantRootArgs('Organization', 'findUnique', { where: { id: OTHER } }, opts),
    ).toThrow(TenantIsolationError);
  });

  it('is read-only', () => {
    expect(() =>
      scopeTenantRootArgs('Organization', 'update', { where: { id: ORG }, data: {} }, opts),
    ).toThrow(/read-only/);
  });
});

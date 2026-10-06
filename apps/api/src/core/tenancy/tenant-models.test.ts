import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  CORE_MANAGED_MODELS,
  GLOBAL_MODELS,
  SOFT_DELETE_MODELS,
  TENANT_SCOPED_MODELS,
} from './tenant-models';

const models = Prisma.dmmf.datamodel.models;

describe('tenant model registry', () => {
  it('registers every model carrying organizationId as tenant-scoped or core-managed', () => {
    const orgField = (m: (typeof models)[number]) =>
      m.fields.find((f) => f.name === 'organizationId');
    const required = models.filter((m) => orgField(m)?.isRequired).map((m) => m.name);
    const nullable = models
      .filter((m) => orgField(m) && !orgField(m)!.isRequired)
      .map((m) => m.name);
    expect([...TENANT_SCOPED_MODELS].sort()).toEqual(required.sort());
    expect([...CORE_MANAGED_MODELS].sort()).toEqual(nullable.sort());
  });

  it('classifies every model as either tenant-scoped or global', () => {
    for (const model of models) {
      expect(
        TENANT_SCOPED_MODELS.has(model.name) ||
          CORE_MANAGED_MODELS.has(model.name) ||
          GLOBAL_MODELS.has(model.name),
        `${model.name} must be registered in tenant-models.ts`,
      ).toBe(true);
    }
  });

  it('registers soft-delete models consistently with the schema', () => {
    const withDeletedAt = models
      .filter((m) => m.fields.some((f) => f.name === 'deletedAt'))
      .map((m) => m.name)
      .sort();
    expect([...SOFT_DELETE_MODELS].sort()).toEqual(withDeletedAt);
  });
});

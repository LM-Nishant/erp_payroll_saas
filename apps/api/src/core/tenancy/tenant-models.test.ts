import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { GLOBAL_MODELS, SOFT_DELETE_MODELS, TENANT_SCOPED_MODELS } from './tenant-models';

const models = Prisma.dmmf.datamodel.models;

describe('tenant model registry', () => {
  it('registers every model carrying organizationId as tenant-scoped', () => {
    const withOrg = models
      .filter((m) => m.fields.some((f) => f.name === 'organizationId'))
      .map((m) => m.name)
      .sort();
    expect([...TENANT_SCOPED_MODELS].sort()).toEqual(withOrg);
  });

  it('classifies every model as either tenant-scoped or global', () => {
    for (const model of models) {
      expect(
        TENANT_SCOPED_MODELS.has(model.name) || GLOBAL_MODELS.has(model.name),
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

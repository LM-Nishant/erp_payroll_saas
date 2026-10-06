import { describe, expect, it } from 'vitest';
import { createGroupSchema, createInstitutionSchema, updateCampusSchema } from './hierarchy';

describe('hierarchy schemas', () => {
  it('rejects client-supplied organizationId', () => {
    const result = createGroupSchema.safeParse({
      name: 'ABBS',
      code: 'ABBS',
      organizationId: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.success).toBe(false);
  });

  it('allows independent institutions (no groupId)', () => {
    const result = createInstitutionSchema.parse({ name: 'JP College', code: 'JPC' });
    expect(result.groupId).toBeUndefined();
    expect(result.type).toBe('COLLEGE');
  });

  it('does not allow moving a campus to another institution via update', () => {
    const result = updateCampusSchema.safeParse({
      institutionId: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.success).toBe(false);
  });

  it('validates codes', () => {
    expect(createGroupSchema.safeParse({ name: 'x', code: 'bad code' }).success).toBe(false);
  });
});

import type { DocumentAction } from '@erp/shared';
import type { ResourceScope } from '../authz/engine';
import type { Principal } from '../authz/principal';
import { InvalidReferenceError, ValidationError } from '../http/errors';
import { currentOrganizationId } from '../tenancy/context';
import { tenantDb } from '../tenancy/tenant-db';

/** Hierarchy coordinates a document inherits from its owner entity. */
export interface OwnerScope {
  groupId: string | null;
  institutionId: string | null;
  campusId: string | null;
  departmentId: string | null;
}

/**
 * Owner self-access: lets the subject of a document (e.g. the employee a payslip belongs to)
 * act on it without any scoped RBAC grant. Requires the `document.view_own` permission.
 */
export interface DocumentOwnerSelfAccess {
  /** Actions the owner gets on documents they own (e.g. ['view', 'download']). */
  actions: readonly DocumentAction[];
  /** Owner ids (of this owner type) the principal IS, e.g. the user's employee id(s). */
  ownedIds(principal: Principal): Promise<string[]>;
}

export interface DocumentOwnerType {
  /** Owner type code stored on documents (`employee`, `student`, `institution`…). */
  type: string;
  /**
   * Resolve the owner inside the CURRENT tenant to its hierarchy coordinates (null = no such
   * owner). Documents copy these coordinates — they drive scope checks and listing filters.
   */
  resolveScope(ownerId: string): Promise<OwnerScope | null>;
  selfAccess?: DocumentOwnerSelfAccess;
}

const registry = new Map<string, DocumentOwnerType>();

/**
 * Register an owner entity type so documents can be attached to it. Modules call this at import
 * time (e.g. HR registers `employee` with self-access for the employee's own user).
 */
export function registerDocumentOwnerType(owner: DocumentOwnerType): void {
  if (!/^[a-z][a-z0-9_]*$/.test(owner.type)) throw new Error('Invalid owner type code');
  if (registry.has(owner.type)) throw new Error(`Owner type "${owner.type}" already registered`);
  registry.set(owner.type, owner);
}

export function documentOwnerType(type: string): DocumentOwnerType | undefined {
  return registry.get(type);
}

export function documentOwnerTypes(): DocumentOwnerType[] {
  return [...registry.values()];
}

/** Test hook. */
export function unregisterDocumentOwnerType(type: string): void {
  registry.delete(type);
}

export interface ResolvedOwner {
  ownerType: string;
  ownerId: string;
  scope: OwnerScope;
}

/** Resolve a client-supplied owner (400 for an unknown type, 422 when the owner does not exist). */
export async function resolveDocumentOwner(
  ownerType: string,
  ownerId: string | undefined,
): Promise<ResolvedOwner> {
  const owner = registry.get(ownerType);
  if (!owner) {
    throw new ValidationError(`Unknown document owner type "${ownerType}"`, {
      code: 'UNKNOWN_OWNER_TYPE',
    });
  }
  const id = ownerType === 'organization' ? (ownerId ?? currentOrganizationId()) : ownerId;
  if (!id) throw new ValidationError('ownerId is required');
  const scope = await owner.resolveScope(id);
  if (!scope) throw new InvalidReferenceError('ownerId', ownerType);
  return { ownerType, ownerId: id, scope };
}

export const toResourceScope = (s: OwnerScope): ResourceScope => ({
  groupId: s.groupId,
  institutionId: s.institutionId,
  campusId: s.campusId,
  departmentId: s.departmentId,
});

const none: OwnerScope = { groupId: null, institutionId: null, campusId: null, departmentId: null };

/** Built-in owners: the Layer 1 hierarchy entities. */
export function registerBuiltInOwnerTypes(): void {
  if (registry.has('organization')) return;
  registerDocumentOwnerType({
    type: 'organization',
    resolveScope: async (id) => (id === currentOrganizationId() ? none : null),
  });
  registerDocumentOwnerType({
    type: 'group',
    async resolveScope(id) {
      const g = await tenantDb().group.findFirst({ where: { id }, select: { id: true } });
      return g ? { ...none, groupId: g.id } : null;
    },
  });
  registerDocumentOwnerType({
    type: 'institution',
    async resolveScope(id) {
      const i = await tenantDb().institution.findFirst({
        where: { id },
        select: { id: true, groupId: true },
      });
      return i ? { ...none, groupId: i.groupId, institutionId: i.id } : null;
    },
  });
  registerDocumentOwnerType({
    type: 'campus',
    async resolveScope(id) {
      const c = await tenantDb().campus.findFirst({
        where: { id },
        select: { id: true, institution: { select: { id: true, groupId: true } } },
      });
      return c
        ? {
            ...none,
            groupId: c.institution.groupId,
            institutionId: c.institution.id,
            campusId: c.id,
          }
        : null;
    },
  });
  registerDocumentOwnerType({
    type: 'department',
    async resolveScope(id) {
      const d = await tenantDb().department.findFirst({
        where: { id },
        select: {
          id: true,
          campusId: true,
          institution: { select: { id: true, groupId: true } },
        },
      });
      return d
        ? {
            groupId: d.institution.groupId,
            institutionId: d.institution.id,
            campusId: d.campusId,
            departmentId: d.id,
          }
        : null;
    },
  });
}

registerBuiltInOwnerTypes();

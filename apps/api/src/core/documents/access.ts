import { DOCUMENT_ACTIONS, type DocumentAction, type ScopeType } from '@erp/shared';
import type { Document, DocumentPermission, Prisma } from '@prisma/client';
import {
  accessFor,
  covers,
  hasPermission,
  whereForAccess,
  type ResourceScope,
} from '../authz/engine';
import type { Principal } from '../authz/principal';
import { tenantDb } from '../tenancy/tenant-db';
import { documentOwnerType, documentOwnerTypes } from './owners';

/**
 * Document authorization (spec §33). A principal may perform an action on a document when ANY
 * of these paths allows it:
 *
 * 1. RBAC + scope: the action's permission (DOCUMENT_ACTION_PERMISSIONS) held in a scope that
 *    covers the document's hierarchy coordinates, AND the confidentiality rule:
 *    PUBLIC / INTERNAL → nothing more; CONFIDENTIAL → `document.view_confidential` in scope;
 *    RESTRICTED → `document.view_confidential` organization-wide.
 * 2. Explicit grant (document_permissions) to the user, one of the user's role keys, or a
 *    hierarchy scope the user is assigned within (or ORGANIZATION = every member).
 * 3. Owner self-access: `document.view_own` + the owner type's registered resolver says the
 *    principal IS the owner (e.g. the employee the document belongs to).
 *
 * Metadata changes and signature requests need `document.manage` through path 1 only.
 */
export const DOCUMENT_ACTION_PERMISSIONS: Record<DocumentAction, string> = {
  view: 'document.view',
  download: 'document.download',
  upload_version: 'document.upload',
  delete: 'document.delete',
  share: 'document.share',
};

export const GRANT_ACTION_COLUMNS = {
  view: 'canView',
  download: 'canDownload',
  upload_version: 'canUploadVersion',
  delete: 'canDelete',
  share: 'canShare',
} as const satisfies Record<DocumentAction, keyof DocumentPermission>;

type DocLike = Pick<
  Document,
  | 'groupId'
  | 'institutionId'
  | 'campusId'
  | 'departmentId'
  | 'confidentiality'
  | 'ownerType'
  | 'ownerId'
>;

export const documentScope = (d: DocLike): ResourceScope => ({
  groupId: d.groupId,
  institutionId: d.institutionId,
  campusId: d.campusId,
  departmentId: d.departmentId,
});

/** Can the principal see documents of this confidentiality at these coordinates via RBAC? */
export async function confidentialityAllows(
  principal: Principal,
  confidentiality: Document['confidentiality'],
  scope: ResourceScope,
): Promise<boolean> {
  if (confidentiality === 'PUBLIC' || confidentiality === 'INTERNAL') return true;
  if (!hasPermission(principal, 'document.view_confidential')) return false;
  const access = await accessFor(principal, 'document.view_confidential');
  return confidentiality === 'RESTRICTED' ? access.all : covers(access, scope);
}

/** RBAC (path 1) check of one permission on a document. */
export async function rbacAllows(
  principal: Principal,
  permission: string,
  doc: DocLike,
): Promise<boolean> {
  if (!hasPermission(principal, permission)) return false;
  const scope = documentScope(doc);
  if (!covers(await accessFor(principal, permission), scope)) return false;
  return confidentialityAllows(principal, doc.confidentiality, scope);
}

/**
 * Hierarchy scopes the principal is "within": every assignment scope plus its ancestors
 * (department → campus → institution → group). Used to match SCOPE grants. Memoized.
 */
export async function principalAncestry(
  principal: Principal,
): Promise<{ type: ScopeType; id: string }[]> {
  const cached = principal.cache.get('documents:ancestry') as
    { type: ScopeType; id: string }[] | undefined;
  if (cached) return cached;
  const ids = {
    GROUP: new Set<string>(),
    INSTITUTION: new Set<string>(),
    CAMPUS: new Set<string>(),
    DEPARTMENT: new Set<string>(),
  };
  for (const grant of principal.grants) {
    for (const s of grant.scopes) if (s.type !== 'ORGANIZATION' && s.id) ids[s.type].add(s.id);
  }
  const db = tenantDb();
  if (ids.DEPARTMENT.size > 0) {
    const rows = await db.department.findMany({
      where: { id: { in: [...ids.DEPARTMENT] } },
      select: { institutionId: true, campusId: true },
    });
    for (const r of rows) {
      ids.INSTITUTION.add(r.institutionId);
      if (r.campusId) ids.CAMPUS.add(r.campusId);
    }
  }
  if (ids.CAMPUS.size > 0) {
    const rows = await db.campus.findMany({
      where: { id: { in: [...ids.CAMPUS] } },
      select: { institutionId: true },
    });
    rows.forEach((r) => ids.INSTITUTION.add(r.institutionId));
  }
  if (ids.INSTITUTION.size > 0) {
    const rows = await db.institution.findMany({
      where: { id: { in: [...ids.INSTITUTION] } },
      select: { groupId: true },
    });
    rows.forEach((r) => r.groupId && ids.GROUP.add(r.groupId));
  }
  const out = (Object.keys(ids) as (keyof typeof ids)[]).flatMap((type) =>
    [...ids[type]].map((id) => ({ type, id })),
  );
  principal.cache.set('documents:ancestry', out);
  return out;
}

/** Does an explicit grant row apply to the principal (ignores the actions)? */
export async function grantApplies(
  principal: Principal,
  grant: Pick<
    DocumentPermission,
    'granteeType' | 'userId' | 'roleKey' | 'scopeType' | 'scopeId' | 'expiresAt'
  >,
  now = new Date(),
): Promise<boolean> {
  if (grant.expiresAt && grant.expiresAt <= now) return false;
  switch (grant.granteeType) {
    case 'USER':
      return !!principal.userId && grant.userId === principal.userId;
    case 'ROLE':
      return principal.grants.some((g) => g.roleKey === grant.roleKey);
    case 'SCOPE':
      if (grant.scopeType === 'ORGANIZATION') return principal.userId !== null;
      return (await principalAncestry(principal)).some(
        (s) => s.type === grant.scopeType && s.id === grant.scopeId,
      );
  }
}

/** Owner ids of `ownerType` the principal is (memoized; empty without `document.view_own`). */
export async function ownedIds(principal: Principal, ownerType: string): Promise<string[]> {
  const owner = documentOwnerType(ownerType);
  if (!owner?.selfAccess || !hasPermission(principal, 'document.view_own')) return [];
  const key = `documents:owned:${ownerType}`;
  const cached = principal.cache.get(key) as string[] | undefined;
  if (cached) return cached;
  const ids = await owner.selfAccess.ownedIds(principal);
  principal.cache.set(key, ids);
  return ids;
}

/** Every action the principal may perform on a document (empty = not visible). */
export async function documentActionsFor(
  principal: Principal,
  doc: DocLike & { permissions: DocumentPermission[] },
): Promise<Set<DocumentAction>> {
  const allowed = new Set<DocumentAction>();
  for (const action of DOCUMENT_ACTIONS) {
    if (await rbacAllows(principal, DOCUMENT_ACTION_PERMISSIONS[action], doc)) allowed.add(action);
  }
  const now = new Date();
  for (const grant of doc.permissions) {
    if (!(await grantApplies(principal, grant, now))) continue;
    for (const action of DOCUMENT_ACTIONS) {
      if (grant[GRANT_ACTION_COLUMNS[action]]) allowed.add(action);
    }
  }
  const owner = documentOwnerType(doc.ownerType);
  if (owner?.selfAccess && (await ownedIds(principal, doc.ownerType)).includes(doc.ownerId)) {
    owner.selfAccess.actions.forEach((a) => allowed.add(a));
  }
  // Any action implies seeing the document.
  if (allowed.size > 0) allowed.add('view');
  return allowed;
}

/** Prisma filter of the documents the principal may VIEW (OR of the three paths). */
export async function visibleDocumentsWhere(
  principal: Principal,
): Promise<Prisma.DocumentWhereInput> {
  const or: Prisma.DocumentWhereInput[] = [];
  if (hasPermission(principal, 'document.view')) {
    const scope = whereForAccess(await accessFor(principal, 'document.view'), 'document') ?? {};
    const conf: Prisma.DocumentWhereInput[] = [{ confidentiality: { in: ['PUBLIC', 'INTERNAL'] } }];
    if (hasPermission(principal, 'document.view_confidential')) {
      const access = await accessFor(principal, 'document.view_confidential');
      conf.push({
        confidentiality: 'CONFIDENTIAL',
        ...(whereForAccess(access, 'document') ?? {}),
      });
      if (access.all) conf.push({ confidentiality: 'RESTRICTED' });
    }
    or.push({ AND: [scope, { OR: conf }] });
  }

  const now = new Date();
  const roleKeys = [...new Set(principal.grants.map((g) => g.roleKey))];
  const ancestry = await principalAncestry(principal);
  const grantee: Prisma.DocumentPermissionWhereInput[] = [];
  if (principal.userId) {
    grantee.push({ granteeType: 'USER', userId: principal.userId });
    grantee.push({ granteeType: 'SCOPE', scopeType: 'ORGANIZATION' });
  }
  if (roleKeys.length > 0) grantee.push({ granteeType: 'ROLE', roleKey: { in: roleKeys } });
  for (const type of ['GROUP', 'INSTITUTION', 'CAMPUS', 'DEPARTMENT'] as const) {
    const ids = ancestry.filter((a) => a.type === type).map((a) => a.id);
    if (ids.length > 0)
      grantee.push({ granteeType: 'SCOPE', scopeType: type, scopeId: { in: ids } });
  }
  if (grantee.length > 0) {
    or.push({
      permissions: {
        some: { AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, { OR: grantee }] },
      },
    });
  }

  for (const owner of documentOwnerTypes()) {
    if (!owner.selfAccess) continue;
    const ids = await ownedIds(principal, owner.type);
    if (ids.length > 0) or.push({ ownerType: owner.type, ownerId: { in: ids } });
  }
  return or.length > 0 ? { OR: or } : { id: { in: [] } };
}

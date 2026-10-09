import type { RequestHandler, Request } from 'express';
import { FEATURE_KEYS, type FeatureKey, type FeatureStateDto } from '@erp/shared';
import { tryGetPrincipal } from '../authz/principal';
import { prisma } from '../db/prisma';
import { AppError } from '../http/errors';
import { currentOrganizationId } from '../tenancy/context';
import { loadLicense } from './license';
import { resolveFeatureStates, type OverrideLayers } from './resolve';

/** Thrown when a module is not licensed / disabled for the target. */
export class FeatureDisabledError extends AppError {
  constructor(feature: FeatureKey) {
    super(403, 'FEATURE_DISABLED', `The "${feature}" module is not enabled`, { feature });
  }
}

export interface FeatureContext {
  organizationId: string;
}

/** Hierarchy target of a feature check; omit both for the organization level. */
export interface FeatureTarget {
  institutionId?: string | null;
  groupId?: string | null;
}

/** Feature context of the current tenant. */
export function currentFeatureContext(): FeatureContext {
  return { organizationId: currentOrganizationId() };
}

interface OverrideRow {
  scopeType: 'ORGANIZATION' | 'GROUP' | 'INSTITUTION';
  targetId: string;
  featureKey: string;
  enabled: boolean;
}

async function loadOverrides(organizationId: string): Promise<OverrideRow[]> {
  const cache = tryGetPrincipal()?.cache;
  const cacheKey = `features:overrides:${organizationId}`;
  const cached = cache?.get(cacheKey) as OverrideRow[] | undefined;
  if (cached) return cached;
  const rows = await prisma.featureOverride.findMany({
    where: { organizationId },
    select: { scopeType: true, targetId: true, featureKey: true, enabled: true },
  });
  cache?.set(cacheKey, rows);
  return rows;
}

function layerFor(rows: OverrideRow[], scopeType: OverrideRow['scopeType'], targetId: string) {
  const out: Partial<Record<FeatureKey, boolean>> = {};
  for (const row of rows) {
    if (row.scopeType === scopeType && row.targetId === targetId) {
      out[row.featureKey as FeatureKey] = row.enabled;
    }
  }
  return out;
}

/**
 * Effective state of every module for a target (organization, group or institution), applying
 * license → organization → group → institution overrides and dependencies.
 */
export async function featureStatesFor(
  ctx: FeatureContext,
  target: FeatureTarget = {},
): Promise<FeatureStateDto[]> {
  const license = await loadLicense(ctx.organizationId);
  const rows = await loadOverrides(ctx.organizationId);
  let groupId = target.groupId ?? null;
  if (target.institutionId && target.groupId === undefined) {
    const inst = await prisma.institution.findFirst({
      where: { id: target.institutionId, organizationId: ctx.organizationId },
      select: { groupId: true },
    });
    groupId = inst?.groupId ?? null;
  }
  const layers: OverrideLayers = {
    ORGANIZATION: layerFor(rows, 'ORGANIZATION', ctx.organizationId),
    ...(groupId ? { GROUP: layerFor(rows, 'GROUP', groupId) } : {}),
    ...(target.institutionId
      ? { INSTITUTION: layerFor(rows, 'INSTITUTION', target.institutionId) }
      : {}),
  };
  return resolveFeatureStates(license.features, layers);
}

/** Is `key` enabled for the target (organization level when no target is given)? */
export async function isFeatureEnabled(
  ctx: FeatureContext,
  key: FeatureKey,
  target: FeatureTarget = {},
): Promise<boolean> {
  const states = await featureStatesFor(ctx, target);
  return states.find((s) => s.key === key)?.enabled ?? false;
}

/**
 * Modules enabled for at least one target in the organization (org level, any group or any
 * institution). Drives `/me.features` and coarse route gating.
 */
export async function enabledFeaturesAnywhere(ctx: FeatureContext): Promise<FeatureKey[]> {
  const cache = tryGetPrincipal()?.cache;
  const cacheKey = `features:anywhere:${ctx.organizationId}`;
  const cached = cache?.get(cacheKey) as FeatureKey[] | undefined;
  if (cached) return cached;

  const license = await loadLicense(ctx.organizationId);
  const enabled = new Set<FeatureKey>();
  const collect = (states: FeatureStateDto[]) =>
    states.filter((s) => s.enabled).forEach((s) => enabled.add(s.key));
  if (license.features.size > 0) {
    collect(await featureStatesFor(ctx));
    const rows = await loadOverrides(ctx.organizationId);
    const groupIds = new Set(rows.filter((r) => r.scopeType === 'GROUP').map((r) => r.targetId));
    const institutionIds = new Set(
      rows.filter((r) => r.scopeType === 'INSTITUTION').map((r) => r.targetId),
    );
    for (const groupId of groupIds) collect(await featureStatesFor(ctx, { groupId }));
    if (institutionIds.size > 0) {
      const insts = await prisma.institution.findMany({
        where: { organizationId: ctx.organizationId, id: { in: [...institutionIds] } },
        select: { id: true, groupId: true },
      });
      for (const inst of insts) {
        collect(await featureStatesFor(ctx, { institutionId: inst.id, groupId: inst.groupId }));
      }
    }
  }
  const result = FEATURE_KEYS.filter((k) => enabled.has(k));
  cache?.set(cacheKey, result);
  return result;
}

/**
 * Service-level check: throws 403 FEATURE_DISABLED unless `key` is enabled for the target in the
 * current tenant. Pass the institution / group of the resource being touched.
 */
export async function assertFeatureEnabled(key: FeatureKey, target: FeatureTarget = {}) {
  const ctx = currentFeatureContext();
  const ok =
    target.institutionId || target.groupId
      ? await isFeatureEnabled(ctx, key, target)
      : (await enabledFeaturesAnywhere(ctx)).includes(key);
  if (!ok) throw new FeatureDisabledError(key);
}

export type FeatureTargetResolver = (req: Request) => FeatureTarget | Promise<FeatureTarget>;

function queryInstitutionTarget(req: Request): FeatureTarget {
  const id = req.query?.institutionId;
  return typeof id === 'string' && id.length > 0 ? { institutionId: id } : {};
}

/**
 * Route guard: 403 FEATURE_DISABLED unless the module is enabled. Without a resolver the module
 * must be enabled somewhere in the organization (coarse gate; services then call
 * `assertFeatureEnabled(key, { institutionId })` for the concrete resource) — or, when the request
 * names an institution (`?institutionId=`), for that institution so institution-level overrides
 * apply. With a resolver it must be enabled for the resolved target. Mount AFTER tenant context.
 */
export function requireFeature(key: FeatureKey, resolver?: FeatureTargetResolver): RequestHandler {
  return async (req, _res, next) => {
    await assertFeatureEnabled(key, resolver ? await resolver(req) : queryInstitutionTarget(req));
    next();
  };
}

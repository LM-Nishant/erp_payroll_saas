import {
  BRANDING_FIELDS,
  type BrandingField,
  type BrandingValues,
  type ResolvedBrandingDto,
  type SettingScopeType,
} from '@erp/shared';
import type { BrandingProfile } from '@prisma/client';
import { tryGetPrincipal } from '../authz/principal';
import { prisma } from '../db/prisma';
import type { SettingTarget } from '../settings/target';

/** Built-in platform defaults (the last fallback level). Matches the web theme defaults. */
export const PLATFORM_DEFAULT_BRANDING: Partial<BrandingValues> = {
  primaryColor: '#1E3A8A',
  secondaryColor: '#0EA5E9',
  accentColor: '#F59E0B',
};

/** Fields that belong to ONE level only and are never inherited. */
const NON_INHERITED: ReadonlySet<BrandingField> = new Set(['customDomain', 'subdomain']);
/** Logo fields are inherited as a pair (a level with either set wins for both). */
const LOGO_FIELDS: readonly BrandingField[] = ['logoStorageKey', 'logoFileId'];

type Level = { scopeType: SettingScopeType; values: Partial<BrandingValues> };

const fromProfile = (p: BrandingProfile | undefined): Partial<BrandingValues> => {
  if (!p) return {};
  const out: Partial<BrandingValues> = {};
  for (const f of BRANDING_FIELDS) if (p[f] !== null) out[f] = p[f];
  return out;
};

/** Pure merge: levels ordered most specific first. Exported for unit tests. */
export function mergeBranding(
  levels: Level[],
  target: { scopeType: SettingScopeType; id: string },
): ResolvedBrandingDto {
  const values = {} as BrandingValues;
  const sources = {} as ResolvedBrandingDto['sources'];
  const all: Level[] = [
    ...levels,
    { scopeType: 'PLATFORM' as SettingScopeType, values: PLATFORM_DEFAULT_BRANDING },
  ];
  for (const field of BRANDING_FIELDS) {
    values[field] = null;
    sources[field] = null;
    if (LOGO_FIELDS.includes(field)) continue;
    const candidates = NON_INHERITED.has(field) ? all.slice(0, 1) : all;
    for (const level of candidates) {
      const v = level.values[field];
      if (v !== undefined && v !== null) {
        values[field] = v;
        sources[field] = level.scopeType as ResolvedBrandingDto['sources'][BrandingField];
        break;
      }
    }
  }
  const logoLevel = all.find((l) => LOGO_FIELDS.some((f) => l.values[f]));
  if (logoLevel) {
    for (const f of LOGO_FIELDS) {
      values[f] = logoLevel.values[f] ?? null;
      sources[f] = values[f]
        ? (logoLevel.scopeType as ResolvedBrandingDto['sources'][BrandingField])
        : null;
    }
  }
  return { target, ...values, sources };
}

/**
 * Resolved branding for a target: institution → group → organization → platform defaults.
 * Entity names / contact details act as defaults at their own level (an institution's
 * `displayName` falls back to its name, not to the organization's). Core code — reads through
 * the base client with explicit organization predicates; memoized per request.
 * Use for PDFs, emails, letterheads and the web theme.
 */
export async function resolveBranding(
  organizationId: string,
  target: Pick<SettingTarget, 'scopeType' | 'targetId' | 'groupId' | 'institutionId'>,
): Promise<ResolvedBrandingDto> {
  const cache = tryGetPrincipal()?.cache;
  const cacheKey = `branding:${organizationId}:${target.scopeType}:${target.targetId}`;
  const cached = cache?.get(cacheKey) as ResolvedBrandingDto | undefined;
  if (cached) return cached;

  const [profiles, org, group, inst] = await Promise.all([
    prisma.brandingProfile.findMany({
      where: {
        organizationId,
        OR: [
          { scopeType: 'ORGANIZATION' },
          ...(target.groupId ? [{ scopeType: 'GROUP' as const, targetId: target.groupId }] : []),
          ...(target.institutionId
            ? [{ scopeType: 'INSTITUTION' as const, targetId: target.institutionId }]
            : []),
        ],
      },
    }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    target.groupId
      ? prisma.group.findFirst({
          where: { id: target.groupId, organizationId },
          select: { name: true },
        })
      : null,
    target.institutionId
      ? prisma.institution.findFirst({
          where: { id: target.institutionId, organizationId },
          select: { name: true, email: true, phone: true, address: true },
        })
      : null,
  ]);
  const byScope = (s: SettingScopeType) => profiles.find((p) => p.scopeType === s);
  const levels: Level[] = [];
  if (target.institutionId) {
    levels.push({
      scopeType: 'INSTITUTION',
      values: {
        displayName: inst?.name ?? null,
        contactEmail: inst?.email ?? null,
        contactPhone: inst?.phone ?? null,
        address: inst?.address ?? null,
        ...fromProfile(byScope('INSTITUTION')),
      },
    });
  }
  if (target.groupId) {
    levels.push({
      scopeType: 'GROUP',
      values: {
        ...(target.institutionId ? {} : { displayName: group?.name ?? null }),
        ...fromProfile(byScope('GROUP')),
      },
    });
  }
  const orgProfile = fromProfile(byScope('ORGANIZATION'));
  levels.push({
    scopeType: 'ORGANIZATION',
    values: {
      ...(target.scopeType === 'ORGANIZATION' ? { displayName: org?.name ?? null } : {}),
      ...(target.scopeType === 'ORGANIZATION'
        ? orgProfile
        : withoutDisplayName(orgProfile, !!target.institutionId || !!target.groupId)),
    },
  });
  const resolved = mergeBranding(levels, { scopeType: target.scopeType, id: target.targetId });
  cache?.set(cacheKey, resolved);
  return resolved;
}

/** An institution / group is never named after its parent; other org defaults still apply. */
function withoutDisplayName(values: Partial<BrandingValues>, strip: boolean) {
  if (!strip) return values;
  const { displayName: _d, shortName: _s, ...rest } = values;
  return rest;
}

export function invalidateBrandingCache(): void {
  const cache = tryGetPrincipal()?.cache;
  if (!cache) return;
  for (const key of [...cache.keys()]) if (key.startsWith('branding:')) cache.delete(key);
}
export { brandingLogoUrl } from './logo';

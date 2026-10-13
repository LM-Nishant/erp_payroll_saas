import type { FeatureKey } from '@erp/shared';
import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router';

declare module 'vue-router' {
  interface RouteMeta {
    /** Reachable without signing in (login page). */
    public?: boolean;
    /** Permission required to open the route (checked on every matched record). */
    permission?: string;
    /** Licensed module required to open the route (from `/me.features`). */
    feature?: FeatureKey;
    /** Needs an organization (tenant) context; platform-only users are sent home. */
    tenant?: boolean;
    /** Staff-only workspace: student/parent-only accounts are sent to their portal. */
    staff?: boolean;
  }
}

const PORTAL_ROLE_KEYS = new Set(['student', 'parent']);

/** True when every role is a student/parent portal role and the user has no employee record. */
export function isPortalOnlyUser(
  me: { roles: Array<{ key: string }>; permissions: string[] } | null | undefined,
): boolean {
  if (!me || me.roles.length === 0) return false;
  if (me.permissions.includes('employee.view_own')) return false;
  return me.roles.every((r) => PORTAL_ROLE_KEYS.has(r.key));
}

export interface GuardState {
  isAuthenticated: boolean;
  can: (permission?: string) => boolean;
  /** Defaults to "all enabled" (the API returns 403 FEATURE_DISABLED regardless). */
  hasFeature?: (feature?: FeatureKey) => boolean;
  /** False for platform-only users who do not belong to an organization. Defaults to true. */
  hasOrganization?: boolean;
  /** Student/parent-only account (see isPortalOnlyUser). Defaults to false. */
  portalOnly?: boolean;
}

/**
 * Route guard decision (pure, unit-tested). UI guards are a convenience only: the API enforces
 * every permission and scope server-side.
 */
export function guardDecision(
  to: Pick<RouteLocationNormalized, 'matched' | 'fullPath' | 'name'>,
  state: GuardState,
): true | RouteLocationRaw {
  const isPublic = to.matched.some((r) => r.meta.public);
  if (isPublic) {
    return state.isAuthenticated && to.name === 'login' ? { name: 'home' } : true;
  }
  if (!state.isAuthenticated) {
    return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } };
  }
  if (state.hasOrganization === false && to.matched.some((r) => r.meta.tenant)) {
    return { name: 'home' };
  }
  if (state.portalOnly && to.matched.some((r) => r.meta.staff)) {
    return { path: '/portal' };
  }
  const allowed = to.matched.every((r) => state.can(r.meta.permission));
  if (!allowed) return { name: 'forbidden' };
  const hasFeature = state.hasFeature ?? (() => true);
  return to.matched.every((r) => hasFeature(r.meta.feature)) ? true : { name: 'module-disabled' };
}

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
  }
}

export interface GuardState {
  isAuthenticated: boolean;
  can: (permission?: string) => boolean;
  /** Defaults to "all enabled" (the API returns 403 FEATURE_DISABLED regardless). */
  hasFeature?: (feature?: FeatureKey) => boolean;
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
  const allowed = to.matched.every((r) => state.can(r.meta.permission));
  if (!allowed) return { name: 'forbidden' };
  const hasFeature = state.hasFeature ?? (() => true);
  return to.matched.every((r) => hasFeature(r.meta.feature)) ? true : { name: 'module-disabled' };
}

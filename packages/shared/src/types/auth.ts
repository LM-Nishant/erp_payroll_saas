import type { ScopeType } from '../auth/permissions';
import type { FeatureKey } from '../licensing/features';
import type { ResolvedBrandingDto } from './licensing';

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  /** Omitted when the refresh token was delivered as an httpOnly cookie. */
  refreshToken?: string;
  refreshTokenExpiresAt: string;
}

export interface LoginResult extends Partial<AuthTokens> {
  mfaRequired: boolean;
  /** Present when mfaRequired: exchange with a TOTP / recovery code at /auth/mfa/verify. */
  mfaToken?: string;
}

export interface ScopeSummary {
  type: ScopeType;
  id: string | null;
  name: string | null;
}

export interface MeResponse {
  user: { id: string; email: string; name: string; mfaEnabled: boolean };
  organization: { id: string; slug: string; name: string } | null;
  /** Session opened by a platform admin through the audited tenant-access path. */
  platformAccess: boolean;
  platformRoles: string[];
  roles: Array<{ key: string; name: string; scopes: ScopeSummary[] }>;
  /** Distinct permission codes granted in at least one scope. Drives the frontend menu. */
  permissions: string[];
  /**
   * Modules enabled somewhere in the organization (license ∩ overrides). The web app hides
   * menus for absent features; the API enforces them independently (`requireFeature`).
   */
  features: FeatureKey[];
  /** Branding resolved for the user's home scope (single institution → group → org). */
  branding: ResolvedBrandingDto | null;
}

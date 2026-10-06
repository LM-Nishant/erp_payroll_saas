import type { ResolvedBrandingDto } from '@erp/shared';

/** Platform defaults (kept in sync with the API's PLATFORM_DEFAULT_BRANDING). */
export const DEFAULT_THEME_COLORS = {
  primary: '#1E3A8A',
  secondary: '#0EA5E9',
  accent: '#F59E0B',
} as const;

export type ThemeColors = { primary: string; secondary: string; accent: string };

/** Theme colors from the resolved (institution → group → org) branding in `/me`. */
export function themeColorsFrom(branding: ResolvedBrandingDto | null | undefined): ThemeColors {
  return {
    primary: branding?.primaryColor ?? DEFAULT_THEME_COLORS.primary,
    secondary: branding?.secondaryColor ?? DEFAULT_THEME_COLORS.secondary,
    accent: branding?.accentColor ?? DEFAULT_THEME_COLORS.accent,
  };
}

/** Minimal shape of Vuetify's theme instance (keeps this helper unit-testable). */
export interface ThemeTarget {
  themes: { value: Record<string, { colors: Record<string, string> }> };
}

export function applyBranding(
  theme: ThemeTarget,
  branding: ResolvedBrandingDto | null | undefined,
  themeName = 'light',
): void {
  const target = theme.themes.value[themeName];
  if (!target) return;
  Object.assign(target.colors, themeColorsFrom(branding));
}

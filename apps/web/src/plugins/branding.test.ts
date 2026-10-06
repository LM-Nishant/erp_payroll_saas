import type { ResolvedBrandingDto } from '@erp/shared';
import { describe, expect, it } from 'vitest';
import { applyBranding, DEFAULT_THEME_COLORS, themeColorsFrom } from './branding';

describe('branding theme', () => {
  it('uses resolved branding colors with platform fallbacks', () => {
    const branding = {
      primaryColor: '#123456',
      secondaryColor: null,
      accentColor: null,
    } as unknown as ResolvedBrandingDto;
    expect(themeColorsFrom(branding)).toEqual({
      primary: '#123456',
      secondary: DEFAULT_THEME_COLORS.secondary,
      accent: DEFAULT_THEME_COLORS.accent,
    });
    expect(themeColorsFrom(null)).toEqual(DEFAULT_THEME_COLORS);
  });

  it('applies colors to the Vuetify theme', () => {
    const theme = {
      themes: { value: { light: { colors: { primary: '#000000', error: '#f00' } } } },
    };
    applyBranding(theme, { primaryColor: '#ABCDEF' } as unknown as ResolvedBrandingDto);
    expect(theme.themes.value.light.colors).toMatchObject({
      primary: '#ABCDEF',
      secondary: DEFAULT_THEME_COLORS.secondary,
      error: '#f00',
    });
  });
});

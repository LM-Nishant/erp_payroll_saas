import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import { DEFAULT_THEME_COLORS } from './branding';

export const vuetify = createVuetify({
  theme: {
    defaultTheme: 'light',
    themes: {
      // Overridden at runtime from the resolved branding in /me (see App.vue).
      light: { colors: { ...DEFAULT_THEME_COLORS } },
    },
  },
});

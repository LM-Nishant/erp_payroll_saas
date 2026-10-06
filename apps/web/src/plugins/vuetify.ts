import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';
import { createVuetify } from 'vuetify';

export const vuetify = createVuetify({
  theme: {
    defaultTheme: 'light',
    themes: {
      light: { colors: { primary: '#1E3A8A', secondary: '#0EA5E9' } },
    },
  },
});

<script setup lang="ts">
import { watch } from 'vue';
import { useTheme } from 'vuetify';
import { applyBranding } from '@/plugins/branding';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const theme = useTheme();
// Theme colors follow the user's resolved branding (institution → group → organization).
watch(
  () => auth.me?.branding,
  (branding) => applyBranding(theme, branding),
  { immediate: true },
);
</script>

<template>
  <v-app>
    <router-view />
  </v-app>
</template>

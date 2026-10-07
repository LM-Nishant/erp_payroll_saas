<script setup lang="ts">
import type { SignedUrlDto } from '@erp/shared';
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
import NotificationBell from '@/components/NotificationBell.vue';
import { MENUS, visibleMenu, type LayoutKey } from '@/navigation/menus';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ layout: LayoutKey; title: string; color?: string }>();
const auth = useAuthStore();
const router = useRouter();
const drawer = ref(true);
const items = computed(() => visibleMenu(MENUS[props.layout], auth.can, auth.hasFeature));

// Signing a logo URL is audited, so refetch only when the resolved logo document changes.
const logoUrl = ref<string | null>(null);
watch(
  () => auth.me?.branding?.logoFileId ?? null,
  async (logoFileId) => {
    logoUrl.value = null;
    if (!logoFileId) return;
    try {
      logoUrl.value =
        (await apiFetch<{ data: SignedUrlDto | null }>('/api/v1/branding/home-logo-url')).data
          ?.url ?? null;
    } catch {
      logoUrl.value = null;
    }
  },
  { immediate: true },
);

async function signOut() {
  await auth.logout();
  await router.push({ name: 'login' });
}
</script>

<template>
  <v-navigation-drawer v-model="drawer">
    <v-list-item
      :title="title"
      :subtitle="auth.me?.branding?.displayName ?? auth.me?.organization?.name ?? 'Education ERP'"
    >
      <template v-if="logoUrl" #prepend>
        <v-img :src="logoUrl" width="40" height="40" contain class="mr-3" />
      </template>
    </v-list-item>
    <v-divider />
    <v-list density="compact" nav>
      <v-list-item
        v-for="item in items"
        :key="item.title"
        :to="item.to"
        :prepend-icon="item.icon"
        :title="item.title"
      />
    </v-list>
  </v-navigation-drawer>
  <v-app-bar :color="color ?? 'primary'" density="comfortable">
    <v-app-bar-nav-icon @click="drawer = !drawer" />
    <v-app-bar-title>{{ title }}</v-app-bar-title>
    <v-chip v-if="auth.me?.platformAccess" class="mr-2" color="warning" size="small">
      platform access
    </v-chip>
    <v-chip class="mr-2" variant="outlined" size="small">{{ auth.me?.user.name }}</v-chip>
    <NotificationBell
      v-if="auth.me?.organization"
      :base="`/${layout === 'platform' ? 'platform' : layout}`"
    />
    <v-btn to="/" icon="mdi-swap-horizontal" title="Switch workspace" />
    <v-btn icon="mdi-logout" title="Sign out" @click="signOut" />
  </v-app-bar>
  <v-main>
    <v-container fluid>
      <router-view />
    </v-container>
  </v-main>
</template>

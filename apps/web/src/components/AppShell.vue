<script setup lang="ts">
import type { SignedUrlDto } from '@erp/shared';
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
import ChangePasswordDialog from '@/components/ChangePasswordDialog.vue';
import NotificationBell from '@/components/NotificationBell.vue';
import SubscriptionBanner from '@/components/SubscriptionBanner.vue';
import AiAssistantPanel from '@/components/ai/AiAssistantPanel.vue';
import { MENUS, visibleMenu, type LayoutKey } from '@/navigation/menus';
import { useTerms } from '@/lib/terms';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ layout: LayoutKey; title: string; color?: string }>();
const auth = useAuthStore();
const router = useRouter();
const drawer = ref(true);
const changingPassword = ref(false);
const items = computed(() =>
  visibleMenu(MENUS[props.layout], auth.can, auth.hasFeature, auth.me?.organization?.kind),
);
const terms = useTerms();
const showAi = computed(
  () => !!auth.me?.organization && auth.hasFeature('ai') && auth.can('ai.use'),
);
const shellTitle = computed(() =>
  terms.value.isCompany
    ? props.title.replace('Institution', 'Company').replace('Group', 'Head office')
    : props.title,
);

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
      :title="shellTitle"
      :subtitle="auth.me?.branding?.displayName ?? auth.me?.organization?.name ?? terms.appName"
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
    <v-app-bar-title>{{ shellTitle }}</v-app-bar-title>
    <v-chip v-if="auth.me?.platformAccess" class="mr-2" color="warning" size="small">
      platform access
    </v-chip>
    <v-menu>
      <template #activator="{ props: menu }">
        <v-chip
          v-bind="menu"
          class="mr-2"
          variant="outlined"
          size="small"
          append-icon="mdi-menu-down"
          aria-label="Account menu"
        >
          {{ auth.me?.user.name }}
        </v-chip>
      </template>
      <v-list density="compact">
        <v-list-item :subtitle="auth.me?.user.email" :title="auth.me?.user.name" />
        <v-divider />
        <v-list-item
          prepend-icon="mdi-lock-reset"
          title="Change password"
          @click="changingPassword = true"
        />
        <v-list-item prepend-icon="mdi-logout" title="Sign out" @click="signOut" />
      </v-list>
    </v-menu>
    <NotificationBell
      v-if="auth.me?.organization"
      :base="`/${layout === 'platform' ? 'platform' : layout}`"
    />
    <v-btn to="/" icon="mdi-swap-horizontal" title="Switch workspace" />
    <v-btn icon="mdi-logout" title="Sign out" @click="signOut" />
  </v-app-bar>
  <v-main>
    <v-container fluid>
      <SubscriptionBanner />
      <router-view />
    </v-container>
  </v-main>
  <AiAssistantPanel v-if="showAi" />
  <ChangePasswordDialog v-model="changingPassword" />
</template>

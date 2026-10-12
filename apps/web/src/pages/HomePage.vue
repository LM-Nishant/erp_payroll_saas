<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import ChangePasswordDialog from '@/components/ChangePasswordDialog.vue';
import SubscriptionBanner from '@/components/SubscriptionBanner.vue';
import { WORKSPACES, visibleMenu } from '@/navigation/menus';
import { useTerms } from '@/lib/terms';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const changingPassword = ref(false);
const router = useRouter();
const hasOrganization = computed(() => Boolean(auth.me?.organization));
// Tenant workspaces need an organization; the platform super admin only gets "Platform".
const workspaces = computed(() =>
  visibleMenu(WORKSPACES, auth.can, auth.hasFeature, auth.me?.organization?.kind).filter(
    (w) => w.layout === 'platform' || hasOrganization.value,
  ),
);
const terms = useTerms();

async function signOut() {
  await auth.logout();
  await router.push({ name: 'login' });
}
</script>

<template>
  <v-main>
    <v-container class="py-12" max-width="900">
      <div class="d-flex align-center mb-2">
        <h1 class="text-h4">{{ terms.appName }}</h1>
        <v-spacer />
        <div>
          <v-btn variant="text" prepend-icon="mdi-lock-reset" @click="changingPassword = true">
            Change password
          </v-btn>
          <v-btn variant="text" prepend-icon="mdi-logout" @click="signOut">Sign out</v-btn>
        </div>
      </div>
      <p class="text-medium-emphasis mb-6">
        Signed in as {{ auth.me?.user.name }}
        <template v-if="auth.me?.organization">· {{ auth.me.organization.name }}</template>
      </p>
      <SubscriptionBanner />
      <v-alert v-if="!hasOrganization" type="info" variant="tonal" class="mb-6">
        You are signed in as a platform administrator. Platform admins manage organizations, plans
        and billing only. Employees, attendance, approvals and HR live inside an organization: open
        Platform → Organizations to create one with an owner, then sign in as that owner to add
        companies, departments, employees and logins.
      </v-alert>
      <v-row>
        <v-col v-for="w in workspaces" :key="w.to" cols="12" sm="6" md="3">
          <v-card :to="w.to" :prepend-icon="w.icon" :title="w.title" variant="tonal" />
        </v-col>
      </v-row>
    </v-container>
    <ChangePasswordDialog v-model="changingPassword" />
  </v-main>
</template>

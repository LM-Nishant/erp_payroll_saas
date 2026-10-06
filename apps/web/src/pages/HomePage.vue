<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { WORKSPACES, visibleMenu } from '@/navigation/menus';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const workspaces = computed(() => visibleMenu(WORKSPACES, auth.can));

async function signOut() {
  await auth.logout();
  await router.push({ name: 'login' });
}
</script>

<template>
  <v-main>
    <v-container class="py-12" max-width="900">
      <div class="d-flex align-center mb-2">
        <h1 class="text-h4">Education ERP</h1>
        <v-spacer />
        <v-btn variant="text" prepend-icon="mdi-logout" @click="signOut">Sign out</v-btn>
      </div>
      <p class="text-medium-emphasis mb-6">
        Signed in as {{ auth.me?.user.name }}
        <template v-if="auth.me?.organization">· {{ auth.me.organization.name }}</template>
      </p>
      <v-row>
        <v-col v-for="w in workspaces" :key="w.to" cols="12" sm="6" md="3">
          <v-card :to="w.to" :prepend-icon="w.icon" :title="w.title" variant="tonal" />
        </v-col>
      </v-row>
    </v-container>
  </v-main>
</template>

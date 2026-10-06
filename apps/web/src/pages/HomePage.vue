<script setup lang="ts">
import { ref } from 'vue';
import { useSessionStore } from '@/stores/session';

const session = useSessionStore();
const org = ref(session.devOrganization);
const orgs = ['abbs', 'bcc', 'jp-college'];
const workspaces = [
  { title: 'Platform', to: '/platform', icon: 'mdi-shield-crown' },
  { title: 'Group', to: '/group', icon: 'mdi-domain' },
  { title: 'Institution', to: '/institution', icon: 'mdi-school' },
  { title: 'Employee', to: '/employee', icon: 'mdi-account' },
];
</script>

<template>
  <v-main>
    <v-container class="py-12" max-width="900">
      <h1 class="text-h4 mb-2">Education ERP</h1>
      <p class="text-medium-emphasis mb-6">
        Development shell. Authentication arrives in a later layer; for now choose a demo
        organization (sent via a dev-only header the server validates).
      </p>
      <v-select
        v-model="org"
        :items="orgs"
        label="Demo organization"
        style="max-width: 320px"
        @update:model-value="session.setDevOrganization"
      />
      <v-row>
        <v-col v-for="w in workspaces" :key="w.to" cols="12" sm="6" md="3">
          <v-card :to="w.to" :prepend-icon="w.icon" :title="w.title" variant="tonal" />
        </v-col>
      </v-row>
    </v-container>
  </v-main>
</template>

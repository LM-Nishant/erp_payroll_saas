<script setup lang="ts">
import type { MyLibraryDto } from '@erp/shared';
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '@/api/client';
import MemberLibraryCard from './MemberLibraryCard.vue';

/** Portal / employee "My library": issued books, due dates, history, fines and reservations. */
const route = useRoute();
const data = ref<MyLibraryDto | null>(null);
const error = ref<string | null>(null);
const opacPath = route.path.replace(/\/library$/, '/opac');
async function load() {
  error.value = null;
  try {
    data.value = (await apiFetch<{ data: MyLibraryDto }>('/api/v1/library/me')).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function renew(loanId: string) {
  try {
    await apiFetch(`/api/v1/library/me/loans/${loanId}/renew`, { method: 'POST', body: '{}' });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function cancel(id: string) {
  try {
    await apiFetch(`/api/v1/library/me/reservations/${id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
</script>
<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">My library</h2>
    <v-spacer />
    <v-btn :to="opacPath" variant="text" prepend-icon="mdi-magnify">Search catalogue</v-btn>
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <template v-if="data">
    <v-alert v-if="!data.members.length" type="info" variant="tonal"
      >No library membership is linked to your account.</v-alert
    >
    <v-card v-for="m in data.members" :key="m.studentId ?? m.employeeId ?? m.name" class="mb-4">
      <v-card-text>
        <MemberLibraryCard :member="m" self-service @renew="renew" @cancel-reservation="cancel" />
      </v-card-text>
    </v-card>
  </template>
</template>

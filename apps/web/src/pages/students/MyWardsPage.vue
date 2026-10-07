<script setup lang="ts">
import type { StudentDto } from '@erp/shared';
import { onMounted, ref } from 'vue';
import { apiFetch } from '@/api/client';
const wards = ref<StudentDto[]>([]);
const error = ref<string | null>(null);
onMounted(async () => {
  try {
    wards.value = (await apiFetch<{ data: StudentDto[] }>('/api/v1/students/my-wards')).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>
<template>
  <h2 class="text-h5 mb-4">My children</h2>
  <v-alert v-if="error" type="error">{{ error }}</v-alert
  ><v-row v-else
    ><v-col v-for="w in wards" :key="w.id" cols="12" md="6"
      ><v-card
        ><v-card-title>{{ w.displayName }}</v-card-title
        ><v-card-text
          >{{ w.classSection?.name || w.classSectionId }} · Roll {{ w.rollNo || '—' }} ·
          {{ w.status }}</v-card-text
        ></v-card
      ></v-col
    ></v-row
  >
</template>

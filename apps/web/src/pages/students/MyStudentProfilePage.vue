<script setup lang="ts">
import type { StudentDetailDto } from '@erp/shared';
import { onMounted, ref } from 'vue';
import { apiFetch } from '@/api/client';
const item = ref<StudentDetailDto | null>(null);
const error = ref<string | null>(null);
onMounted(async () => {
  try {
    item.value = (await apiFetch<{ data: StudentDetailDto }>('/api/v1/students/me')).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>
<template>
  <v-alert v-if="error" type="error">{{ error }}</v-alert
  ><v-card v-else-if="item"
    ><v-card-title>{{ item.displayName }}</v-card-title
    ><v-card-text
      ><v-list
        ><v-list-item title="Admission no" :subtitle="item.admissionNo" /><v-list-item
          title="Class"
          :subtitle="item.classSection?.name || item.classSectionId" /><v-list-item
          title="Roll no"
          :subtitle="item.rollNo || '—'" /><v-list-item
          title="Status"
          :subtitle="item.status" /></v-list></v-card-text
  ></v-card>
</template>

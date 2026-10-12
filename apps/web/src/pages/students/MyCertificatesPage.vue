<script setup lang="ts">
import type { StudentCertificateDto } from '@erp/shared';
import { onMounted, ref } from 'vue';
import { apiDownload, apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

/** Portal: issued Transfer / Character certificates of the student or the parent's wards. */
const auth = useAuthStore();
const items = ref<StudentCertificateDto[]>([]);
const error = ref<string | null>(null);
const loaded = ref(false);

onMounted(async () => {
  try {
    const [mine, wards] = await Promise.all([
      auth.can('student.view_own')
        ? apiFetch<{ data: StudentCertificateDto[] }>('/api/v1/students/me/certificates')
        : Promise.resolve({ data: [] }),
      auth.can('ward.view')
        ? apiFetch<{ data: StudentCertificateDto[] }>('/api/v1/students/my-wards/certificates')
        : Promise.resolve({ data: [] }),
    ]);
    const seen = new Set<string>();
    items.value = [...mine.data, ...wards.data].filter((c) =>
      seen.has(c.id) ? false : (seen.add(c.id), true),
    );
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loaded.value = true;
  }
});

async function download(c: StudentCertificateDto) {
  try {
    await apiDownload(
      `/api/v1/students/certificates/${c.id}/pdf`,
      `${c.type === 'TRANSFER' ? 'tc' : 'cc'}-${c.certificateNo.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`,
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <h2 class="text-h5 mb-4">Certificates</h2>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <v-alert v-if="loaded && !items.length && !error" type="info" variant="tonal"
    >No certificates have been issued yet.</v-alert
  >
  <v-row
    ><v-col v-for="c in items" :key="c.id" cols="12" md="6"
      ><v-card data-testid="certificate-card"
        ><v-card-title>{{
          c.type === 'TRANSFER' ? 'Transfer certificate' : 'Character certificate'
        }}</v-card-title
        ><v-card-subtitle>{{ c.certificateNo }}</v-card-subtitle
        ><v-card-text
          >{{ c.studentName }} ({{ c.admissionNo }}) · Issued {{ c.issueDate
          }}<span v-if="c.leavingDate"> · Left {{ c.leavingDate }}</span></v-card-text
        ><v-card-actions
          ><v-btn color="primary" prepend-icon="mdi-download" @click="download(c)"
            >Download PDF</v-btn
          ></v-card-actions
        ></v-card
      ></v-col
    ></v-row
  >
</template>

<script setup lang="ts">
import type { AdmissionApplicationDto, ApiListResponse } from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
interface Option {
  id: string;
  name: string;
  code?: string;
  institutionId?: string;
}
const auth = useAuthStore();
const items = ref<AdmissionApplicationDto[]>([]);
const total = ref(0);
const page = ref(1);
const error = ref<string | null>(null);
const loading = ref(false);
const createOpen = ref(false);
const programs = ref<Option[]>([]);
const classes = ref<Option[]>([]);
const filters = reactive({ status: '', search: '' });
const form = reactive({
  institutionId: '',
  programId: '',
  classSectionId: '',
  academicYear: '2026-27',
  applicantFirstName: '',
  applicantLastName: '',
  guardianName: '',
  guardianRelation: 'FATHER',
  guardianPhone: '',
});
const headers = [
  { title: 'No', key: 'applicationNo' },
  { title: 'Applicant', key: 'applicantDisplayName' },
  { title: 'Year', key: 'academicYear' },
  { title: 'Guardian', key: 'guardianName' },
  { title: 'Status', key: 'status' },
  { title: 'Actions', key: 'actions', sortable: false },
];
function query() {
  const p = new URLSearchParams({ page: String(page.value), pageSize: '25' });
  if (filters.status) p.set('status', filters.status);
  if (filters.search) p.set('search', filters.search);
  return p;
}
async function load() {
  loading.value = true;
  try {
    const r = await apiFetch<ApiListResponse<AdmissionApplicationDto>>(
      `/api/v1/admissions?${query()}`,
    );
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function loadOptions() {
  programs.value = (await apiFetch<ApiListResponse<Option>>('/api/v1/programs?pageSize=100')).data;
  classes.value = (
    await apiFetch<ApiListResponse<Option>>('/api/v1/class-sections?pageSize=100')
  ).data;
}
async function act(fn: () => Promise<unknown>) {
  error.value = null;
  try {
    await fn();
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    return false;
  }
}
async function createAdmission() {
  const program = programs.value.find((p) => p.id === form.programId);
  const ok = await act(() =>
    apiFetch('/api/v1/admissions', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        institutionId: form.institutionId || program?.institutionId,
        classSectionId: form.classSectionId || null,
        guardianPhone: form.guardianPhone || null,
      }),
    }),
  );
  if (!ok) return;
  createOpen.value = false;
  await load();
}
async function transition(a: AdmissionApplicationDto, status: string) {
  const ok = await act(() =>
    apiFetch(`/api/v1/admissions/${a.id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ status, comment: `Marked ${status}` }),
    }),
  );
  if (ok) await load();
}
async function enroll(a: AdmissionApplicationDto) {
  const ok = await act(() =>
    apiFetch(`/api/v1/admissions/${a.id}/enroll`, {
      method: 'POST',
      body: JSON.stringify({ classSectionId: a.classSectionId || undefined }),
    }),
  );
  if (ok) await load();
}
onMounted(async () => {
  await Promise.all([load(), loadOptions()]);
});
watch([page, () => filters.status], load);
</script>
<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Admissions</h2>
    <v-spacer /><v-btn
      v-if="auth.can('admission.manage')"
      color="primary"
      prepend-icon="mdi-plus"
      @click="((error = null), (createOpen = true))"
      >New application</v-btn
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert
  ><v-select
    v-model="filters.status"
    :items="[
      'DRAFT',
      'SUBMITTED',
      'UNDER_REVIEW',
      'APPROVED',
      'REJECTED',
      'WAITLISTED',
      'ENROLLED',
    ]"
    label="Status"
    density="compact"
    clearable
    class="mb-2"
  /><v-data-table-server
    :headers="headers"
    :items="items"
    :items-length="total"
    :page="page"
    :loading="loading"
    @update:page="page = $event"
    ><template #[`item.status`]="{ item }"
      ><v-chip size="small">{{ item.status }}</v-chip></template
    ><template #[`item.actions`]="{ item }"
      ><v-btn
        v-if="auth.can('admission.manage') && item.status === 'SUBMITTED'"
        size="small"
        variant="text"
        @click="transition(item, 'UNDER_REVIEW')"
        >Review</v-btn
      ><v-btn
        v-if="
          auth.can('admission.manage') &&
          ['SUBMITTED', 'UNDER_REVIEW', 'WAITLISTED'].includes(item.status)
        "
        size="small"
        variant="text"
        @click="transition(item, 'APPROVED')"
        >Approve</v-btn
      ><v-btn
        v-if="auth.can('admission.manage') && item.status === 'APPROVED'"
        size="small"
        color="primary"
        variant="text"
        @click="enroll(item)"
        >Enroll</v-btn
      ><v-btn
        v-if="auth.can('admission.manage') && item.status !== 'ENROLLED'"
        size="small"
        variant="text"
        @click="transition(item, 'REJECTED')"
        >Reject</v-btn
      ></template
    ></v-data-table-server
  ><v-dialog v-model="createOpen" max-width="640"
    ><v-card
      ><v-card-title>Application</v-card-title
      ><v-card-text
        ><v-alert v-if="error" type="error" density="compact" class="mb-3">{{ error }}</v-alert
        ><v-autocomplete
          v-model="form.programId"
          :items="programs"
          item-title="name"
          item-value="id"
          label="Program" /><v-autocomplete
          v-model="form.classSectionId"
          :items="classes"
          item-title="name"
          item-value="id"
          label="Desired class"
          clearable /><v-text-field
          v-model="form.academicYear"
          label="Academic year" /><v-text-field
          v-model="form.applicantFirstName"
          label="Applicant first name" /><v-text-field
          v-model="form.applicantLastName"
          label="Applicant last name" /><v-text-field
          v-model="form.guardianName"
          label="Guardian name" /><v-select
          v-model="form.guardianRelation"
          :items="['FATHER', 'MOTHER', 'GUARDIAN', 'OTHER']"
          label="Guardian relation" /><v-text-field
          v-model="form.guardianPhone"
          label="Guardian phone" /></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="createOpen = false">Cancel</v-btn
        ><v-btn color="primary" @click="createAdmission">Create</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>

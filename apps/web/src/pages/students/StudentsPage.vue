<script setup lang="ts">
import type { ApiListResponse, StudentDto } from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
interface Option {
  id: string;
  name: string;
  code?: string;
  academicYear?: string | null;
}
const auth = useAuthStore();
const router = useRouter();
const items = ref<StudentDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const classSections = ref<Option[]>([]);
const formOpen = ref(false);
const form = reactive({
  firstName: '',
  lastName: '',
  classSectionId: '',
  academicYear: '2026-27',
  rollNo: '',
  email: '',
  phone: '',
});
const filters = reactive({ search: '', classSectionId: '', status: '' });
const statuses = ['ACTIVE', 'INACTIVE', 'GRADUATED', 'WITHDRAWN', 'ALUMNI'];
const headers = [
  { title: 'Admission no', key: 'admissionNo' },
  { title: 'Name', key: 'displayName' },
  { title: 'Class', key: 'classSection.name' },
  { title: 'Roll no', key: 'rollNo' },
  { title: 'Status', key: 'status' },
  { title: 'Phone', key: 'phone' },
];
function query() {
  const p = new URLSearchParams({ page: String(page.value), pageSize: '25' });
  if (filters.search) p.set('search', filters.search);
  if (filters.classSectionId) p.set('classSectionId', filters.classSectionId);
  if (filters.status) p.set('status', filters.status);
  return p;
}
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await apiFetch<ApiListResponse<StudentDto>>(`/api/v1/students?${query()}`);
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function loadOptions() {
  const r = await apiFetch<ApiListResponse<Option>>('/api/v1/class-sections?pageSize=100');
  classSections.value = r.data;
}
async function createStudent() {
  try {
    const r = await apiFetch<{ data: StudentDto }>('/api/v1/students', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        rollNo: form.rollNo || null,
        email: form.email || null,
        phone: form.phone || null,
      }),
    });
    formOpen.value = false;
    await router.push({ name: 'student-detail', params: { id: r.data.id } });
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function openRow(_e: unknown, row: { item: StudentDto }) {
  void router.push({ name: 'student-detail', params: { id: row.item.id } });
}
onMounted(async () => {
  await Promise.all([load(), loadOptions()]);
});
watch([page, () => filters.classSectionId, () => filters.status], load);
let timer: ReturnType<typeof setTimeout>;
watch(
  () => filters.search,
  () => {
    clearTimeout(timer);
    timer = setTimeout(load, 300);
  },
);
</script>
<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Students</h2>
    <v-spacer /><v-btn
      v-if="auth.can('student.create')"
      color="primary"
      prepend-icon="mdi-plus"
      @click="formOpen = true"
      >New student</v-btn
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <v-row dense class="mb-2"
    ><v-col cols="12" md="4"
      ><v-text-field
        v-model="filters.search"
        label="Search"
        density="compact"
        hide-details /></v-col
    ><v-col cols="12" md="4"
      ><v-autocomplete
        v-model="filters.classSectionId"
        :items="classSections"
        item-title="name"
        item-value="id"
        label="Class section"
        density="compact"
        clearable
        hide-details /></v-col
    ><v-col cols="12" md="4"
      ><v-select
        v-model="filters.status"
        :items="statuses"
        label="Status"
        density="compact"
        clearable
        hide-details /></v-col
  ></v-row>
  <v-data-table-server
    :headers="headers"
    :items="items"
    :items-length="total"
    :page="page"
    :loading="loading"
    item-value="id"
    hover
    @update:page="page = $event"
    @click:row="openRow"
    ><template #[`item.status`]="{ item }"
      ><v-chip size="small">{{ item.status }}</v-chip></template
    ></v-data-table-server
  >
  <v-dialog v-model="formOpen" max-width="640"
    ><v-card
      ><v-card-title>New student</v-card-title
      ><v-card-text
        ><v-row dense
          ><v-col cols="12" md="6"
            ><v-text-field v-model="form.firstName" label="First name" /></v-col
          ><v-col cols="12" md="6"><v-text-field v-model="form.lastName" label="Last name" /></v-col
          ><v-col cols="12"
            ><v-autocomplete
              v-model="form.classSectionId"
              :items="classSections"
              item-title="name"
              item-value="id"
              label="Class section" /></v-col
          ><v-col cols="12" md="4"
            ><v-text-field v-model="form.academicYear" label="Academic year" /></v-col
          ><v-col cols="12" md="4"><v-text-field v-model="form.rollNo" label="Roll no" /></v-col
          ><v-col cols="12" md="4"><v-text-field v-model="form.phone" label="Phone" /></v-col
          ><v-col cols="12"
            ><v-text-field v-model="form.email" label="Email" /></v-col></v-row></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="formOpen = false">Cancel</v-btn
        ><v-btn color="primary" @click="createStudent">Create</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>

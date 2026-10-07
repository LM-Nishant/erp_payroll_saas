<script setup lang="ts">
import { SUBJECT_TYPES, type ApiListResponse, type SubjectDto } from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useAcademicOptions } from './useAcademics';

const auth = useAuthStore();
const { programs, load: loadOptions } = useAcademicOptions();
const items = ref<SubjectDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const filters = reactive({ programId: '', search: '' });
const dialog = ref(false);
const editingId = ref<string | null>(null);
const blank = () => ({
  programId: '',
  code: '',
  name: '',
  type: 'THEORY' as SubjectDto['type'],
  credits: 4 as number | null,
  maxMarks: 100,
  passMarks: 35,
  status: 'ACTIVE' as SubjectDto['status'],
});
const form = reactive(blank());
const canManage = computed(() => auth.can('subject.manage'));
const headers = [
  { title: 'Code', key: 'code' },
  { title: 'Name', key: 'name' },
  { title: 'Program', key: 'program.name' },
  { title: 'Type', key: 'type' },
  { title: 'Credits', key: 'credits' },
  { title: 'Max / pass', key: 'marks', sortable: false },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const p = new URLSearchParams({ page: String(page.value), pageSize: '25' });
    if (filters.programId) p.set('programId', filters.programId);
    if (filters.search) p.set('search', filters.search);
    const r = await apiFetch<ApiListResponse<SubjectDto>>(`/api/v1/subjects?${p}`);
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function openNew() {
  Object.assign(form, blank(), { programId: filters.programId });
  editingId.value = null;
  dialog.value = true;
}
function openEdit(s: SubjectDto) {
  Object.assign(form, {
    programId: s.programId,
    code: s.code,
    name: s.name,
    type: s.type,
    credits: s.credits,
    maxMarks: s.maxMarks,
    passMarks: s.passMarks,
    status: s.status,
  });
  editingId.value = s.id;
  dialog.value = true;
}
async function save() {
  error.value = null;
  try {
    const body = {
      ...form,
      credits: form.credits === null || String(form.credits) === '' ? null : Number(form.credits),
      maxMarks: Number(form.maxMarks),
      passMarks: Number(form.passMarks),
    };
    if (editingId.value) {
      const { programId: _p, ...patch } = body;
      await apiFetch(`/api/v1/subjects/${editingId.value}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    } else {
      await apiFetch('/api/v1/subjects', { method: 'POST', body: JSON.stringify(body) });
    }
    dialog.value = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function remove(s: SubjectDto) {
  if (!confirm(`Delete subject ${s.name}?`)) return;
  try {
    await apiFetch(`/api/v1/subjects/${s.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await Promise.all([load(), loadOptions()]);
});
watch([page, () => filters.programId], load);
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
    <h2 class="text-h5">Subjects</h2>
    <v-spacer /><v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" @click="openNew"
      >New subject</v-btn
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-row dense class="mb-2"
    ><v-col cols="12" md="6"
      ><v-autocomplete
        v-model="filters.programId"
        :items="programs"
        item-title="name"
        item-value="id"
        label="Program"
        density="compact"
        clearable
        hide-details /></v-col
    ><v-col cols="12" md="6"
      ><v-text-field
        v-model="filters.search"
        label="Search"
        density="compact"
        hide-details /></v-col
  ></v-row>
  <v-data-table-server
    :headers="headers"
    :items="items"
    :items-length="total"
    :page="page"
    :loading="loading"
    items-per-page="25"
    item-value="id"
    @update:page="page = $event"
    ><template #[`item.marks`]="{ item }">{{ item.maxMarks }} / {{ item.passMarks }}</template
    ><template #[`item.type`]="{ item }"
      ><v-chip size="small">{{ item.type }}</v-chip></template
    ><template #[`item.actions`]="{ item }"
      ><template v-if="canManage"
        ><v-btn icon="mdi-pencil" size="small" variant="text" @click="openEdit(item)" /><v-btn
          icon="mdi-delete"
          size="small"
          variant="text"
          color="error"
          @click="remove(item)" /></template></template
  ></v-data-table-server>
  <v-dialog v-model="dialog" max-width="640"
    ><v-card
      ><v-card-title>{{ editingId ? 'Edit subject' : 'New subject' }}</v-card-title
      ><v-card-text
        ><v-row dense
          ><v-col cols="12"
            ><v-autocomplete
              v-model="form.programId"
              :items="programs"
              item-title="name"
              item-value="id"
              label="Program"
              :disabled="!!editingId" /></v-col
          ><v-col cols="12" md="4"><v-text-field v-model="form.code" label="Code" /></v-col
          ><v-col cols="12" md="8"><v-text-field v-model="form.name" label="Name" /></v-col
          ><v-col cols="12" md="4"
            ><v-select v-model="form.type" :items="[...SUBJECT_TYPES]" label="Type" /></v-col
          ><v-col cols="12" md="4"
            ><v-text-field v-model.number="form.credits" type="number" label="Credits" /></v-col
          ><v-col cols="12" md="4"
            ><v-select
              v-model="form.status"
              :items="['ACTIVE', 'INACTIVE']"
              label="Status" /></v-col
          ><v-col cols="12" md="6"
            ><v-text-field v-model.number="form.maxMarks" type="number" label="Max marks" /></v-col
          ><v-col cols="12" md="6"
            ><v-text-field
              v-model.number="form.passMarks"
              type="number"
              label="Pass marks" /></v-col></v-row></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="dialog = false">Cancel</v-btn
        ><v-btn color="primary" @click="save">Save</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>

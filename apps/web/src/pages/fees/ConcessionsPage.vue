<script setup lang="ts">
import type { ApiListResponse, FeeConcessionDto, FeeHeadDto } from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import StudentPicker from './StudentPicker.vue';
import { errorText, loadInstitutions, money, qs, type Option } from './fees';

const auth = useAuthStore();
const canEdit = computed(() => auth.can('fee.concession'));
const items = ref<FeeConcessionDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const institutions = ref<Option[]>([]);
const heads = ref<FeeHeadDto[]>([]);
const filters = reactive({ institutionId: '', appliesTo: '' });
const headers = [
  { title: 'Name', key: 'name' },
  { title: 'Kind', key: 'kind' },
  { title: 'Applies to', key: 'appliesTo' },
  { title: 'Student / category', key: 'target' },
  { title: 'Value', key: 'value', align: 'end' as const },
  { title: 'Year', key: 'academicYear' },
  { title: 'Active', key: 'active' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await apiFetch<ApiListResponse<FeeConcessionDto>>(
      `/api/v1/fees/concessions?${qs({ page: page.value, pageSize: 25, ...filters })}`,
    );
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
const dialog = ref(false);
const form = reactive({
  institutionId: '',
  name: '',
  kind: 'CONCESSION',
  appliesTo: 'STUDENT',
  studentId: null as string | null,
  category: '',
  feeHeadId: null as string | null,
  valueType: 'PERCENT',
  value: 10,
  academicYear: '2026-27',
  reason: '',
});
function openCreate() {
  Object.assign(form, {
    institutionId: institutions.value[0]?.id ?? '',
    name: '',
    kind: 'CONCESSION',
    appliesTo: 'STUDENT',
    studentId: null,
    category: '',
    feeHeadId: null,
    valueType: 'PERCENT',
    value: 10,
    academicYear: '2026-27',
    reason: '',
  });
  dialog.value = true;
}
async function save() {
  try {
    await apiFetch('/api/v1/fees/concessions', {
      method: 'POST',
      body: JSON.stringify({
        institutionId: form.appliesTo === 'STUDENT' ? undefined : form.institutionId,
        name: form.name,
        kind: form.kind,
        appliesTo: form.appliesTo,
        studentId: form.appliesTo === 'STUDENT' ? form.studentId : null,
        category: form.appliesTo === 'CATEGORY' ? form.category : null,
        feeHeadId: form.feeHeadId,
        valueType: form.valueType,
        value: Number(form.value),
        academicYear: form.academicYear || null,
        reason: form.reason || null,
      }),
    });
    dialog.value = false;
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
async function toggle(c: FeeConcessionDto) {
  try {
    await apiFetch(`/api/v1/fees/concessions/${c.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !c.active }),
    });
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(async () => {
  institutions.value = await loadInstitutions();
  heads.value = (
    await apiFetch<ApiListResponse<FeeHeadDto>>('/api/v1/fees/heads?pageSize=100').catch(() => ({
      data: [] as FeeHeadDto[],
    }))
  ).data;
  await load();
});
watch([page, () => ({ ...filters })], load, { deep: true });
</script>
<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Concessions &amp; scholarships</h2>
    <v-spacer /><v-btn v-if="canEdit" color="primary" prepend-icon="mdi-plus" @click="openCreate"
      >New concession</v-btn
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-row dense class="mb-2"
    ><v-col cols="12" md="6"
      ><v-select
        v-model="filters.institutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Institution"
        clearable
        density="compact"
        hide-details /></v-col
    ><v-col cols="12" md="6"
      ><v-select
        v-model="filters.appliesTo"
        :items="['STUDENT', 'CATEGORY', 'SIBLING']"
        label="Applies to"
        clearable
        density="compact"
        hide-details /></v-col
  ></v-row>
  <v-data-table-server
    :headers="headers"
    :items="items"
    :items-length="total"
    :page="page"
    :loading="loading"
    item-value="id"
    @update:page="page = $event"
  >
    <template #[`item.target`]="{ item }">{{ item.studentName ?? item.category ?? '—' }}</template>
    <template #[`item.value`]="{ item }">{{
      item.valueType === 'PERCENT' ? `${item.value}%` : money(item.value)
    }}</template>
    <template #[`item.active`]="{ item }">{{ item.active ? 'Yes' : 'No' }}</template>
    <template #[`item.actions`]="{ item }"
      ><v-btn v-if="canEdit" size="small" variant="text" @click="toggle(item)">{{
        item.active ? 'Deactivate' : 'Activate'
      }}</v-btn></template
    >
  </v-data-table-server>
  <v-dialog v-model="dialog" max-width="640"
    ><v-card
      ><v-card-title>New concession</v-card-title
      ><v-card-text
        ><v-row dense
          ><v-col cols="12" md="6"><v-text-field v-model="form.name" label="Name" /></v-col
          ><v-col cols="6" md="3"
            ><v-select
              v-model="form.kind"
              :items="['CONCESSION', 'SCHOLARSHIP', 'SIBLING']"
              label="Kind" /></v-col
          ><v-col cols="6" md="3"
            ><v-select
              v-model="form.appliesTo"
              :items="['STUDENT', 'CATEGORY', 'SIBLING']"
              label="Applies to" /></v-col
          ><v-col v-if="form.appliesTo === 'STUDENT'" cols="12"
            ><StudentPicker v-model="form.studentId" /></v-col
          ><template v-else
            ><v-col cols="12" md="6"
              ><v-select
                v-model="form.institutionId"
                :items="institutions"
                item-title="name"
                item-value="id"
                label="Institution" /></v-col
            ><v-col v-if="form.appliesTo === 'CATEGORY'" cols="12" md="6"
              ><v-text-field
                v-model="form.category"
                label="Student category (e.g. EWS, STAFF_WARD)" /></v-col></template
          ><v-col cols="12" md="6"
            ><v-select
              v-model="form.feeHeadId"
              :items="heads"
              item-title="name"
              item-value="id"
              label="Fee head (blank = all heads)"
              clearable /></v-col
          ><v-col cols="6" md="3"
            ><v-select
              v-model="form.valueType"
              :items="['PERCENT', 'AMOUNT']"
              label="Type" /></v-col
          ><v-col cols="6" md="3"
            ><v-text-field v-model.number="form.value" label="Value" type="number" /></v-col
          ><v-col cols="6"><v-text-field v-model="form.academicYear" label="Academic year" /></v-col
          ><v-col cols="6"
            ><v-text-field v-model="form.reason" label="Reason" /></v-col></v-row></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="dialog = false">Cancel</v-btn
        ><v-btn color="primary" @click="save">Create</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>

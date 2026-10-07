<script setup lang="ts">
import type { ApiListResponse, FeeHeadDto, FeeLateRuleDto, FeeStructureDto } from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import {
  errorText,
  loadClassSections,
  loadInstitutions,
  money,
  qs,
  todayStr,
  type Option,
} from './fees';

const auth = useAuthStore();
const canManage = computed(() => auth.can('fee.manage'));
const items = ref<FeeStructureDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const info = ref<string | null>(null);
const institutions = ref<Option[]>([]);
const sections = ref<Option[]>([]);
const heads = ref<FeeHeadDto[]>([]);
const rules = ref<FeeLateRuleDto[]>([]);
const filters = reactive({ institutionId: '', academicYear: '2026-27', status: '' });
const headers = [
  { title: 'Code', key: 'code' },
  { title: 'Name', key: 'name' },
  { title: 'Year', key: 'academicYear' },
  { title: 'Class section', key: 'classSectionId' },
  { title: 'Total', key: 'totalAmount', align: 'end' as const },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
const sectionName = (id: string | null) =>
  id ? (sections.value.find((s) => s.id === id)?.name ?? '…') : 'All sections';

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await apiFetch<ApiListResponse<FeeStructureDto>>(
      `/api/v1/fees/structures?${qs({ page: page.value, pageSize: 25, ...filters })}`,
    );
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

/* ---- create ---- */
interface InstallmentForm {
  label: string;
  dueDate: string;
  items: Array<{ feeHeadId: string; amount: number }>;
}
const dialog = ref(false);
const form = reactive({
  institutionId: '',
  classSectionId: '' as string | null,
  academicYear: '2026-27',
  code: '',
  name: '',
  lateRuleId: null as string | null,
  installments: [] as InstallmentForm[],
});
const formSections = computed(() =>
  sections.value.filter((s) => !form.institutionId || s.institutionId === form.institutionId),
);
const formHeads = computed(() =>
  heads.value.filter((h) => !h.institutionId || h.institutionId === form.institutionId),
);
const formRules = computed(() => rules.value.filter((r) => r.institutionId === form.institutionId));
const formTotal = computed(() =>
  form.installments.reduce(
    (s, i) => s + i.items.reduce((t, it) => t + (Number(it.amount) || 0), 0),
    0,
  ),
);
function addInstallment() {
  form.installments.push({
    label: `Term ${form.installments.length + 1}`,
    dueDate: todayStr(),
    items: [{ feeHeadId: formHeads.value[0]?.id ?? '', amount: 0 }],
  });
}
function openCreate() {
  Object.assign(form, {
    institutionId: institutions.value[0]?.id ?? '',
    classSectionId: null,
    academicYear: '2026-27',
    code: '',
    name: '',
    lateRuleId: null,
    installments: [],
  });
  addInstallment();
  dialog.value = true;
}
async function save() {
  try {
    await apiFetch('/api/v1/fees/structures', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        classSectionId: form.classSectionId || null,
        installments: form.installments.map((i) => ({
          ...i,
          items: i.items.map((it) => ({ feeHeadId: it.feeHeadId, amount: Number(it.amount) })),
        })),
      }),
    });
    dialog.value = false;
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}

/* ---- detail / generate ---- */
const detail = ref<FeeStructureDto | null>(null);
async function openDetail(s: FeeStructureDto) {
  try {
    detail.value = (
      await apiFetch<{ data: FeeStructureDto }>(`/api/v1/fees/structures/${s.id}`)
    ).data;
  } catch (e) {
    error.value = errorText(e);
  }
}
async function generate(s: FeeStructureDto) {
  if (!confirm(`Generate invoices for all students covered by ${s.name}?`)) return;
  try {
    const r = await apiFetch<{ data: { created: number; skipped: number; students: number } }>(
      '/api/v1/fees/invoices/generate',
      { method: 'POST', body: JSON.stringify({ structureId: s.id }) },
    );
    info.value = `Generated ${r.data.created} invoice(s) for ${r.data.students} student(s); ${r.data.skipped} already existed.`;
  } catch (e) {
    error.value = errorText(e);
  }
}
async function setStatus(s: FeeStructureDto, status: string) {
  try {
    await apiFetch(`/api/v1/fees/structures/${s.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(async () => {
  const [i, s, h, r] = await Promise.all([
    loadInstitutions(),
    loadClassSections(),
    apiFetch<ApiListResponse<FeeHeadDto>>('/api/v1/fees/heads?pageSize=100&active=true').catch(
      () => ({ data: [] as FeeHeadDto[] }),
    ),
    apiFetch<{ data: FeeLateRuleDto[] }>('/api/v1/fees/late-rules').catch(() => ({
      data: [] as FeeLateRuleDto[],
    })),
  ]);
  institutions.value = i;
  sections.value = s;
  heads.value = h.data;
  rules.value = r.data;
  await load();
});
watch([page, () => ({ ...filters })], load, { deep: true });
const onRow = (_e: unknown, r: { item: FeeStructureDto }) => openDetail(r.item);
</script>
<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Fee structures</h2>
    <v-spacer /><v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" @click="openCreate"
      >New structure</v-btn
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-alert v-if="info" type="success" class="mb-3" closable @click:close="info = null">{{
    info
  }}</v-alert>
  <v-row dense class="mb-2"
    ><v-col cols="12" md="4"
      ><v-select
        v-model="filters.institutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Institution"
        clearable
        density="compact"
        hide-details /></v-col
    ><v-col cols="6" md="4"
      ><v-text-field
        v-model="filters.academicYear"
        label="Academic year"
        density="compact"
        hide-details /></v-col
    ><v-col cols="6" md="4"
      ><v-select
        v-model="filters.status"
        :items="['DRAFT', 'ACTIVE', 'ARCHIVED']"
        label="Status"
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
    hover
    @update:page="page = $event"
    @click:row="onRow"
  >
    <template #[`item.classSectionId`]="{ item }">{{ sectionName(item.classSectionId) }}</template>
    <template #[`item.totalAmount`]="{ item }">{{ money(item.totalAmount) }}</template>
    <template #[`item.status`]="{ item }"
      ><v-chip size="small">{{ item.status }}</v-chip></template
    >
    <template #[`item.actions`]="{ item }">
      <template v-if="canManage">
        <v-btn
          v-if="item.status === 'ACTIVE'"
          size="small"
          variant="tonal"
          class="mr-1"
          @click.stop="generate(item)"
          >Generate invoices</v-btn
        >
        <v-btn
          v-if="item.status !== 'ACTIVE'"
          size="small"
          variant="text"
          @click.stop="setStatus(item, 'ACTIVE')"
          >Activate</v-btn
        >
        <v-btn v-else size="small" variant="text" @click.stop="setStatus(item, 'ARCHIVED')"
          >Archive</v-btn
        >
      </template>
    </template>
  </v-data-table-server>

  <v-dialog :model-value="!!detail" max-width="720" @update:model-value="detail = null"
    ><v-card v-if="detail"
      ><v-card-title>{{ detail.name }} ({{ detail.code }})</v-card-title
      ><v-card-subtitle
        >{{ detail.academicYear }} · {{ sectionName(detail.classSectionId) }} · Total
        {{ money(detail.totalAmount) }}</v-card-subtitle
      ><v-card-text>
        <v-table density="compact">
          <thead>
            <tr>
              <th>#</th>
              <th>Installment</th>
              <th>Due date</th>
              <th>Heads</th>
              <th class="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in detail.installments" :key="i.id">
              <td>{{ i.seq }}</td>
              <td>{{ i.label }}</td>
              <td>{{ i.dueDate }}</td>
              <td>
                <div v-for="it in i.items" :key="it.id">
                  {{ it.feeHeadName }}: {{ money(it.amount) }}
                </div>
              </td>
              <td class="text-right">{{ money(i.total) }}</td>
            </tr>
          </tbody>
        </v-table></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn @click="detail = null">Close</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >

  <v-dialog v-model="dialog" max-width="900"
    ><v-card
      ><v-card-title>New fee structure</v-card-title
      ><v-card-text
        ><v-row dense
          ><v-col cols="12" md="6"
            ><v-select
              v-model="form.institutionId"
              :items="institutions"
              item-title="name"
              item-value="id"
              label="Institution" /></v-col
          ><v-col cols="12" md="6"
            ><v-autocomplete
              v-model="form.classSectionId"
              :items="formSections"
              item-title="name"
              item-value="id"
              label="Class section (blank = whole institution)"
              clearable /></v-col
          ><v-col cols="4"><v-text-field v-model="form.code" label="Code" /></v-col
          ><v-col cols="8"><v-text-field v-model="form.name" label="Name" /></v-col
          ><v-col cols="6"><v-text-field v-model="form.academicYear" label="Academic year" /></v-col
          ><v-col cols="6"
            ><v-select
              v-model="form.lateRuleId"
              :items="formRules"
              item-title="name"
              item-value="id"
              label="Late-fee rule"
              clearable /></v-col
        ></v-row>
        <div class="d-flex align-center my-2">
          <strong>Installments</strong><v-spacer />Total {{ money(formTotal) }}
          <v-btn size="small" variant="text" prepend-icon="mdi-plus" @click="addInstallment"
            >Installment</v-btn
          >
        </div>
        <v-card v-for="(inst, idx) in form.installments" :key="idx" variant="outlined" class="mb-2"
          ><v-card-text
            ><v-row dense
              ><v-col cols="6"><v-text-field v-model="inst.label" label="Label" /></v-col
              ><v-col cols="4"
                ><v-text-field v-model="inst.dueDate" label="Due date" type="date" /></v-col
              ><v-col cols="2"
                ><v-btn
                  icon="mdi-delete"
                  variant="text"
                  @click="form.installments.splice(idx, 1)" /></v-col
            ></v-row>
            <v-row v-for="(it, j) in inst.items" :key="j" dense
              ><v-col cols="7"
                ><v-select
                  v-model="it.feeHeadId"
                  :items="formHeads"
                  item-title="name"
                  item-value="id"
                  label="Fee head"
                  density="compact" /></v-col
              ><v-col cols="3"
                ><v-text-field
                  v-model.number="it.amount"
                  label="Amount"
                  type="number"
                  density="compact" /></v-col
              ><v-col cols="2"
                ><v-btn
                  icon="mdi-close"
                  variant="text"
                  size="small"
                  @click="inst.items.splice(j, 1)" /></v-col
            ></v-row>
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-plus"
              @click="inst.items.push({ feeHeadId: '', amount: 0 })"
              >Head</v-btn
            ></v-card-text
          ></v-card
        ></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="dialog = false">Cancel</v-btn
        ><v-btn color="primary" @click="save">Create</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>

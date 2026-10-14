<script setup lang="ts">
import type { FeeHeadDto, FeeLateRuleDto } from '@erp/shared';
import { FEE_HEAD_CATEGORIES } from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { PAGE_SIZE_OPTIONS, useServerList } from '@/lib/serverList';
import { useAuthStore } from '@/stores/auth';
import { errorText, loadInstitutions, money, type Option } from './fees';

const auth = useAuthStore();
const canManage = computed(() => auth.can('fee.manage'));
const tab = ref('heads');
const institutions = ref<Option[]>([]);
const error = ref<string | null>(null);
const listOptions = { immediate: false, onError: (e: unknown) => (error.value = errorText(e)) };
const headList = useServerList<FeeHeadDto>('/api/v1/fees/heads', listOptions);
const ruleList = useServerList<FeeLateRuleDto>('/api/v1/fees/late-rules', listOptions);
const { items: heads } = headList;
const { items: rules } = ruleList;
const instName = (id: string | null) =>
  id ? (institutions.value.find((i) => i.id === id)?.name ?? id) : 'All institutions';

const headDialog = ref(false);
const editingHead = ref<FeeHeadDto | null>(null);
const headForm = reactive({
  institutionId: null as string | null,
  code: '',
  name: '',
  category: 'TUITION',
  refundable: false,
  taxRate: 0,
  sortOrder: 0,
  active: true,
});
const ruleDialog = ref(false);
const ruleForm = reactive({
  institutionId: '',
  name: '',
  mode: 'FLAT',
  amount: 100,
  graceDays: 0,
  maxAmount: null as number | null,
});

async function load() {
  error.value = null;
  await Promise.all([headList.load(), ruleList.load()]);
}
function newHead() {
  editingHead.value = null;
  Object.assign(headForm, {
    institutionId: null,
    code: '',
    name: '',
    category: 'TUITION',
    refundable: false,
    taxRate: 0,
    sortOrder: 0,
    active: true,
  });
  headDialog.value = true;
}
function editHead(h: FeeHeadDto) {
  editingHead.value = h;
  Object.assign(headForm, {
    institutionId: h.institutionId,
    code: h.code,
    name: h.name,
    category: h.category,
    refundable: h.refundable,
    taxRate: h.taxRate,
    sortOrder: h.sortOrder,
    active: h.active,
  });
  headDialog.value = true;
}
async function saveHead() {
  try {
    const { institutionId, code, ...rest } = headForm;
    if (editingHead.value) {
      await apiFetch(`/api/v1/fees/heads/${editingHead.value.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...rest, taxRate: Number(rest.taxRate) }),
      });
    } else {
      await apiFetch('/api/v1/fees/heads', {
        method: 'POST',
        body: JSON.stringify({ institutionId, code, ...rest, taxRate: Number(rest.taxRate) }),
      });
    }
    headDialog.value = false;
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
async function removeHead(h: FeeHeadDto) {
  if (!confirm(`Delete fee head ${h.name}?`)) return;
  try {
    await apiFetch(`/api/v1/fees/heads/${h.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
async function saveRule() {
  try {
    await apiFetch('/api/v1/fees/late-rules', {
      method: 'POST',
      body: JSON.stringify({
        ...ruleForm,
        amount: Number(ruleForm.amount),
        graceDays: Number(ruleForm.graceDays),
        maxAmount: ruleForm.maxAmount ? Number(ruleForm.maxAmount) : null,
      }),
    });
    ruleDialog.value = false;
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
async function removeRule(r: FeeLateRuleDto) {
  if (!confirm(`Delete late-fee rule ${r.name}?`)) return;
  try {
    await apiFetch(`/api/v1/fees/late-rules/${r.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
const headHeaders = [
  { title: 'Code', key: 'code' },
  { title: 'Name', key: 'name' },
  { title: 'Category', key: 'category' },
  { title: 'Scope', key: 'institutionId' },
  { title: 'Refundable', key: 'refundable' },
  { title: 'Tax %', key: 'taxRate' },
  { title: 'Active', key: 'active' },
  { title: '', key: 'actions', align: 'end' as const },
];
const ruleHeaders = [
  { title: 'Name', key: 'name' },
  { title: 'Institution', key: 'institutionId' },
  { title: 'Mode', key: 'mode' },
  { title: 'Amount', key: 'amount' },
  { title: 'Grace days', key: 'graceDays' },
  { title: 'Cap', key: 'maxAmount' },
  { title: '', key: 'actions', align: 'end' as const },
];
onMounted(async () => {
  institutions.value = await loadInstitutions();
  await load();
});
</script>
<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Fee heads &amp; late-fee rules</h2>
    <v-spacer />
    <v-btn
      v-if="canManage && tab === 'heads'"
      color="primary"
      prepend-icon="mdi-plus"
      @click="newHead"
      >New fee head</v-btn
    >
    <v-btn
      v-if="canManage && tab === 'rules'"
      color="primary"
      prepend-icon="mdi-plus"
      @click="ruleDialog = true"
      >New late-fee rule</v-btn
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-tabs v-model="tab" class="mb-3"
    ><v-tab value="heads">Fee heads</v-tab><v-tab value="rules">Late-fee rules</v-tab></v-tabs
  >
  <v-data-table-server
    v-if="tab === 'heads'"
    v-model:page="headList.page.value"
    v-model:items-per-page="headList.pageSize.value"
    :items-length="headList.total.value"
    :loading="headList.loading.value"
    :items-per-page-options="PAGE_SIZE_OPTIONS"
    :items="heads"
    :headers="headHeaders"
    density="compact"
    disable-sort
  >
    <template #[`item.institutionId`]="{ item: h }">{{ instName(h.institutionId) }}</template>
    <template #[`item.refundable`]="{ item: h }">{{ h.refundable ? 'Yes' : 'No' }}</template>
    <template #[`item.active`]="{ item: h }">{{ h.active ? 'Yes' : 'No' }}</template>
    <template #[`item.actions`]="{ item: h }">
      <template v-if="canManage"
        ><v-btn size="small" variant="text" icon="mdi-pencil" @click="editHead(h)" /><v-btn
          size="small"
          variant="text"
          icon="mdi-delete"
          @click="removeHead(h)"
      /></template>
    </template>
  </v-data-table-server>
  <v-data-table-server
    v-else
    v-model:page="ruleList.page.value"
    v-model:items-per-page="ruleList.pageSize.value"
    :items-length="ruleList.total.value"
    :loading="ruleList.loading.value"
    :items-per-page-options="PAGE_SIZE_OPTIONS"
    :items="rules"
    :headers="ruleHeaders"
    density="compact"
    disable-sort
  >
    <template #[`item.institutionId`]="{ item: r }">{{ instName(r.institutionId) }}</template>
    <template #[`item.mode`]="{ item: r }">{{
      r.mode === 'PER_DAY' ? 'Per day' : 'Flat'
    }}</template>
    <template #[`item.amount`]="{ item: r }">{{ money(r.amount) }}</template>
    <template #[`item.maxAmount`]="{ item: r }">{{
      r.maxAmount ? money(r.maxAmount) : '—'
    }}</template>
    <template #[`item.actions`]="{ item: r }">
      <v-btn
        v-if="canManage"
        size="small"
        variant="text"
        icon="mdi-delete"
        @click="removeRule(r)"
      />
    </template>
  </v-data-table-server>

  <v-dialog v-model="headDialog" max-width="560"
    ><v-card
      ><v-card-title>{{ editingHead ? 'Edit fee head' : 'New fee head' }}</v-card-title
      ><v-card-text
        ><v-row dense
          ><v-col cols="12"
            ><v-select
              v-model="headForm.institutionId"
              :items="[{ id: null, name: 'All institutions' }, ...institutions]"
              item-title="name"
              item-value="id"
              label="Institution"
              :disabled="!!editingHead" /></v-col
          ><v-col cols="4"
            ><v-text-field v-model="headForm.code" label="Code" :disabled="!!editingHead" /></v-col
          ><v-col cols="8"><v-text-field v-model="headForm.name" label="Name" /></v-col
          ><v-col cols="6"
            ><v-select
              v-model="headForm.category"
              :items="[...FEE_HEAD_CATEGORIES] as string[]"
              label="Category" /></v-col
          ><v-col cols="3"
            ><v-text-field v-model.number="headForm.taxRate" label="Tax %" type="number" /></v-col
          ><v-col cols="3"
            ><v-text-field v-model.number="headForm.sortOrder" label="Order" type="number" /></v-col
          ><v-col cols="6"><v-switch v-model="headForm.refundable" label="Refundable" /></v-col
          ><v-col cols="6"
            ><v-switch v-model="headForm.active" label="Active" /></v-col></v-row></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="headDialog = false">Cancel</v-btn
        ><v-btn color="primary" @click="saveHead">Save</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
  <v-dialog v-model="ruleDialog" max-width="560"
    ><v-card
      ><v-card-title>New late-fee rule</v-card-title
      ><v-card-text
        ><v-row dense
          ><v-col cols="12"
            ><v-select
              v-model="ruleForm.institutionId"
              :items="institutions"
              item-title="name"
              item-value="id"
              label="Institution" /></v-col
          ><v-col cols="12"><v-text-field v-model="ruleForm.name" label="Name" /></v-col
          ><v-col cols="6"
            ><v-select
              v-model="ruleForm.mode"
              :items="[
                { title: 'Flat', value: 'FLAT' },
                { title: 'Per day', value: 'PER_DAY' },
              ]"
              label="Mode" /></v-col
          ><v-col cols="6"
            ><v-text-field v-model.number="ruleForm.amount" label="Amount" type="number" /></v-col
          ><v-col cols="6"
            ><v-text-field
              v-model.number="ruleForm.graceDays"
              label="Grace days"
              type="number" /></v-col
          ><v-col cols="6"
            ><v-text-field
              v-model.number="ruleForm.maxAmount"
              label="Max amount (optional)"
              type="number" /></v-col></v-row></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="ruleDialog = false">Cancel</v-btn
        ><v-btn color="primary" @click="saveRule">Save</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>

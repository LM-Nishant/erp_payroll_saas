<script setup lang="ts">
import type { ApiListResponse, FeeHeadDto, FeeLateRuleDto } from '@erp/shared';
import { FEE_HEAD_CATEGORIES } from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { errorText, loadInstitutions, money, type Option } from './fees';

const auth = useAuthStore();
const canManage = computed(() => auth.can('fee.manage'));
const tab = ref('heads');
const heads = ref<FeeHeadDto[]>([]);
const rules = ref<FeeLateRuleDto[]>([]);
const institutions = ref<Option[]>([]);
const error = ref<string | null>(null);
const loading = ref(false);
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
  loading.value = true;
  error.value = null;
  try {
    const [h, r] = await Promise.all([
      apiFetch<ApiListResponse<FeeHeadDto>>('/api/v1/fees/heads?pageSize=100'),
      apiFetch<{ data: FeeLateRuleDto[] }>('/api/v1/fees/late-rules'),
    ]);
    heads.value = h.data;
    rules.value = r.data;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
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
  <v-table v-if="tab === 'heads'" density="compact">
    <thead>
      <tr>
        <th>Code</th>
        <th>Name</th>
        <th>Category</th>
        <th>Scope</th>
        <th>Refundable</th>
        <th>Tax %</th>
        <th>Active</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="h in heads" :key="h.id">
        <td>{{ h.code }}</td>
        <td>{{ h.name }}</td>
        <td>{{ h.category }}</td>
        <td>{{ instName(h.institutionId) }}</td>
        <td>{{ h.refundable ? 'Yes' : 'No' }}</td>
        <td>{{ h.taxRate }}</td>
        <td>{{ h.active ? 'Yes' : 'No' }}</td>
        <td class="text-right">
          <template v-if="canManage"
            ><v-btn size="small" variant="text" icon="mdi-pencil" @click="editHead(h)" /><v-btn
              size="small"
              variant="text"
              icon="mdi-delete"
              @click="removeHead(h)"
          /></template>
        </td>
      </tr>
    </tbody>
  </v-table>
  <v-table v-else density="compact">
    <thead>
      <tr>
        <th>Name</th>
        <th>Institution</th>
        <th>Mode</th>
        <th>Amount</th>
        <th>Grace days</th>
        <th>Cap</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="r in rules" :key="r.id">
        <td>{{ r.name }}</td>
        <td>{{ instName(r.institutionId) }}</td>
        <td>{{ r.mode === 'PER_DAY' ? 'Per day' : 'Flat' }}</td>
        <td>{{ money(r.amount) }}</td>
        <td>{{ r.graceDays }}</td>
        <td>{{ r.maxAmount ? money(r.maxAmount) : '—' }}</td>
        <td class="text-right">
          <v-btn
            v-if="canManage"
            size="small"
            variant="text"
            icon="mdi-delete"
            @click="removeRule(r)"
          />
        </td>
      </tr>
    </tbody>
  </v-table>

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

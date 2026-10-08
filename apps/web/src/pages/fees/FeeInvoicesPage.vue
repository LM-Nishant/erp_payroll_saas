<script setup lang="ts">
import type { ApiListResponse, FeeHeadDto, FeeInvoiceDto } from '@erp/shared';
import { FEE_INVOICE_STATUSES } from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import StudentPicker from './StudentPicker.vue';
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
const items = ref<FeeInvoiceDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const institutions = ref<Option[]>([]);
const sections = ref<Option[]>([]);
const heads = ref<FeeHeadDto[]>([]);
const filters = reactive({
  institutionId: '',
  classSectionId: '',
  studentId: null as string | null,
  status: '',
  overdue: false,
});
const headers = [
  { title: 'Invoice', key: 'number' },
  { title: 'Student', key: 'student.displayName' },
  { title: 'Description', key: 'description' },
  { title: 'Due', key: 'dueDate' },
  { title: 'Net', key: 'netAmount', align: 'end' as const },
  { title: 'Paid', key: 'paidAmount', align: 'end' as const },
  { title: 'Balance', key: 'balance', align: 'end' as const },
  { title: 'Status', key: 'status' },
];
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await apiFetch<ApiListResponse<FeeInvoiceDto>>(
      `/api/v1/fees/invoices?${qs({
        page: page.value,
        pageSize: 25,
        institutionId: filters.institutionId,
        classSectionId: filters.classSectionId,
        studentId: filters.studentId,
        status: filters.status,
        overdue: filters.overdue ? 'true' : undefined,
      })}`,
    );
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

const detail = ref<FeeInvoiceDto | null>(null);
async function openDetail(id: string) {
  try {
    detail.value = (await apiFetch<{ data: FeeInvoiceDto }>(`/api/v1/fees/invoices/${id}`)).data;
  } catch (e) {
    error.value = errorText(e);
  }
}
async function cancelInvoice() {
  if (!detail.value) return;
  const reason = prompt('Reason for cancelling this invoice?');
  if (!reason) return;
  try {
    await apiFetch(`/api/v1/fees/invoices/${detail.value.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    detail.value = null;
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}

const adhoc = ref(false);
const adhocForm = reactive({
  studentId: null as string | null,
  dueDate: todayStr(),
  description: '',
  lines: [{ feeHeadId: '', amount: 0 }],
});
async function saveAdhoc() {
  try {
    await apiFetch('/api/v1/fees/invoices', {
      method: 'POST',
      body: JSON.stringify({
        studentId: adhocForm.studentId,
        dueDate: adhocForm.dueDate,
        description: adhocForm.description || null,
        lines: adhocForm.lines.map((l) => ({ feeHeadId: l.feeHeadId, amount: Number(l.amount) })),
      }),
    });
    adhoc.value = false;
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(async () => {
  [institutions.value, sections.value] = await Promise.all([
    loadInstitutions(),
    loadClassSections(),
  ]);
  heads.value = (
    await apiFetch<ApiListResponse<FeeHeadDto>>(
      '/api/v1/fees/heads?pageSize=100&active=true',
    ).catch(() => ({ data: [] as FeeHeadDto[] }))
  ).data;
  await load();
});
watch([page, () => ({ ...filters })], load, { deep: true });
const onRow = (_e: unknown, r: { item: FeeInvoiceDto }) => openDetail(r.item.id);
</script>
<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Fee invoices</h2>
    <v-spacer /><v-btn
      v-if="canManage"
      color="primary"
      prepend-icon="mdi-plus"
      @click="adhoc = true"
      >Ad-hoc invoice</v-btn
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-row dense class="mb-2"
    ><v-col cols="12" md="3"
      ><v-select
        v-model="filters.institutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Institution"
        clearable
        density="compact"
        hide-details /></v-col
    ><v-col cols="12" md="3"
      ><v-autocomplete
        v-model="filters.classSectionId"
        :items="sections"
        item-title="name"
        item-value="id"
        label="Class section"
        clearable
        density="compact"
        hide-details /></v-col
    ><v-col cols="12" md="3"><StudentPicker v-model="filters.studentId" density="compact" /></v-col
    ><v-col cols="8" md="2"
      ><v-select
        v-model="filters.status"
        :items="[...FEE_INVOICE_STATUSES] as string[]"
        label="Status"
        clearable
        density="compact"
        hide-details /></v-col
    ><v-col cols="4" md="1"
      ><v-checkbox
        v-model="filters.overdue"
        label="Overdue"
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
    <template #[`item.netAmount`]="{ item }">{{ money(item.netAmount) }}</template>
    <template #[`item.paidAmount`]="{ item }">{{ money(item.paidAmount) }}</template>
    <template #[`item.balance`]="{ item }">{{ money(item.balance) }}</template>
    <template #[`item.status`]="{ item }"
      ><v-chip size="small">{{ item.status }}</v-chip></template
    >
  </v-data-table-server>

  <v-dialog :model-value="!!detail" max-width="720" @update:model-value="detail = null"
    ><v-card v-if="detail"
      ><v-card-title>Invoice {{ detail.number }}</v-card-title
      ><v-card-subtitle
        >{{ detail.student?.displayName }} · due {{ detail.dueDate }} ·
        {{ detail.status }}</v-card-subtitle
      ><v-card-text>
        <p v-if="detail.description" class="mb-2">{{ detail.description }}</p>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Head</th>
              <th class="text-right">Amount</th>
              <th class="text-right">Concession</th>
              <th class="text-right">Tax</th>
              <th class="text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in detail.lines" :key="l.id">
              <td>{{ l.feeHeadName }}</td>
              <td class="text-right">{{ money(l.amount) }}</td>
              <td class="text-right">{{ money(l.concessionAmount) }}</td>
              <td class="text-right">{{ money(l.taxAmount) }}</td>
              <td class="text-right">{{ money(l.netAmount) }}</td>
            </tr>
            <tr v-if="detail.lateFeeAmount">
              <td>Late fee</td>
              <td colspan="3"></td>
              <td class="text-right">{{ money(detail.lateFeeAmount) }}</td>
            </tr>
            <tr>
              <th>Total / paid / balance</th>
              <th colspan="2"></th>
              <th class="text-right">{{ money(detail.netAmount) }}</th>
              <th class="text-right">
                {{ money(detail.paidAmount) }} / {{ money(detail.balance) }}
              </th>
            </tr>
          </tbody>
        </v-table>
        <v-alert v-if="detail.cancelReason" type="warning" class="mt-2"
          >Cancelled: {{ detail.cancelReason }}</v-alert
        ></v-card-text
      ><v-card-actions
        ><v-btn
          v-if="canManage && detail.status !== 'CANCELLED' && detail.paidAmount === 0"
          color="error"
          variant="text"
          @click="cancelInvoice"
          >Cancel invoice</v-btn
        ><v-spacer /><v-btn @click="detail = null">Close</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >

  <v-dialog v-model="adhoc" max-width="640"
    ><v-card
      ><v-card-title>Ad-hoc invoice</v-card-title
      ><v-card-text
        ><v-row dense
          ><v-col cols="12"><StudentPicker v-model="adhocForm.studentId" /></v-col
          ><v-col cols="6"
            ><v-text-field v-model="adhocForm.dueDate" label="Due date" type="date" /></v-col
          ><v-col cols="6"
            ><v-text-field v-model="adhocForm.description" label="Description" /></v-col
        ></v-row>
        <v-row v-for="(l, i) in adhocForm.lines" :key="i" dense
          ><v-col cols="7"
            ><v-select
              v-model="l.feeHeadId"
              :items="heads"
              item-title="name"
              item-value="id"
              label="Fee head"
              density="compact" /></v-col
          ><v-col cols="3"
            ><v-text-field
              v-model.number="l.amount"
              label="Amount"
              type="number"
              density="compact" /></v-col
          ><v-col cols="2"
            ><v-btn
              icon="mdi-close"
              variant="text"
              size="small"
              @click="adhocForm.lines.splice(i, 1)"
          /></v-col>
        </v-row>
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-plus"
          @click="adhocForm.lines.push({ feeHeadId: '', amount: 0 })"
          >Line</v-btn
        ></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="adhoc = false">Cancel</v-btn
        ><v-btn color="primary" @click="saveAdhoc">Create</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>

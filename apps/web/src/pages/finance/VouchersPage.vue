<script setup lang="ts">
import type { ApiListResponse, JournalVoucherDto, LedgerAccountDto } from '@erp/shared';
import { VOUCHER_TYPES } from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { errorText, loadInstitutions, money, qs, todayStr, type Option } from '../fees/fees';

const auth = useAuthStore();
const canManage = computed(() => auth.can('finance.manage'));
const canPost = computed(() => auth.can('finance.post'));
const items = ref<JournalVoucherDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const institutions = ref<Option[]>([]);
const accounts = ref<LedgerAccountDto[]>([]);
const postable = computed(() => accounts.value.filter((a) => !a.isGroup && a.active));
const filters = reactive({
  institutionId: '',
  type: '',
  status: '',
  sourceType: '',
  from: '',
  to: '',
});
const headers = [
  { title: 'Number', key: 'number' },
  { title: 'Date', key: 'voucherDate' },
  { title: 'Type', key: 'type' },
  { title: 'Source', key: 'sourceType' },
  { title: 'Narration', key: 'narration' },
  { title: 'Amount', key: 'totalAmount', align: 'end' as const },
  { title: 'Status', key: 'status' },
];
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await apiFetch<ApiListResponse<JournalVoucherDto>>(
      `/api/v1/finance/vouchers?${qs({ page: page.value, pageSize: 25, ...filters })}`,
    );
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
const detail = ref<JournalVoucherDto | null>(null);
async function openDetail(id: string) {
  try {
    detail.value = (
      await apiFetch<{ data: JournalVoucherDto }>(`/api/v1/finance/vouchers/${id}`)
    ).data;
  } catch (e) {
    error.value = errorText(e);
  }
}
async function act(action: 'post' | 'cancel') {
  if (!detail.value) return;
  let body: string | undefined;
  if (action === 'cancel') {
    const reason = prompt('Reason for cancelling this voucher?');
    if (!reason) return;
    body = JSON.stringify({ reason });
  }
  try {
    await apiFetch(`/api/v1/finance/vouchers/${detail.value.id}/${action}`, {
      method: 'POST',
      ...(body ? { body } : {}),
    });
    detail.value = null;
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}

const dialog = ref(false);
const form = reactive({
  institutionId: '',
  voucherDate: todayStr(),
  type: 'JOURNAL',
  narration: '',
  post: true,
  lines: [] as Array<{ accountId: string; debit: number; credit: number; narration: string }>,
});
const totals = computed(() => ({
  debit: form.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0),
  credit: form.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0),
}));
const balanced = computed(
  () => totals.value.debit > 0 && Math.abs(totals.value.debit - totals.value.credit) < 0.005,
);
const blankLine = () => ({ accountId: '', debit: 0, credit: 0, narration: '' });
function openCreate() {
  Object.assign(form, {
    institutionId: institutions.value[0]?.id ?? '',
    voucherDate: todayStr(),
    type: 'JOURNAL',
    narration: '',
    post: true,
    lines: [blankLine(), blankLine()],
  });
  dialog.value = true;
}
async function save() {
  try {
    await apiFetch('/api/v1/finance/vouchers', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        post: form.post && canPost.value,
        narration: form.narration || null,
        lines: form.lines.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          narration: l.narration || null,
        })),
      }),
    });
    dialog.value = false;
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(async () => {
  institutions.value = await loadInstitutions();
  accounts.value = (
    await apiFetch<{ data: LedgerAccountDto[] }>('/api/v1/finance/accounts').catch(() => ({
      data: [] as LedgerAccountDto[],
    }))
  ).data;
  await load();
});
watch([page, () => ({ ...filters })], load, { deep: true });
const onRow = (_e: unknown, r: { item: JournalVoucherDto }) => openDetail(r.item.id);
</script>
<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Journal vouchers</h2>
    <v-spacer /><v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" @click="openCreate"
      >New voucher</v-btn
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
    ><v-col cols="6" md="2"
      ><v-select
        v-model="filters.type"
        :items="[...VOUCHER_TYPES] as string[]"
        label="Type"
        clearable
        density="compact"
        hide-details /></v-col
    ><v-col cols="6" md="2"
      ><v-select
        v-model="filters.status"
        :items="['DRAFT', 'POSTED', 'CANCELLED']"
        label="Status"
        clearable
        density="compact"
        hide-details /></v-col
    ><v-col cols="6" md="2"
      ><v-select
        v-model="filters.sourceType"
        :items="[
          'MANUAL',
          'FEE_INVOICE',
          'FEE_INVOICE_CANCEL',
          'FEE_LATE_FEE',
          'FEE_PAYMENT',
          'FEE_REFUND',
          'EXPENSE',
          'PAYROLL',
        ]"
        label="Source"
        clearable
        density="compact"
        hide-details /></v-col
    ><v-col cols="6" md="3" class="d-flex ga-2"
      ><v-text-field
        v-model="filters.from"
        label="From"
        type="date"
        density="compact"
        hide-details /><v-text-field
        v-model="filters.to"
        label="To"
        type="date"
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
    <template #[`item.totalAmount`]="{ item }">{{ money(item.totalAmount) }}</template>
    <template #[`item.status`]="{ item }"
      ><v-chip size="small">{{ item.status }}</v-chip></template
    >
  </v-data-table-server>

  <v-dialog :model-value="!!detail" max-width="760" @update:model-value="detail = null"
    ><v-card v-if="detail"
      ><v-card-title>{{ detail.type }} {{ detail.number }}</v-card-title
      ><v-card-subtitle
        >{{ detail.voucherDate }} · {{ detail.status }} · {{ detail.sourceType }}</v-card-subtitle
      ><v-card-text>
        <p v-if="detail.narration" class="mb-2">{{ detail.narration }}</p>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Account</th>
              <th>Narration</th>
              <th class="text-right">Debit</th>
              <th class="text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in detail.lines" :key="l.id">
              <td>{{ l.accountCode }} {{ l.accountName }}</td>
              <td>{{ l.narration }}</td>
              <td class="text-right">{{ l.debit ? money(l.debit) : '' }}</td>
              <td class="text-right">{{ l.credit ? money(l.credit) : '' }}</td>
            </tr>
          </tbody>
        </v-table>
        <v-alert v-if="detail.cancelReason" type="warning" class="mt-2"
          >Cancelled: {{ detail.cancelReason }}</v-alert
        ></v-card-text
      ><v-card-actions
        ><template v-if="canPost && detail.sourceType === 'MANUAL'"
          ><v-btn
            v-if="detail.status === 'DRAFT'"
            color="primary"
            variant="text"
            @click="act('post')"
            >Post</v-btn
          ><v-btn
            v-if="detail.status !== 'CANCELLED'"
            color="error"
            variant="text"
            @click="act('cancel')"
            >Cancel voucher</v-btn
          ></template
        ><v-spacer /><v-btn @click="detail = null">Close</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >

  <v-dialog v-model="dialog" max-width="900"
    ><v-card
      ><v-card-title>New voucher</v-card-title
      ><v-card-text
        ><v-row dense
          ><v-col cols="12" md="4"
            ><v-select
              v-model="form.institutionId"
              :items="institutions"
              item-title="name"
              item-value="id"
              label="Institution" /></v-col
          ><v-col cols="6" md="3"
            ><v-text-field v-model="form.voucherDate" label="Date" type="date" /></v-col
          ><v-col cols="6" md="2"
            ><v-select
              v-model="form.type"
              :items="[...VOUCHER_TYPES] as string[]"
              label="Type" /></v-col
          ><v-col cols="12" md="3"
            ><v-switch v-model="form.post" :disabled="!canPost" label="Post immediately" /></v-col
          ><v-col cols="12"><v-text-field v-model="form.narration" label="Narration" /></v-col
        ></v-row>
        <v-row v-for="(l, i) in form.lines" :key="i" dense
          ><v-col cols="12" md="5"
            ><v-autocomplete
              v-model="l.accountId"
              :items="postable"
              :item-title="(a: LedgerAccountDto) => `${a.code} ${a.name}`"
              item-value="id"
              label="Account"
              density="compact" /></v-col
          ><v-col cols="4" md="2"
            ><v-text-field
              v-model.number="l.debit"
              label="Debit"
              type="number"
              density="compact" /></v-col
          ><v-col cols="4" md="2"
            ><v-text-field
              v-model.number="l.credit"
              label="Credit"
              type="number"
              density="compact" /></v-col
          ><v-col cols="3" md="2"
            ><v-text-field v-model="l.narration" label="Note" density="compact" /></v-col
          ><v-col cols="1"
            ><v-btn icon="mdi-close" variant="text" size="small" @click="form.lines.splice(i, 1)"
          /></v-col>
        </v-row>
        <div class="d-flex align-center">
          <v-btn
            size="small"
            variant="text"
            prepend-icon="mdi-plus"
            @click="form.lines.push(blankLine())"
            >Line</v-btn
          ><v-spacer />
          <span :class="balanced ? 'text-success' : 'text-error'"
            >Dr {{ money(totals.debit) }} · Cr {{ money(totals.credit) }}
            {{ balanced ? '(balanced)' : '(not balanced)' }}</span
          >
        </div></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="dialog = false">Cancel</v-btn
        ><v-btn color="primary" :disabled="!balanced" @click="save">Save</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>

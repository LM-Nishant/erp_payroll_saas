<script setup lang="ts">
import {
  LIBRARY_FINE_STATUSES,
  type ApiListResponse,
  type LibraryFineDto,
  type LibraryLoanDto,
  type LibraryFineStatus,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import LibraryTabs from './LibraryTabs.vue';
import { STATUS_COLOR, fmtDate, money, qs, useLibraryInstitutions } from './library';

const auth = useAuthStore();
const { institutions, institutionId, loadInstitutions } = useLibraryInstitutions();
const tab = ref<'overdue' | 'fines'>('overdue');
const error = ref<string | null>(null);
const loading = ref(false);

const overdue = ref<LibraryLoanDto[]>([]);
const overdueTotal = ref(0);
const overduePage = ref(1);
const overdueHeaders = [
  { title: 'Title', key: 'book.title' },
  { title: 'Barcode', key: 'copy.barcode' },
  { title: 'Member', key: 'memberName' },
  { title: 'Type', key: 'memberType' },
  { title: 'Due', key: 'dueDate' },
  { title: 'Days late', key: 'overdueDays' },
  { title: 'Fine so far', key: 'fineAmount' },
];

const fines = ref<LibraryFineDto[]>([]);
const finesTotal = ref(0);
const finesPage = ref(1);
const fineStatus = ref<LibraryFineStatus | null>('PENDING');
const pendingAmount = ref(0);
const fineHeaders = [
  { title: 'Date', key: 'createdAt' },
  { title: 'Member', key: 'memberName' },
  { title: 'Title', key: 'bookTitle' },
  { title: 'Reason', key: 'reason' },
  { title: 'Amount', key: 'amount' },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false },
];

async function loadOverdue() {
  loading.value = true;
  try {
    const r = await apiFetch<ApiListResponse<LibraryLoanDto>>(
      `/api/v1/library/loans?${qs({
        overdue: 'true',
        page: overduePage.value,
        pageSize: 25,
        institutionId: institutionId.value,
      })}`,
    );
    overdue.value = r.data;
    overdueTotal.value = r.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function loadFines() {
  loading.value = true;
  try {
    const r = await apiFetch<
      ApiListResponse<LibraryFineDto> & { summary?: { pendingAmount: number } }
    >(
      `/api/v1/library/fines?${qs({
        status: fineStatus.value,
        page: finesPage.value,
        pageSize: 25,
        institutionId: institutionId.value,
      })}`,
    );
    fines.value = r.data;
    finesTotal.value = r.meta.total;
    pendingAmount.value = r.summary?.pendingAmount ?? 0;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
const UTR = /^[A-Za-z0-9-]{6,64}$/;
const settling = ref<{ fine: LibraryFineDto; action: 'collect' | 'waive' } | null>(null);
const settleForm = reactive({ utr: '', note: '' });
const settleBusy = ref(false);
function settle(f: LibraryFineDto, action: 'collect' | 'waive') {
  Object.assign(settleForm, { utr: '', note: '' });
  settling.value = { fine: f, action };
}
const settleValid = computed(() =>
  settling.value?.action === 'collect' ? UTR.test(settleForm.utr.trim()) : true,
);
async function confirmSettle() {
  if (!settling.value) return;
  const { fine, action } = settling.value;
  settleBusy.value = true;
  try {
    await apiFetch(`/api/v1/library/fines/${fine.id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({
        ...(action === 'collect' ? { utr: settleForm.utr.trim() } : {}),
        note: settleForm.note.trim() || null,
      }),
    });
    settling.value = null;
    await loadFines();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    settleBusy.value = false;
  }
}
const loadAll = () => Promise.all([loadOverdue(), loadFines()]);
onMounted(async () => {
  await loadInstitutions();
  await loadAll();
});
watch(institutionId, loadAll);
watch(overduePage, loadOverdue);
watch([finesPage, fineStatus], loadFines);
</script>
<template>
  <LibraryTabs title="Overdues & fines" />
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <div class="d-flex align-center mb-2">
    <v-btn-toggle v-model="tab" mandatory density="compact" color="primary">
      <v-btn value="overdue">Overdue ({{ overdueTotal }})</v-btn>
      <v-btn value="fines">Fines</v-btn>
    </v-btn-toggle>
    <v-select
      v-if="institutions.length > 1"
      v-model="institutionId"
      :items="institutions"
      item-title="name"
      item-value="id"
      label="Library"
      density="compact"
      clearable
      hide-details
      class="ml-4"
      style="max-width: 320px"
    />
    <v-spacer />
    <v-chip color="warning">Pending fines {{ money(pendingAmount) }}</v-chip>
  </div>
  <p v-if="tab === 'overdue'" class="text-caption mb-2">
    Reminders go out daily to the member (and guardians for students). The fine is charged on
    return.
  </p>
  <v-data-table-server
    v-if="tab === 'overdue'"
    :headers="overdueHeaders"
    :items="overdue"
    :items-length="overdueTotal"
    :page="overduePage"
    :loading="loading"
    item-value="id"
    @update:page="overduePage = $event"
  >
    <template #[`item.dueDate`]="{ item }">{{ fmtDate(item.dueDate) }}</template>
    <template #[`item.overdueDays`]="{ item }"
      ><span class="text-error">{{ item.overdueDays }}</span></template
    >
    <template #[`item.fineAmount`]="{ item }">{{ money(item.fineAmount) }}</template>
  </v-data-table-server>
  <template v-else>
    <v-select
      v-model="fineStatus"
      :items="[...LIBRARY_FINE_STATUSES]"
      label="Status"
      density="compact"
      clearable
      hide-details
      class="mb-2"
      style="max-width: 240px"
    />
    <v-data-table-server
      :headers="fineHeaders"
      :items="fines"
      :items-length="finesTotal"
      :page="finesPage"
      :loading="loading"
      item-value="id"
      @update:page="finesPage = $event"
    >
      <template #[`item.createdAt`]="{ item }">{{ fmtDate(item.createdAt) }}</template>
      <template #[`item.amount`]="{ item }">{{ money(item.amount) }}</template>
      <template #[`item.status`]="{ item }">
        <v-chip size="small" :color="STATUS_COLOR[item.status]">{{ item.status }}</v-chip>
      </template>
      <template #[`item.actions`]="{ item }">
        <template v-if="item.status === 'PENDING' && auth.can('library.fine')">
          <v-btn size="small" variant="text" color="primary" @click="settle(item, 'collect')"
            >Collect</v-btn
          >
          <v-btn size="small" variant="text" @click="settle(item, 'waive')">Waive</v-btn>
        </template>
      </template>
    </v-data-table-server>
  </template>
  <v-dialog :model-value="!!settling" max-width="460" @update:model-value="settling = null"
    ><v-card v-if="settling"
      ><v-card-title>{{
        settling.action === 'collect' ? 'Collect fine via UPI' : 'Waive fine'
      }}</v-card-title
      ><v-card-text>
        <p class="mb-3">
          {{ money(settling.fine.amount) }} ·
          {{ settling.fine.reason }}
        </p>
        <v-text-field
          v-if="settling.action === 'collect'"
          v-model="settleForm.utr"
          label="UPI UTR / transaction ID *"
          hint="Fines are collected via UPI only"
          persistent-hint
          :rules="[(v: string) => UTR.test((v ?? '').trim()) || 'Enter the 6–64 character UTR']"
          data-testid="fine-utr"
          class="mb-2"
        />
        <v-text-field
          v-model="settleForm.note"
          :label="settling.action === 'collect' ? 'Note (optional)' : 'Reason for waiver'"
        /> </v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="settling = null">Close</v-btn
        ><v-btn
          color="primary"
          :loading="settleBusy"
          :disabled="!settleValid"
          @click="confirmSettle"
          >{{ settling.action === 'collect' ? 'Record UPI payment' : 'Waive' }}</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>

<script setup lang="ts">
import {
  LIBRARY_FINE_STATUSES,
  type ApiListResponse,
  type LibraryFineDto,
  type LibraryLoanDto,
  type LibraryFineStatus,
} from '@erp/shared';
import { onMounted, ref, watch } from 'vue';
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
async function settle(f: LibraryFineDto, action: 'collect' | 'waive') {
  const note = prompt(action === 'collect' ? 'Receipt / note (optional)' : 'Reason for waiver');
  if (note === null) return;
  try {
    await apiFetch(`/api/v1/library/fines/${f.id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ note: note || null }),
    });
    await loadFines();
  } catch (e) {
    error.value = (e as Error).message;
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
</template>

<script setup lang="ts">
import {
  ASSET_TRANSFER_STATUSES,
  type ApiListResponse,
  type AssetAssignmentDto,
  type AssetTransferDto,
} from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { ASSET_STATUS_COLORS, label, useAssetOptions } from './assetUi';

const auth = useAuthStore();
const route = useRoute();
const tab = ref((route.query.tab as string) || 'assignments');
const { institutions, loadBase } = useAssetOptions();
const error = ref<string | null>(null);
const filters = reactive({ institutionId: '', status: 'ACTIVE', acknowledged: '' });
const assignments = ref<AssetAssignmentDto[]>([]);
const total = ref(0);
const page = ref(1);
const transfers = ref<AssetTransferDto[]>([]);
const transferStatus = ref<string | null>('PENDING_APPROVAL');
const loading = ref(false);
const headers = [
  { title: 'Asset', key: 'asset' },
  { title: 'Assigned to', key: 'employee' },
  { title: 'Since', key: 'assignedAt' },
  { title: 'Expected back', key: 'expectedReturnDate' },
  { title: 'Acknowledged', key: 'acknowledgedAt' },
  { title: 'Returned', key: 'returnedAt' },
  { title: 'Status', key: 'status' },
];

async function loadAssignments() {
  loading.value = true;
  try {
    const p = new URLSearchParams({ page: String(page.value), pageSize: '25' });
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    const r = await apiFetch<ApiListResponse<AssetAssignmentDto>>(
      `/api/v1/assets/assignments?${p}`,
    );
    assignments.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function loadTransfers() {
  try {
    const p = new URLSearchParams({ pageSize: '100' });
    if (transferStatus.value) p.set('status', transferStatus.value);
    if (filters.institutionId) p.set('institutionId', filters.institutionId);
    transfers.value = (
      await apiFetch<ApiListResponse<AssetTransferDto>>(`/api/v1/assets/transfers?${p}`)
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function cancelTransfer(t: AssetTransferDto) {
  if (!confirm(`Cancel the pending transfer of ${t.asset?.assetTag ?? 'this asset'}?`)) return;
  try {
    await apiFetch(`/api/v1/assets/transfers/${t.id}/cancel`, { method: 'POST' });
    await loadTransfers();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const instName = (id: string) => institutions.value.find((i) => i.id === id)?.name ?? '';
onMounted(async () => {
  await Promise.all([loadBase(), loadAssignments(), loadTransfers()]);
});
watch(
  [page, () => filters.institutionId, () => filters.status, () => filters.acknowledged],
  loadAssignments,
);
watch([transferStatus, () => filters.institutionId], loadTransfers);
</script>

<template>
  <h2 class="text-h5 mb-4">Assignments & transfers</h2>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-tabs v-model="tab" class="mb-3">
    <v-tab value="assignments">Custody</v-tab>
    <v-tab value="transfers">Transfers</v-tab>
  </v-tabs>
  <v-row dense class="mb-2">
    <v-col cols="12" md="4"
      ><v-autocomplete
        v-model="filters.institutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Institution"
        density="compact"
        clearable
        hide-details
    /></v-col>
    <template v-if="tab === 'assignments'">
      <v-col cols="6" md="3"
        ><v-select
          v-model="filters.status"
          :items="['ACTIVE', 'RETURNED']"
          label="Status"
          density="compact"
          clearable
          hide-details
      /></v-col>
      <v-col cols="6" md="3"
        ><v-select
          v-model="filters.acknowledged"
          :items="[
            { title: 'Acknowledged', value: 'true' },
            { title: 'Not acknowledged', value: 'false' },
          ]"
          label="Acknowledgement"
          density="compact"
          clearable
          hide-details
      /></v-col>
    </template>
    <v-col v-else cols="6" md="3"
      ><v-select
        v-model="transferStatus"
        :items="ASSET_TRANSFER_STATUSES.map((s) => ({ title: label(s), value: s }))"
        label="Status"
        density="compact"
        clearable
        hide-details
    /></v-col>
  </v-row>
  <v-data-table-server
    v-if="tab === 'assignments'"
    :headers="headers"
    :items="assignments"
    :items-length="total"
    :page="page"
    :items-per-page="25"
    :loading="loading"
    item-value="id"
    @update:page="page = $event"
  >
    <template #[`item.asset`]="{ item }"
      ><router-link :to="`/assets/register/${item.assetId}`"
        >{{ item.asset?.assetTag }} · {{ item.asset?.name }}</router-link
      ></template
    >
    <template #[`item.employee`]="{ item }">{{
      item.employee
        ? `${item.employee.displayName} (${item.employee.employeeCode})`
        : (item.location ?? label(item.targetType))
    }}</template>
    <template #[`item.acknowledgedAt`]="{ item }">{{
      item.acknowledgedAt?.slice(0, 10) ?? (item.status === 'ACTIVE' ? 'Pending' : '—')
    }}</template>
    <template #[`item.status`]="{ item }"
      ><v-chip size="small" :color="ASSET_STATUS_COLORS[item.status]">{{
        label(item.status)
      }}</v-chip></template
    >
  </v-data-table-server>
  <v-table v-else density="compact">
    <thead>
      <tr>
        <th>Requested</th>
        <th>Asset</th>
        <th>From</th>
        <th>To</th>
        <th>Reason</th>
        <th>Status</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="t in transfers" :key="t.id">
        <td>{{ t.createdAt.slice(0, 10) }}</td>
        <td>
          <router-link :to="`/assets/register/${t.assetId}`"
            >{{ t.asset?.assetTag }} · {{ t.asset?.name }}</router-link
          >
        </td>
        <td>{{ instName(t.institutionId) }} {{ t.fromLocation ?? '' }}</td>
        <td>{{ instName(t.toInstitutionId) }} {{ t.toLocation ?? '' }}</td>
        <td>{{ t.reason }}</td>
        <td>
          <v-chip size="small" :color="ASSET_STATUS_COLORS[t.status]">{{ label(t.status) }}</v-chip>
        </td>
        <td>
          <template v-if="t.status === 'PENDING_APPROVAL' && auth.can('asset.assign')">
            <!-- Workflow-routed transfers are withdrawn in Approvals (API refuses here). -->
            <v-btn
              v-if="t.workflowInstanceId"
              size="small"
              variant="text"
              :to="`/approvals/${t.workflowInstanceId}`"
              >Open in approvals</v-btn
            >
            <v-btn v-else size="small" variant="text" @click="cancelTransfer(t)"
              >Cancel transfer</v-btn
            >
          </template>
        </td>
      </tr>
      <tr v-if="!transfers.length">
        <td colspan="7">No transfers. Pending transfers are approved in Approvals.</td>
      </tr>
    </tbody>
  </v-table>
</template>

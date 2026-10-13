<script setup lang="ts">
import { ASSET_DISPOSAL_STATUSES } from '@erp/shared';
import type { ApiListResponse, AssetDisposalDto } from '@erp/shared';
import { onMounted, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { ASSET_STATUS_COLORS, label, money, opts } from './assetUi';

const auth = useAuthStore();
const items = ref<AssetDisposalDto[]>([]);
const status = ref('PENDING_APPROVAL');
const error = ref<string | null>(null);

async function load() {
  try {
    const p = new URLSearchParams({ pageSize: '100' });
    if (status.value) p.set('status', status.value);
    items.value = (
      await apiFetch<ApiListResponse<AssetDisposalDto>>(`/api/v1/assets/disposals?${p}`)
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function act(d: AssetDisposalDto, kind: 'approve' | 'reject' | 'cancel') {
  if (
    kind === 'cancel' &&
    !confirm(
      `Cancel the disposal request for ${d.asset?.assetTag ?? 'this asset'}? Use this to withdraw a request raised by mistake; to turn it down as a decision, use Reject.`,
    )
  )
    return;
  const comment = kind === 'cancel' ? null : prompt(`Comment (${kind})`) || null;
  try {
    await apiFetch(`/api/v1/assets/disposals/${d.id}/${kind}`, {
      method: 'POST',
      body: JSON.stringify(kind === 'cancel' ? {} : { comment }),
    });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(status, load);
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Disposal & write-off</h2>
    <v-spacer />
    <v-select
      v-model="status"
      :items="opts(ASSET_DISPOSAL_STATUSES)"
      label="Status"
      density="compact"
      clearable
      hide-details
      style="max-width: 220px"
    />
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <p class="text-caption mb-2">
    Raise a disposal from an asset's page. When an approval workflow is configured for “Asset
    disposal / write-off”, requests are decided in Approvals.
  </p>
  <v-table density="compact">
    <thead>
      <tr>
        <th>Date</th>
        <th>Asset</th>
        <th>Method</th>
        <th class="text-right">Book value</th>
        <th class="text-right">Sale value</th>
        <th>Reason</th>
        <th>Status</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="d in items" :key="d.id">
        <td>{{ d.disposalDate }}</td>
        <td>
          <router-link :to="`/assets/register/${d.assetId}`"
            >{{ d.asset?.assetTag }} · {{ d.asset?.name }}</router-link
          >
        </td>
        <td>{{ label(d.method) }}</td>
        <td class="text-right">{{ money(d.bookValue) }}</td>
        <td class="text-right">{{ money(d.saleValue) }}</td>
        <td>{{ d.reason }}</td>
        <td>
          <v-chip size="small" :color="ASSET_STATUS_COLORS[d.status]">{{ label(d.status) }}</v-chip>
        </td>
        <td>
          <template v-if="d.status === 'PENDING_APPROVAL' && auth.can('asset.dispose')">
            <!-- Workflow-routed requests are decided / withdrawn in Approvals (API refuses here). -->
            <v-btn
              v-if="d.workflowInstanceId"
              size="x-small"
              variant="text"
              :to="`/approvals/${d.workflowInstanceId}`"
              >Open in approvals</v-btn
            >
            <template v-else>
              <v-btn size="x-small" color="success" variant="text" @click="act(d, 'approve')"
                >Approve</v-btn
              >
              <v-btn size="x-small" color="error" variant="text" @click="act(d, 'reject')"
                >Reject</v-btn
              >
              <v-btn size="x-small" variant="text" @click="act(d, 'cancel')">Cancel request</v-btn>
            </template>
          </template>
        </td>
      </tr>
      <tr v-if="!items.length">
        <td colspan="8">Nothing here.</td>
      </tr>
    </tbody>
  </v-table>
</template>

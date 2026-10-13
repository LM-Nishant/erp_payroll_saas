<script setup lang="ts">
import { ASSET_AUDIT_RESULTS, ASSET_CONDITIONS } from '@erp/shared';
import type { ApiListResponse, AssetAuditDto, AssetAuditItemDto } from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '@/api/client';
import { ASSET_STATUS_COLORS, clean, label, useAssetOptions, opts } from './assetUi';

const route = useRoute();
const { institutions, categories, loadBase } = useAssetOptions();
const audits = ref<AssetAuditDto[]>([]);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const current = ref<AssetAuditDto | null>(null);
const auditItems = ref<AssetAuditItemDto[]>([]);
const itemsTotal = ref(0);
const itemsPage = ref(1);
const resultFilter = ref('');
const newOpen = ref(false);
const newForm = reactive({ institutionId: '', categoryId: '', name: '', notes: '' });
const scan = reactive({ assetTag: '', observedLocation: '', observedCondition: '', notes: '' });

async function loadAudits() {
  try {
    audits.value = (
      await apiFetch<ApiListResponse<AssetAuditDto>>('/api/v1/assets/audits?pageSize=50')
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function openAudit(a: AssetAuditDto) {
  current.value = (await apiFetch<{ data: AssetAuditDto }>(`/api/v1/assets/audits/${a.id}`)).data;
  await loadItems();
}
async function loadItems() {
  if (!current.value) return;
  const p = new URLSearchParams({ page: String(itemsPage.value), pageSize: '50' });
  if (resultFilter.value) p.set('result', resultFilter.value);
  const r = await apiFetch<ApiListResponse<AssetAuditItemDto>>(
    `/api/v1/assets/audits/${current.value.id}/items?${p}`,
  );
  auditItems.value = r.data;
  itemsTotal.value = r.meta.total;
}
async function create() {
  try {
    const r = await apiFetch<{ data: AssetAuditDto }>('/api/v1/assets/audits', {
      method: 'POST',
      body: JSON.stringify(clean(newForm)),
    });
    newOpen.value = false;
    await loadAudits();
    await openAudit(r.data);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function verify(body: Record<string, unknown>) {
  if (!current.value) return;
  try {
    const r = await apiFetch<{ data: AssetAuditItemDto }>(
      `/api/v1/assets/audits/${current.value.id}/verify`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    notice.value = `${r.data.asset?.assetTag ?? ''}: ${label(r.data.result)}`;
    scan.assetTag = '';
    await openAudit(current.value);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const doScan = () =>
  verify(clean({ ...scan, observedCondition: scan.observedCondition || undefined }));
async function action(kind: 'complete' | 'cancel') {
  if (!current.value) return;
  if (kind === 'cancel' && !confirm(`Cancel audit "${current.value.name}"? Results are discarded.`))
    return;
  try {
    current.value = (
      await apiFetch<{ data: AssetAuditDto }>(`/api/v1/assets/audits/${current.value.id}/${kind}`, {
        method: 'POST',
      })
    ).data;
    await Promise.all([loadAudits(), loadItems()]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await Promise.all([loadAudits(), loadBase()]);
  // Deep link (e.g. from the discrepancy notification): /assets/audit?audit=<id>
  const id = route.query.audit;
  if (typeof id === 'string' && id) {
    try {
      await openAudit({ id } as AssetAuditDto);
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
});
watch([itemsPage, resultFilter], loadItems);
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Asset audit / physical verification</h2>
    <v-spacer />
    <v-btn color="primary" prepend-icon="mdi-plus" @click="newOpen = true">New audit</v-btn>
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-snackbar
    :model-value="!!notice"
    :timeout="2000"
    color="success"
    @update:model-value="notice = null"
    >{{ notice }}</v-snackbar
  >
  <v-row>
    <v-col cols="12" md="4">
      <v-list density="compact" border rounded>
        <v-list-item
          v-for="a in audits"
          :key="a.id"
          :active="current?.id === a.id"
          :title="a.name"
          :subtitle="`${a.createdAt.slice(0, 10)} · ${a.counts.VERIFIED ?? 0}/${a.counts.total} verified`"
          @click="openAudit(a)"
        >
          <template #append
            ><v-chip size="x-small" :color="ASSET_STATUS_COLORS[a.status]">{{
              a.status
            }}</v-chip></template
          >
        </v-list-item>
        <v-list-item v-if="!audits.length" title="No audits yet" />
      </v-list>
    </v-col>
    <v-col v-if="current" cols="12" md="8">
      <div class="d-flex align-center mb-2">
        <h3 class="text-h6">{{ current.name }}</h3>
        <v-spacer />
        <template v-if="current.status === 'OPEN'">
          <v-btn variant="text" color="error" @click="action('cancel')">Cancel audit</v-btn>
          <v-btn color="primary" @click="action('complete')">Complete</v-btn>
        </template>
      </div>
      <div class="d-flex flex-wrap ga-2 mb-3">
        <v-chip
          v-for="r in ASSET_AUDIT_RESULTS"
          :key="r"
          size="small"
          :color="ASSET_STATUS_COLORS[r]"
          >{{ label(r) }}: {{ current.counts[r] ?? 0 }}</v-chip
        >
      </div>
      <v-card v-if="current.status === 'OPEN'" variant="outlined" class="mb-3">
        <v-card-text>
          <v-row dense>
            <v-col cols="12" md="4"
              ><v-text-field
                v-model="scan.assetTag"
                label="Scan / type asset tag"
                prepend-inner-icon="mdi-barcode-scan"
                density="compact"
                autofocus
                @keyup.enter="doScan"
            /></v-col>
            <v-col cols="12" md="3"
              ><v-text-field v-model="scan.observedLocation" label="Found at" density="compact"
            /></v-col>
            <v-col cols="12" md="3"
              ><v-select
                v-model="scan.observedCondition"
                :items="opts(ASSET_CONDITIONS)"
                label="Condition"
                density="compact"
                clearable
            /></v-col>
            <v-col cols="12" md="2"
              ><v-btn color="primary" block @click="doScan">Verify</v-btn></v-col
            >
          </v-row>
        </v-card-text>
      </v-card>
      <v-select
        v-model="resultFilter"
        :items="opts(ASSET_AUDIT_RESULTS)"
        label="Filter by result"
        density="compact"
        clearable
        style="max-width: 260px"
      />
      <v-table density="compact">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Expected location</th>
            <th>Found</th>
            <th>Result</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in auditItems" :key="i.id">
            <td>{{ i.asset?.assetTag }} · {{ i.asset?.name }}</td>
            <td>{{ i.expectedLocation }}</td>
            <td>
              {{ i.observedLocation }}
              {{ i.observedCondition ? `(${label(i.observedCondition)})` : '' }}
            </td>
            <td>
              <v-chip size="small" :color="ASSET_STATUS_COLORS[i.result] ?? 'warning'">{{
                label(i.result)
              }}</v-chip>
            </td>
            <td>
              <template v-if="current.status === 'OPEN' && i.result === 'PENDING'">
                <v-btn size="x-small" variant="text" @click="verify({ assetId: i.assetId })"
                  >Found</v-btn
                >
                <v-btn
                  size="x-small"
                  variant="text"
                  color="error"
                  @click="verify({ assetId: i.assetId, result: 'MISSING' })"
                  >Missing</v-btn
                >
              </template>
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-pagination
        v-if="itemsTotal > 50"
        v-model="itemsPage"
        :length="Math.ceil(itemsTotal / 50)"
        density="compact"
      />
    </v-col>
  </v-row>
  <v-dialog v-model="newOpen" max-width="560">
    <v-card title="New audit">
      <v-card-text>
        <v-autocomplete
          v-model="newForm.institutionId"
          :items="institutions"
          item-title="name"
          item-value="id"
          label="Institution"
        />
        <v-autocomplete
          v-model="newForm.categoryId"
          :items="categories"
          item-title="name"
          item-value="id"
          label="Category (optional)"
          clearable
        />
        <v-text-field v-model="newForm.name" label="Name (e.g. Annual verification 2026)" />
        <v-textarea v-model="newForm.notes" label="Notes" rows="2" />
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn variant="text" @click="newOpen = false">Cancel</v-btn
        ><v-btn color="primary" @click="create">Start</v-btn></v-card-actions
      >
    </v-card>
  </v-dialog>
</template>

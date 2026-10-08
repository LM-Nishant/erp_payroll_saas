<script setup lang="ts">
import type { ApiListResponse, LibraryPolicyDto, LibraryStockVerificationDto } from '@erp/shared';
import { onMounted, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import LibraryTabs from './LibraryTabs.vue';
import { fmtDate, qs, useLibraryInstitutions } from './library';

const auth = useAuthStore();
const { institutions, institutionId, loadInstitutions } = useLibraryInstitutions();
const policies = ref<LibraryPolicyDto[]>([]);
const error = ref<string | null>(null);
const saved = ref<string | null>(null);

const stock = ref<LibraryStockVerificationDto[]>([]);
const newName = ref('');
const active = ref<LibraryStockVerificationDto | null>(null);
const scanText = ref('');

async function loadPolicies() {
  if (!institutionId.value) return;
  try {
    policies.value = (
      await apiFetch<{ data: LibraryPolicyDto[] }>(
        `/api/v1/library/policies?${qs({ institutionId: institutionId.value })}`,
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function savePolicy(p: LibraryPolicyDto) {
  error.value = null;
  try {
    await apiFetch('/api/v1/library/policies', {
      method: 'PUT',
      body: JSON.stringify({
        institutionId: institutionId.value,
        memberType: p.memberType,
        maxBooks: Number(p.maxBooks),
        loanDays: Number(p.loanDays),
        maxRenewals: Number(p.maxRenewals),
        finePerDay: Number(p.finePerDay),
        maxFine: Number(p.maxFine),
        holdDays: Number(p.holdDays),
      }),
    });
    saved.value = `${p.memberType.toLowerCase()} policy saved`;
    await loadPolicies();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function loadStock() {
  try {
    stock.value = (
      await apiFetch<ApiListResponse<LibraryStockVerificationDto>>(
        `/api/v1/library/stock-verifications?${qs({ institutionId: institutionId.value })}`,
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function startStock() {
  try {
    active.value = (
      await apiFetch<{ data: LibraryStockVerificationDto }>('/api/v1/library/stock-verifications', {
        method: 'POST',
        body: JSON.stringify({ institutionId: institutionId.value, name: newName.value }),
      })
    ).data;
    newName.value = '';
    await loadStock();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function scan() {
  if (!active.value) return;
  const barcodes = scanText.value
    .split(/[\s,]+/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (!barcodes.length) return;
  try {
    active.value = (
      await apiFetch<{ data: LibraryStockVerificationDto }>(
        `/api/v1/library/stock-verifications/${active.value.id}/scan`,
        { method: 'POST', body: JSON.stringify({ barcodes }) },
      )
    ).data;
    scanText.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function complete() {
  if (!active.value) return;
  try {
    active.value = (
      await apiFetch<{ data: LibraryStockVerificationDto }>(
        `/api/v1/library/stock-verifications/${active.value.id}/complete`,
        { method: 'POST', body: '{}' },
      )
    ).data;
    await loadStock();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function openStock(id: string) {
  active.value = (
    await apiFetch<{ data: LibraryStockVerificationDto }>(
      `/api/v1/library/stock-verifications/${id}`,
    )
  ).data;
}
onMounted(async () => {
  await loadInstitutions();
  if (!institutionId.value) institutionId.value = institutions.value[0]?.id ?? '';
});
watch(institutionId, async () => {
  active.value = null;
  await Promise.all([loadPolicies(), loadStock()]);
});
</script>
<template>
  <LibraryTabs title="Library settings">
    <template #actions>
      <v-select
        v-model="institutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Library"
        density="compact"
        hide-details
        style="max-width: 320px"
      />
    </template>
  </LibraryTabs>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-snackbar :model-value="!!saved" timeout="2000" @update:model-value="saved = null">{{
    saved
  }}</v-snackbar>
  <v-row>
    <v-col v-for="p in policies" :key="p.memberType" cols="12" md="6">
      <v-card>
        <v-card-title
          >{{ p.memberType === 'STUDENT' ? 'Student' : 'Staff' }} membership policy
          <v-chip v-if="!p.id" size="x-small" class="ml-2">default</v-chip></v-card-title
        >
        <v-card-text>
          <v-row dense>
            <v-col cols="6"
              ><v-text-field v-model="p.maxBooks" label="Max books" type="number"
            /></v-col>
            <v-col cols="6"
              ><v-text-field v-model="p.loanDays" label="Loan days" type="number"
            /></v-col>
            <v-col cols="6"
              ><v-text-field v-model="p.maxRenewals" label="Renewals allowed" type="number"
            /></v-col>
            <v-col cols="6"
              ><v-text-field v-model="p.holdDays" label="Reservation hold days" type="number"
            /></v-col>
            <v-col cols="6"
              ><v-text-field v-model="p.finePerDay" label="Fine per day (₹)" type="number"
            /></v-col>
            <v-col cols="6"
              ><v-text-field v-model="p.maxFine" label="Max fine per loan (₹)" type="number"
            /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions v-if="auth.can('library.manage')">
          <v-spacer /><v-btn color="primary" @click="savePolicy(p)">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-col>
  </v-row>

  <v-card class="mt-6">
    <v-card-title>Stock verification</v-card-title>
    <v-card-text>
      <div v-if="auth.can('library.manage')" class="d-flex align-center mb-3">
        <v-text-field
          v-model="newName"
          label="New verification (e.g. Annual stock check 2026)"
          density="compact"
          hide-details
        />
        <v-btn class="ml-2" color="primary" :disabled="!newName" @click="startStock">Start</v-btn>
      </div>
      <v-table density="compact">
        <tbody>
          <tr v-for="s in stock" :key="s.id" style="cursor: pointer" @click="openStock(s.id)">
            <td>{{ s.name }}</td>
            <td>{{ s.status }}</td>
            <td>{{ s.scannedCount }} scanned</td>
            <td>{{ fmtDate(s.completedAt ?? s.createdAt) }}</td>
          </tr>
        </tbody>
      </v-table>
      <v-card v-if="active" variant="outlined" class="mt-4">
        <v-card-title>{{ active.name }} — {{ active.status }}</v-card-title>
        <v-card-text>
          <template v-if="active.status === 'OPEN'">
            <v-textarea
              v-model="scanText"
              label="Scan barcodes (one per line, or paste a list)"
              rows="4"
              @keyup.ctrl.enter="scan"
            />
            <div class="d-flex">
              <v-btn color="primary" @click="scan">Record scans</v-btn>
              <v-spacer />
              <v-btn color="success" @click="complete">Complete & reconcile</v-btn>
            </div>
            <div class="mt-2">{{ active.scannedCount }} barcodes scanned so far.</div>
          </template>
          <template v-if="active.result">
            <div class="mb-2">
              Expected {{ active.result.expected }} · found {{ active.result.found }} · missing
              {{ active.result.missing.length }} · unexpected
              {{ active.result.unexpected.length }}
            </div>
            <div v-if="active.result.missing.length" class="text-subtitle-2">Missing</div>
            <v-table v-if="active.result.missing.length" density="compact">
              <tbody>
                <tr v-for="m in active.result.missing" :key="m.barcode">
                  <td>{{ m.accessionNo }}</td>
                  <td>{{ m.title }}</td>
                </tr>
              </tbody>
            </v-table>
            <div v-if="active.result.misplacedStatus.length" class="mt-2">
              Scanned but not shelved (status):
              {{
                active.result.misplacedStatus.map((m) => `${m.barcode} (${m.status})`).join(', ')
              }}
            </div>
            <div v-if="active.result.unexpected.length" class="mt-2">
              Unknown barcodes: {{ active.result.unexpected.join(', ') }}
            </div>
          </template>
        </v-card-text>
      </v-card>
    </v-card-text>
  </v-card>
</template>

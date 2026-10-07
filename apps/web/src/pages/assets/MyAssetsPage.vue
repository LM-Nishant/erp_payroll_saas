<script setup lang="ts">
import { ASSET_MAINTENANCE_PRIORITIES } from '@erp/shared';
import type { MyAssetDto, SignedUrlDto } from '@erp/shared';
import { onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { ASSET_STATUS_COLORS, label, opts } from './assetUi';

const items = ref<MyAssetDto[]>([]);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const loading = ref(false);
const issueFor = ref<MyAssetDto | null>(null);
const issue = reactive({ title: '', description: '', priority: 'MEDIUM' });

async function load() {
  loading.value = true;
  try {
    items.value = (await apiFetch<{ data: MyAssetDto[] }>('/api/v1/assets/my')).data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function acknowledge(m: MyAssetDto) {
  try {
    await apiFetch(`/api/v1/assets/my/${m.assignment.id}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    notice.value = 'Receipt acknowledged';
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function raise() {
  if (!issueFor.value) return;
  try {
    await apiFetch(`/api/v1/assets/my/${issueFor.value.assignment.id}/issue`, {
      method: 'POST',
      body: JSON.stringify({
        title: issue.title,
        description: issue.description || null,
        priority: issue.priority,
      }),
    });
    issueFor.value = null;
    Object.assign(issue, { title: '', description: '', priority: 'MEDIUM' });
    notice.value = 'Issue reported to the asset desk';
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function handover(m: MyAssetDto) {
  try {
    const r = await apiFetch<{ data: SignedUrlDto }>(
      `/api/v1/assets/assignments/${m.assignment.id}/handover`,
    );
    window.open(r.data.url, '_blank');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
</script>

<template>
  <h2 class="text-h5 mb-4">My assets</h2>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-snackbar
    :model-value="!!notice"
    :timeout="2500"
    color="success"
    @update:model-value="notice = null"
    >{{ notice }}</v-snackbar
  >
  <v-progress-linear v-if="loading" indeterminate />
  <v-alert v-if="!loading && !items.length" type="info" variant="tonal"
    >No assets are assigned to you.</v-alert
  >
  <v-row>
    <v-col v-for="m in items" :key="m.assignment.id" cols="12" md="6" lg="4">
      <v-card>
        <v-card-title class="d-flex align-center">
          {{ m.asset.name }}
          <v-spacer />
          <v-chip size="small" :color="ASSET_STATUS_COLORS[m.asset.status]">{{
            label(m.asset.status)
          }}</v-chip>
        </v-card-title>
        <v-card-subtitle>{{ m.asset.assetTag }} · {{ m.asset.category?.name }}</v-card-subtitle>
        <v-card-text>
          <div v-if="m.asset.make || m.asset.model">{{ m.asset.make }} {{ m.asset.model }}</div>
          <div v-if="m.asset.serialNo">Serial: {{ m.asset.serialNo }}</div>
          <div>Assigned on {{ m.assignment.assignedAt }}</div>
          <div v-if="m.assignment.accessories.length">
            Accessories: {{ m.assignment.accessories.join(', ') }}
          </div>
          <div v-if="m.asset.warrantyExpiry">Warranty until {{ m.asset.warrantyExpiry }}</div>
          <v-alert
            v-if="!m.assignment.acknowledgedAt"
            type="warning"
            density="compact"
            variant="tonal"
            class="mt-2"
            >Please confirm you received this asset.</v-alert
          >
          <div v-else class="text-caption mt-2">
            Acknowledged {{ m.assignment.acknowledgedAt.slice(0, 10) }}
          </div>
        </v-card-text>
        <v-card-actions>
          <v-btn v-if="!m.assignment.acknowledgedAt" color="primary" @click="acknowledge(m)"
            >Acknowledge</v-btn
          >
          <v-btn variant="text" @click="issueFor = m">Report issue</v-btn>
          <v-btn v-if="m.assignment.handoverDocumentId" variant="text" @click="handover(m)"
            >Handover form</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-col>
  </v-row>
  <v-dialog :model-value="!!issueFor" max-width="520" @update:model-value="issueFor = null">
    <v-card :title="`Report an issue — ${issueFor?.asset.assetTag}`">
      <v-card-text>
        <v-text-field v-model="issue.title" label="What's wrong?" />
        <v-textarea v-model="issue.description" label="Details" rows="3" />
        <v-select
          v-model="issue.priority"
          :items="opts(ASSET_MAINTENANCE_PRIORITIES)"
          label="Priority"
        />
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn variant="text" @click="issueFor = null">Cancel</v-btn
        ><v-btn color="primary" :disabled="!issue.title" @click="raise"
          >Submit</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>
</template>

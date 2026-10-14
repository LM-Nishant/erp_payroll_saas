<script setup lang="ts">
import type {
  ApiClientCreatedDto,
  ApiClientDto,
  DomainEventTypeDto,
  WebhookCreatedDto,
  WebhookDeliveryDto,
  WebhookDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { ApiError, apiFetch } from '@/api/client';
import { PAGE_SIZE_OPTIONS, useServerList } from '@/lib/serverList';
import { useAuthStore } from '@/stores/auth';

/**
 * API clients (client-credentials machine access) and outbound webhooks. Client secrets and
 * webhook signing secrets are shown ONCE on create/rotate; only hashes / secrets refs are stored.
 */
const auth = useAuthStore();
const canManage = computed(() => auth.can('integration.manage'));
const tab = ref<'clients' | 'webhooks'>('clients');
const error = ref<string | null>(null);
/** Webhooks are organization-wide: a scoped integration.view grant can't list them. */
const webhooksDenied = ref(false);
const shownSecret = ref<{ label: string; value: string } | null>(null);

/* ---------------------------- API clients ---------------------------- */
const clientList = useServerList<ApiClientDto>('/api/v1/integrations/api-clients', {
  error,
  immediate: false,
});
const { items: clients, load: loadClients } = clientList;
const clientDialog = ref(false);
const cForm = reactive({ name: '', scopes: 'user.view', rateLimitPerMinute: 600 });

async function createClient() {
  error.value = null;
  try {
    const res = await apiFetch<{ data: ApiClientCreatedDto }>('/api/v1/integrations/api-clients', {
      method: 'POST',
      body: JSON.stringify({
        name: cForm.name,
        scopes: cForm.scopes
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        rateLimitPerMinute: cForm.rateLimitPerMinute,
      }),
    });
    shownSecret.value = {
      label: `Client ${res.data.clientId} secret`,
      value: res.data.clientSecret,
    };
    clientDialog.value = false;
    await loadClients();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function rotateClient(c: ApiClientDto) {
  if (!confirm(`Rotate the secret of ${c.name}? The old secret stops working.`)) return;
  const res = await apiFetch<{ data: ApiClientCreatedDto }>(
    `/api/v1/integrations/api-clients/${c.id}/rotate-secret`,
    { method: 'POST' },
  );
  shownSecret.value = { label: `Client ${c.clientId} secret`, value: res.data.clientSecret };
  await loadClients();
}
async function revokeClient(c: ApiClientDto) {
  if (!confirm(`Revoke ${c.name}? Issued tokens stop working immediately.`)) return;
  await apiFetch(`/api/v1/integrations/api-clients/${c.id}/revoke`, { method: 'POST' });
  await loadClients();
}

/* ----------------------------- webhooks ----------------------------- */
const webhookList = useServerList<WebhookDto>('/api/v1/integrations/webhooks', {
  immediate: false,
  onError: (e) => {
    if (e instanceof ApiError && e.status === 403) webhooksDenied.value = true;
    else error.value ??= (e as Error).message;
  },
});
const { items: webhooks } = webhookList;
const eventTypes = ref<DomainEventTypeDto[]>([]);
const webhookDialog = ref(false);
const wForm = reactive({ name: '', url: 'https://', events: [] as string[] });
const deliveriesOf = ref<WebhookDto | null>(null);
const deliveryList = useServerList<WebhookDeliveryDto>(
  () => `/api/v1/integrations/webhooks/${deliveriesOf.value?.id}/deliveries`,
  { enabled: () => !!deliveriesOf.value, immediate: false, error },
);
const { items: deliveries } = deliveryList;

async function loadWebhooks() {
  const [, e] = await Promise.all([
    webhookList.load(),
    apiFetch<{ data: DomainEventTypeDto[] }>('/api/v1/integrations/events'),
  ]);
  eventTypes.value = e.data;
}
async function createWebhook() {
  error.value = null;
  try {
    const res = await apiFetch<{ data: WebhookCreatedDto }>('/api/v1/integrations/webhooks', {
      method: 'POST',
      body: JSON.stringify({ name: wForm.name, url: wForm.url, events: wForm.events }),
    });
    shownSecret.value = {
      label: `Webhook ${res.data.name} signing secret`,
      value: res.data.signingSecret,
    };
    webhookDialog.value = false;
    await loadWebhooks();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function toggleWebhook(w: WebhookDto) {
  await apiFetch(`/api/v1/integrations/webhooks/${w.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive: !w.isActive }),
  });
  await loadWebhooks();
}
async function removeWebhook(w: WebhookDto) {
  if (!confirm(`Delete webhook ${w.name}?`)) return;
  await apiFetch(`/api/v1/integrations/webhooks/${w.id}`, { method: 'DELETE' });
  await loadWebhooks();
}
function openDeliveries(w: WebhookDto) {
  deliveriesOf.value = w;
  deliveryList.reset();
}
async function replay(d: WebhookDeliveryDto) {
  if (!deliveriesOf.value) return;
  await apiFetch(
    `/api/v1/integrations/webhooks/${deliveriesOf.value.id}/deliveries/${d.id}/replay`,
    {
      method: 'POST',
    },
  );
  await deliveryList.load();
}

onMounted(async () => {
  const results = await Promise.allSettled([loadClients(), loadWebhooks()]);
  const [clientsResult, webhooksResult] = results;
  if (clientsResult.status === 'rejected') error.value = (clientsResult.reason as Error).message;
  if (webhooksResult.status === 'rejected') {
    const e = webhooksResult.reason;
    if (e instanceof ApiError && e.status === 403) webhooksDenied.value = true;
    else error.value ??= (e as Error).message;
  }
});

const when = (v: string | null) => (v ? new Date(v).toLocaleString() : '—');
</script>

<template>
  <h2 class="text-h5 mb-4">API clients &amp; webhooks</h2>
  <v-alert v-if="error" type="error" class="mb-4" closable>{{ error }}</v-alert>
  <v-alert
    v-if="shownSecret"
    type="warning"
    class="mb-4"
    closable
    @click:close="shownSecret = null"
  >
    {{ shownSecret.label }} — copy it now, it will not be shown again:
    <code>{{ shownSecret.value }}</code>
  </v-alert>
  <v-tabs v-model="tab" class="mb-4">
    <v-tab value="clients">API clients</v-tab>
    <v-tab value="webhooks">Webhooks</v-tab>
  </v-tabs>

  <template v-if="tab === 'clients'">
    <v-alert type="info" variant="tonal" class="mb-2" density="compact">
      Obtain a token with <code>POST /api/v1/oauth/token</code> (grant_type=client_credentials).
    </v-alert>
    <div class="d-flex mb-2">
      <v-spacer />
      <v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" @click="clientDialog = true">
        New API client
      </v-btn>
    </div>
    <v-data-table-server
      v-model:page="clientList.page.value"
      v-model:items-per-page="clientList.pageSize.value"
      :items-length="clientList.total.value"
      :loading="clientList.loading.value"
      :items-per-page-options="PAGE_SIZE_OPTIONS"
      disable-sort
      :items="clients"
      :headers="[
        { title: 'Name', key: 'name' },
        { title: 'Client ID', key: 'clientId' },
        { title: 'Scopes', key: 'scopes' },
        { title: 'Rate/min', key: 'rateLimitPerMinute' },
        { title: 'Status', key: 'status' },
        { title: 'Last used', key: 'lastUsedAt' },
        { title: '', key: 'actions', sortable: false },
      ]"
    >
      <template #[`item.scopes`]="{ item }">
        <v-chip v-for="s in item.scopes" :key="s" size="x-small" class="mr-1">{{ s }}</v-chip>
      </template>
      <template #[`item.lastUsedAt`]="{ item }">{{ when(item.lastUsedAt) }}</template>
      <template #[`item.actions`]="{ item }">
        <template v-if="canManage && item.status === 'ACTIVE'">
          <v-btn
            size="small"
            variant="text"
            icon="mdi-rotate-right"
            title="Rotate secret"
            @click="rotateClient(item)"
          />
          <v-btn
            size="small"
            variant="text"
            icon="mdi-cancel"
            title="Revoke"
            @click="revokeClient(item)"
          />
        </template>
      </template>
    </v-data-table-server>
  </template>

  <v-alert v-else-if="webhooksDenied" type="info" variant="tonal">
    Webhooks are managed by organization-level integration admins.
  </v-alert>
  <template v-else>
    <div class="d-flex mb-2">
      <v-spacer />
      <v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" @click="webhookDialog = true">
        New webhook
      </v-btn>
    </div>
    <v-data-table-server
      v-model:page="webhookList.page.value"
      v-model:items-per-page="webhookList.pageSize.value"
      :items-length="webhookList.total.value"
      :loading="webhookList.loading.value"
      :items-per-page-options="PAGE_SIZE_OPTIONS"
      disable-sort
      :items="webhooks"
      :headers="[
        { title: 'Name', key: 'name' },
        { title: 'URL', key: 'url' },
        { title: 'Events', key: 'events' },
        { title: 'Failures', key: 'consecutiveFailures' },
        { title: 'Last success', key: 'lastSuccessAt' },
        { title: 'Active', key: 'isActive' },
        { title: '', key: 'actions', sortable: false },
      ]"
    >
      <template #[`item.events`]="{ item }">{{ item.events.join(', ') }}</template>
      <template #[`item.lastSuccessAt`]="{ item }">{{ when(item.lastSuccessAt) }}</template>
      <template #[`item.isActive`]="{ item }">
        <v-switch
          :model-value="item.isActive"
          :disabled="!canManage"
          hide-details
          density="compact"
          @update:model-value="toggleWebhook(item)"
        />
      </template>
      <template #[`item.actions`]="{ item }">
        <v-btn
          size="small"
          variant="text"
          icon="mdi-history"
          title="Deliveries"
          @click="openDeliveries(item)"
        />
        <v-btn
          v-if="canManage"
          size="small"
          variant="text"
          icon="mdi-delete"
          title="Delete"
          @click="removeWebhook(item)"
        />
      </template>
    </v-data-table-server>
  </template>

  <v-dialog v-model="clientDialog" max-width="520">
    <v-card title="New API client">
      <v-card-text>
        <v-text-field v-model="cForm.name" label="Name" />
        <v-textarea
          v-model="cForm.scopes"
          label="Scopes (permission codes, comma separated)"
          rows="2"
          auto-grow
        />
        <v-text-field
          v-model.number="cForm.rateLimitPerMinute"
          type="number"
          label="Requests / minute"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="clientDialog = false">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!cForm.name" @click="createClient">
          Create
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="webhookDialog" max-width="560">
    <v-card title="New webhook">
      <v-card-text>
        <v-text-field v-model="wForm.name" label="Name" />
        <v-text-field v-model="wForm.url" label="HTTPS URL" />
        <v-select
          v-model="wForm.events"
          :items="eventTypes.map((e) => ({ title: `${e.label} (${e.key})`, value: e.key }))"
          label="Events"
          multiple
          chips
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="webhookDialog = false">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!wForm.name || wForm.events.length === 0"
          @click="createWebhook"
        >
          Create
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="!!deliveriesOf"
    max-width="900"
    @update:model-value="(v) => !v && (deliveriesOf = null)"
  >
    <v-card v-if="deliveriesOf" :title="`Deliveries — ${deliveriesOf.name}`">
      <v-data-table-server
        v-model:page="deliveryList.page.value"
        v-model:items-per-page="deliveryList.pageSize.value"
        :items-length="deliveryList.total.value"
        :loading="deliveryList.loading.value"
        :items-per-page-options="PAGE_SIZE_OPTIONS"
        disable-sort
        :items="deliveries"
        density="compact"
        :headers="[
          { title: 'Event', key: 'eventKey' },
          { title: 'Status', key: 'status' },
          { title: 'Attempts', key: 'attempts' },
          { title: 'HTTP', key: 'lastStatusCode' },
          { title: 'Error', key: 'lastError' },
          { title: 'Created', key: 'createdAt' },
          { title: '', key: 'actions', sortable: false },
        ]"
      >
        <template #[`item.createdAt`]="{ item }">{{ when(item.createdAt) }}</template>
        <template #[`item.actions`]="{ item }">
          <v-btn v-if="canManage" size="small" variant="text" @click="replay(item)">Replay</v-btn>
        </template>
      </v-data-table-server>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="deliveriesOf = null">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

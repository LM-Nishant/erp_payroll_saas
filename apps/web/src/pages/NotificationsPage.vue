<script setup lang="ts">
import type {
  ApiListResponse,
  NotificationDto,
  NotificationEventDto,
  NotificationPreferenceDto,
} from '@erp/shared';
import { computed, onMounted, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
/** Notifications are per organization; platform-only accounts (no membership) have none. */
const hasOrganization = computed(() => Boolean(auth.me?.organization));

const items = ref<NotificationDto[]>([]);
const total = ref(0);
const unreadOnly = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);

const events = ref<NotificationEventDto[]>([]);
const prefs = ref<NotificationPreferenceDto[]>([]);
const CHANNELS = ['in_app', 'email', 'sms', 'whatsapp', 'push'] as const;

async function load() {
  loading.value = true;
  try {
    const res = await apiFetch<ApiListResponse<NotificationDto>>(
      `/api/v1/notifications?pageSize=100${unreadOnly.value ? '&unread=true' : ''}`,
    );
    items.value = res.data;
    total.value = res.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function loadPrefs() {
  const [ev, pr] = await Promise.all([
    apiFetch<{ data: NotificationEventDto[] }>('/api/v1/notifications/events'),
    apiFetch<{ data: NotificationPreferenceDto[] }>('/api/v1/notifications/preferences'),
  ]);
  events.value = ev.data;
  prefs.value = pr.data;
}
onMounted(() => (hasOrganization.value ? Promise.all([load(), loadPrefs()]) : undefined));

const enabled = computed(() => (eventKey: string, channel: string, fallback: boolean) => {
  const p = prefs.value.find((x) => x.eventKey === eventKey && x.channel === channel);
  return p ? p.enabled : fallback;
});
async function toggle(eventKey: string, channel: string, value: boolean) {
  prefs.value = (
    await apiFetch<{ data: NotificationPreferenceDto[] }>('/api/v1/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify({ preferences: [{ eventKey, channel, enabled: value }] }),
    })
  ).data;
}

async function markRead(n: NotificationDto) {
  await apiFetch(`/api/v1/notifications/${n.id}/read`, { method: 'POST' });
  await load();
}
async function markAll() {
  await apiFetch('/api/v1/notifications/read-all', { method: 'POST' });
  await load();
}
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Notifications</h2>
    <v-spacer />
    <template v-if="hasOrganization">
      <v-switch
        v-model="unreadOnly"
        label="Unread only"
        hide-details
        density="compact"
        class="mr-4"
        @update:model-value="load"
      />
      <v-btn variant="tonal" @click="markAll">Mark all read</v-btn>
    </template>
  </div>
  <v-alert v-if="!hasOrganization" type="info" variant="tonal" class="mb-4">
    Notifications belong to an organization. This account has no organization membership, so there
    are none to show.
  </v-alert>
  <v-alert v-if="error" type="error" class="mb-4" closable>{{ error }}</v-alert>
  <template v-if="hasOrganization">
    <v-card :loading="loading" class="mb-6">
      <v-list lines="two">
        <v-list-item v-if="items.length === 0" title="No notifications" />
        <v-list-item
          v-for="n in items"
          :key="n.id"
          :title="n.title"
          :subtitle="`${n.body ?? ''} · ${new Date(n.createdAt).toLocaleString()}`"
          :to="n.link?.startsWith('/') ? n.link : undefined"
          :class="{ 'font-weight-bold': !n.readAt }"
        >
          <template #append>
            <v-btn
              v-if="!n.readAt"
              size="small"
              variant="text"
              icon="mdi-check"
              title="Mark read"
              @click.prevent="markRead(n)"
            />
          </template>
        </v-list-item>
      </v-list>
    </v-card>

    <h3 class="text-h6 mb-2">Delivery preferences</h3>
    <v-table density="compact">
      <thead>
        <tr>
          <th>Event</th>
          <th v-for="c in CHANNELS" :key="c">{{ c }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in events" :key="e.key">
          <td>{{ e.label }}</td>
          <td v-for="c in CHANNELS" :key="c">
            <v-checkbox-btn
              :model-value="enabled(e.key, c, e.defaultChannels.includes(c))"
              :disabled="e.mandatory"
              @update:model-value="(v: boolean) => toggle(e.key, c, v)"
            />
          </td>
        </tr>
      </tbody>
    </v-table>
  </template>
</template>

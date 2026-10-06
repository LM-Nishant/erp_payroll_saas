<script setup lang="ts">
import type { ApiListResponse, NotificationDto } from '@erp/shared';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';

/** App-bar bell: unread count (polled) + the latest notifications. */
const props = defineProps<{ base: string }>();
const router = useRouter();
const unread = ref(0);
const items = ref<NotificationDto[]>([]);
const open = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

async function refreshCount() {
  try {
    unread.value = (
      await apiFetch<{ data: { count: number } }>('/api/v1/notifications/unread-count')
    ).data.count;
  } catch {
    /* ignore (e.g. signed out) */
  }
}
async function loadLatest() {
  items.value = (
    await apiFetch<ApiListResponse<NotificationDto>>('/api/v1/notifications?pageSize=10')
  ).data;
}
async function openItem(n: NotificationDto) {
  if (!n.readAt) {
    await apiFetch(`/api/v1/notifications/${n.id}/read`, { method: 'POST' });
    await refreshCount();
  }
  open.value = false;
  if (n.link?.startsWith('/')) await router.push(n.link);
  else if (n.link) window.open(n.link, '_blank', 'noopener');
}
async function markAll() {
  await apiFetch('/api/v1/notifications/read-all', { method: 'POST' });
  await Promise.all([refreshCount(), loadLatest()]);
}

onMounted(() => {
  void refreshCount();
  timer = setInterval(refreshCount, 60_000);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <v-menu
    v-model="open"
    :close-on-content-click="false"
    @update:model-value="(v) => v && loadLatest()"
  >
    <template #activator="{ props: activator }">
      <v-btn v-bind="activator" icon title="Notifications">
        <v-badge v-if="unread > 0" :content="unread > 99 ? '99+' : unread" color="error">
          <v-icon>mdi-bell</v-icon>
        </v-badge>
        <v-icon v-else>mdi-bell-outline</v-icon>
      </v-btn>
    </template>
    <v-card min-width="360" max-width="420">
      <v-card-title class="d-flex align-center">
        Notifications
        <v-spacer />
        <v-btn size="small" variant="text" :disabled="unread === 0" @click="markAll">
          Mark all read
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-list density="compact" max-height="400" class="overflow-y-auto">
        <v-list-item v-if="items.length === 0" title="You're all caught up" />
        <v-list-item
          v-for="n in items"
          :key="n.id"
          :title="n.title"
          :subtitle="n.body ?? new Date(n.createdAt).toLocaleString()"
          :class="{ 'font-weight-bold': !n.readAt }"
          @click="openItem(n)"
        >
          <template #prepend>
            <v-icon :color="n.readAt ? 'grey' : 'primary'" size="small">mdi-circle-medium</v-icon>
          </template>
        </v-list-item>
      </v-list>
      <v-divider />
      <v-card-actions>
        <v-btn block variant="text" :to="`${props.base}/notifications`" @click="open = false">
          View all
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-menu>
</template>

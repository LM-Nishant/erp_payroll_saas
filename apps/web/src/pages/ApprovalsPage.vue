<script setup lang="ts">
import type {
  WorkflowActionType,
  WorkflowInboxItemDto,
  WorkflowInstanceDetailDto,
  WorkflowInstanceDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '@/api/client';
import { PAGE_SIZE_OPTIONS, useServerList } from '@/lib/serverList';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const auth = useAuthStore();

/** Approvals inbox (steps waiting on me), my requests, and the full instance history. */
const tab = ref<'inbox' | 'mine'>('inbox');
const error = ref<string | null>(null);
const inboxList = useServerList<WorkflowInboxItemDto>('/api/v1/workflows/inbox', {
  error,
  immediate: false,
});
const mineList = useServerList<WorkflowInstanceDto>('/api/v1/workflows/instances?view=mine', {
  error,
  immediate: false,
});
const {
  items: inbox,
  total: inboxTotal,
  page: inboxPage,
  pageSize: inboxPageSize,
  loading: inboxLoading,
} = inboxList;
const {
  items: mine,
  total: mineTotal,
  page: minePage,
  pageSize: minePageSize,
  loading: mineLoading,
} = mineList;

const detail = ref<WorkflowInstanceDetailDto | null>(null);
const form = reactive({ comment: '', delegateToUserId: null as string | null });

interface DelegateUser {
  id: string;
  name: string;
  email: string;
}
const delegates = ref<DelegateUser[]>([]);
const delegateSearch = ref('');
let delegateTimer: ReturnType<typeof setTimeout> | undefined;
async function loadDelegates(term: string) {
  if (!detail.value?.allowedActions.includes('delegate')) return;
  const params = new URLSearchParams();
  if (term.trim()) params.set('search', term.trim());
  delegates.value = await apiFetch<{ data: DelegateUser[] }>(
    `/api/v1/workflows/instances/${detail.value.id}/delegates?${params}`,
  )
    .then((r) => r.data)
    .catch(() => []);
}
watch(delegateSearch, (term) => {
  const picked = delegates.value.find((u) => u.id === form.delegateToUserId);
  if (picked && term === `${picked.name} (${picked.email})`) return;
  clearTimeout(delegateTimer);
  delegateTimer = setTimeout(() => void loadDelegates(term ?? ''), 250);
});

async function load() {
  error.value = null;
  await Promise.all([inboxList.load(), mineList.load()]);
}
onMounted(async () => {
  await load();
  await openFromQuery();
});

// `?open=<instanceId>` (from a notification link) opens that request straight away.
async function openFromQuery() {
  const id = route.query.open;
  if (typeof id !== 'string' || !id) return;
  try {
    await open(id);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
watch(() => route.query.open, openFromQuery);

function onRow(_e: unknown, row: { item: WorkflowInstanceDto }) {
  void open(row.item.id);
}

async function open(id: string) {
  Object.assign(form, { comment: '', delegateToUserId: null });
  delegates.value = [];
  detail.value = (
    await apiFetch<{ data: WorkflowInstanceDetailDto }>(`/api/v1/workflows/instances/${id}`)
  ).data;
  await loadDelegates('');
}

/**
 * "Withdraw" = the requester retracting their own request; an approver says no with "Reject".
 * The API also lets workflow administrators cancel someone else's request — labelled explicitly.
 */
const isRequester = computed(
  () => !!detail.value?.requester && detail.value.requester.id === auth.me?.user.id,
);
const cancelLabel = computed(() =>
  isRequester.value ? 'Withdraw request' : 'Cancel request (admin)',
);

async function act(action: WorkflowActionType | 'cancel' | 'resubmit') {
  if (!detail.value) return;
  if (
    action === 'cancel' &&
    !confirm(
      isRequester.value
        ? 'Withdraw this request? Approvers will no longer see it.'
        : `Cancel ${detail.value.requester?.name ?? 'this user'}'s request as an administrator? Use Reject instead to decline it as an approver.`,
    )
  )
    return;
  error.value = null;
  const id = detail.value.id;
  try {
    if (action === 'cancel' || action === 'resubmit') {
      await apiFetch(`/api/v1/workflows/instances/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ comment: form.comment || null }),
      });
    } else {
      await apiFetch(`/api/v1/workflows/instances/${id}/actions`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          comment: form.comment || null,
          ...(action === 'delegate' ? { delegateToUserId: form.delegateToUserId } : {}),
        }),
      });
    }
    await Promise.all([open(id), load()]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const statusColor: Record<string, string> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
  SENT_BACK: 'orange',
  CANCELLED: 'grey',
};
const headers = [
  { title: 'Request', key: 'title' },
  { title: 'Type', key: 'entityType' },
  { title: 'Requester', key: 'requester.name' },
  { title: 'Status', key: 'status' },
  { title: 'Created', key: 'createdAt' },
];
</script>

<template>
  <h2 class="text-h5 mb-4">Approvals</h2>
  <v-alert v-if="error" type="error" class="mb-4" closable>{{ error }}</v-alert>
  <v-tabs v-model="tab" class="mb-2">
    <v-tab value="inbox">Pending my approval ({{ inboxTotal }})</v-tab>
    <v-tab value="mine">My requests</v-tab>
  </v-tabs>
  <v-data-table-server
    v-if="tab === 'inbox'"
    v-model:page="inboxPage"
    v-model:items-per-page="inboxPageSize"
    :items="inbox"
    :headers="[...headers, { title: 'Step', key: 'stepName' }]"
    :loading="inboxLoading"
    :items-length="inboxTotal"
    :items-per-page-options="PAGE_SIZE_OPTIONS"
    disable-sort
    hover
    @click:row="onRow"
  >
    <template #[`item.status`]="{ item }">
      <v-chip size="small" :color="statusColor[item.status]">{{ item.status }}</v-chip>
    </template>
    <template #[`item.createdAt`]="{ item }">
      {{ new Date(item.createdAt).toLocaleString() }}
    </template>
    <template #[`item.stepName`]="{ item }">
      {{ (item as WorkflowInboxItemDto).stepName }}
      <v-chip v-if="(item as WorkflowInboxItemDto).overdue" size="x-small" color="error">
        overdue
      </v-chip>
    </template>
  </v-data-table-server>
  <v-data-table-server
    v-else
    v-model:page="minePage"
    v-model:items-per-page="minePageSize"
    :items="mine"
    :headers="headers"
    :loading="mineLoading"
    :items-length="mineTotal"
    :items-per-page-options="PAGE_SIZE_OPTIONS"
    disable-sort
    hover
    @click:row="onRow"
  >
    <template #[`item.status`]="{ item }">
      <v-chip size="small" :color="statusColor[item.status]">{{ item.status }}</v-chip>
    </template>
    <template #[`item.createdAt`]="{ item }">
      {{ new Date(item.createdAt).toLocaleString() }}
    </template>
  </v-data-table-server>

  <v-dialog
    :model-value="!!detail"
    max-width="760"
    @update:model-value="(v) => !v && (detail = null)"
  >
    <v-card
      v-if="detail"
      :title="detail.title"
      :subtitle="`${detail.entityType} · v${detail.definitionVersion}`"
    >
      <v-card-text>
        <v-chip class="mb-3" :color="statusColor[detail.status]">{{ detail.status }}</v-chip>
        <h4 class="text-subtitle-1">Steps</h4>
        <v-list density="compact">
          <v-list-item
            v-for="s in detail.steps"
            :key="s.id"
            :title="`${s.order}. ${s.name} (${s.mode})`"
            :subtitle="s.assignees.map((a) => `${a.name ?? a.userId}: ${a.status}`).join(', ')"
          >
            <template #append>
              <v-chip size="x-small">{{ s.status }}</v-chip>
            </template>
          </v-list-item>
        </v-list>
        <h4 class="text-subtitle-1 mt-2">History</h4>
        <v-timeline density="compact" side="end">
          <v-timeline-item v-for="a in detail.actions" :key="a.id" size="x-small">
            <strong>{{ a.action }}</strong>
            <span v-if="a.stepKey"> · {{ a.stepKey }}</span>
            by {{ a.actor?.name ?? 'system' }} — {{ new Date(a.createdAt).toLocaleString() }}
            <div v-if="a.comment" class="text-medium-emphasis">“{{ a.comment }}”</div>
          </v-timeline-item>
        </v-timeline>
        <template v-if="detail.allowedActions.length">
          <v-textarea v-model="form.comment" label="Comment" rows="2" auto-grow class="mt-2" />
          <v-autocomplete
            v-if="detail.allowedActions.includes('delegate')"
            v-model="form.delegateToUserId"
            v-model:search="delegateSearch"
            :items="delegates"
            :item-title="(u: DelegateUser) => `${u.name} (${u.email})`"
            item-value="id"
            label="Delegate to"
            placeholder="Type a name or email"
            density="compact"
            clearable
            no-filter
          />
        </template>
      </v-card-text>
      <v-card-actions class="flex-wrap">
        <v-btn
          v-if="detail.allowedActions.includes('approve')"
          color="success"
          variant="flat"
          @click="act('approve')"
          >Approve</v-btn
        >
        <v-btn v-if="detail.allowedActions.includes('reject')" color="error" @click="act('reject')"
          >Reject</v-btn
        >
        <v-btn v-if="detail.allowedActions.includes('send_back')" @click="act('send_back')"
          >Send back</v-btn
        >
        <v-btn
          v-if="detail.allowedActions.includes('delegate')"
          :disabled="!form.delegateToUserId"
          @click="act('delegate')"
          >Delegate</v-btn
        >
        <v-btn
          v-if="detail.allowedActions.includes('comment')"
          :disabled="!form.comment"
          @click="act('comment')"
          >Comment</v-btn
        >
        <v-btn v-if="detail.allowedActions.includes('resubmit')" @click="act('resubmit')"
          >Resubmit</v-btn
        >
        <v-spacer />
        <v-btn
          v-if="detail.allowedActions.includes('cancel')"
          color="warning"
          variant="text"
          @click="act('cancel')"
          >{{ cancelLabel }}</v-btn
        >
        <v-btn @click="detail = null">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import type { LedgerAccountDto } from '@erp/shared';
import { ACCOUNT_TYPES } from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { errorText } from '../fees/fees';

const auth = useAuthStore();
const canManage = computed(() => auth.can('finance.manage'));
const accounts = ref<LedgerAccountDto[]>([]);
const error = ref<string | null>(null);
const loading = ref(false);
const search = ref('');

/** Depth-first ordering so the chart renders as an indented tree. */
const tree = computed(() => {
  const byParent = new Map<string | null, LedgerAccountDto[]>();
  for (const a of accounts.value) {
    const k = a.parentId;
    byParent.set(k, [...(byParent.get(k) ?? []), a]);
  }
  const out: Array<LedgerAccountDto & { depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const a of (byParent.get(parent) ?? []).sort((x, y) => x.code.localeCompare(y.code))) {
      out.push({ ...a, depth });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  const q = search.value.toLowerCase();
  return q
    ? out.filter((a) => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q))
    : out;
});
const groups = computed(() => accounts.value.filter((a) => a.isGroup));

async function load() {
  loading.value = true;
  try {
    accounts.value = (
      await apiFetch<{ data: LedgerAccountDto[] }>('/api/v1/finance/accounts?includeInactive=true')
    ).data;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
const dialog = ref(false);
const form = reactive({
  parentId: null as string | null,
  code: '',
  name: '',
  type: 'EXPENSE',
  isGroup: false,
  description: '',
});
function openCreate() {
  Object.assign(form, {
    parentId: null,
    code: '',
    name: '',
    type: 'EXPENSE',
    isGroup: false,
    description: '',
  });
  dialog.value = true;
}
async function save() {
  try {
    await apiFetch('/api/v1/finance/accounts', {
      method: 'POST',
      body: JSON.stringify({ ...form, description: form.description || null }),
    });
    dialog.value = false;
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
async function toggle(a: LedgerAccountDto) {
  try {
    await apiFetch(`/api/v1/finance/accounts/${a.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !a.active }),
    });
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
async function remove(a: LedgerAccountDto) {
  if (!confirm(`Delete account ${a.code} ${a.name}?`)) return;
  try {
    await apiFetch(`/api/v1/finance/accounts/${a.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(load);
</script>
<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Chart of accounts</h2>
    <v-spacer /><v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" @click="openCreate"
      >New account</v-btn
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-text-field v-model="search" label="Search" density="compact" class="mb-2" hide-details />
  <v-progress-linear v-if="loading" indeterminate />
  <v-table density="compact">
    <thead>
      <tr>
        <th>Code</th>
        <th>Account</th>
        <th>Type</th>
        <th>System key</th>
        <th>Active</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="a in tree" :key="a.id">
        <td>{{ a.code }}</td>
        <td :style="{ paddingLeft: `${16 + a.depth * 20}px` }">
          <strong v-if="a.isGroup">{{ a.name }}</strong
          ><span v-else>{{ a.name }}</span>
        </td>
        <td>{{ a.type }}</td>
        <td class="text-medium-emphasis">{{ a.systemKey }}</td>
        <td>{{ a.active ? 'Yes' : 'No' }}</td>
        <td class="text-right">
          <template v-if="canManage"
            ><v-btn
              v-if="!(a.systemKey && a.active)"
              size="small"
              variant="text"
              @click="toggle(a)"
              >{{ a.active ? 'Deactivate' : 'Activate' }}</v-btn
            ><v-btn
              v-if="!a.systemKey"
              size="small"
              variant="text"
              icon="mdi-delete"
              @click="remove(a)"
          /></template>
        </td>
      </tr>
    </tbody>
  </v-table>
  <v-dialog v-model="dialog" max-width="560"
    ><v-card
      ><v-card-title>New account</v-card-title
      ><v-card-text
        ><v-row dense
          ><v-col cols="12"
            ><v-autocomplete
              v-model="form.parentId"
              :items="groups"
              :item-title="(a: LedgerAccountDto) => `${a.code} ${a.name}`"
              item-value="id"
              label="Parent group"
              clearable /></v-col
          ><v-col cols="4"><v-text-field v-model="form.code" label="Code" /></v-col
          ><v-col cols="8"><v-text-field v-model="form.name" label="Name" /></v-col
          ><v-col cols="6"
            ><v-select
              v-model="form.type"
              :items="[...ACCOUNT_TYPES] as string[]"
              label="Type" /></v-col
          ><v-col cols="6"><v-switch v-model="form.isGroup" label="Group (no postings)" /></v-col
          ><v-col cols="12"
            ><v-text-field
              v-model="form.description"
              label="Description" /></v-col></v-row></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="dialog = false">Cancel</v-btn
        ><v-btn color="primary" @click="save">Create</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>

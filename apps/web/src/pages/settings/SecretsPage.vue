<script setup lang="ts">
import type { ApiListResponse, SecretDto } from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

/**
 * Secret values are WRITE-ONLY: the API never returns them. This page only shows masked
 * metadata; values are typed into password fields and sent once.
 */
const auth = useAuthStore();
const items = ref<SecretDto[]>([]);
const error = ref<string | null>(null);
const loading = ref(false);
const canManage = computed(() => auth.can('secret.manage'));

const dialog = ref(false);
const rotating = ref<SecretDto | null>(null);
const form = reactive({ kind: 'smtp', name: 'default', description: '', value: '' });

async function load() {
  loading.value = true;
  try {
    items.value = (await apiFetch<ApiListResponse<SecretDto>>('/api/v1/secrets?pageSize=100')).data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function openCreate() {
  rotating.value = null;
  Object.assign(form, { kind: 'smtp', name: 'default', description: '', value: '' });
  dialog.value = true;
}
function openRotate(s: SecretDto) {
  rotating.value = s;
  form.value = '';
  dialog.value = true;
}

async function submit() {
  error.value = null;
  try {
    if (rotating.value) {
      await apiFetch(`/api/v1/secrets/${rotating.value.id}/rotate`, {
        method: 'POST',
        body: JSON.stringify({ value: form.value }),
      });
    } else {
      await apiFetch('/api/v1/secrets', {
        method: 'POST',
        body: JSON.stringify({
          kind: form.kind,
          name: form.name,
          description: form.description || null,
          value: form.value,
        }),
      });
    }
    dialog.value = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    form.value = '';
  }
}

async function remove(s: SecretDto) {
  if (!confirm(`Delete secret ${s.kind}/${s.name}? Engines using it will stop working.`)) return;
  await apiFetch(`/api/v1/secrets/${s.id}`, { method: 'DELETE' });
  await load();
}

const headers = [
  { title: 'Kind', key: 'kind' },
  { title: 'Name', key: 'name' },
  { title: 'Scope', key: 'scopeType' },
  { title: 'Value', key: 'masked', sortable: false },
  { title: 'Version', key: 'version' },
  { title: 'Rotated', key: 'rotatedAt' },
  { title: '', key: 'actions', sortable: false },
];
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Secrets</h2>
    <v-spacer />
    <v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" @click="openCreate">
      Add secret
    </v-btn>
  </div>
  <v-alert type="info" variant="tonal" class="mb-4">
    Secret values are encrypted and write-only — they can be replaced (rotated) but never viewed.
  </v-alert>
  <v-alert v-if="error" type="error" class="mb-4" closable>{{ error }}</v-alert>
  <v-data-table :items="items" :headers="headers" :loading="loading">
    <template #[`item.masked`]="{ item }">
      <code>{{ item.masked }}</code>
      <span class="text-caption ml-2">fp {{ item.fingerprint.slice(0, 8) }}</span>
    </template>
    <template #[`item.rotatedAt`]="{ item }">
      {{ item.rotatedAt ? new Date(item.rotatedAt).toLocaleString() : '—' }}
    </template>
    <template #[`item.actions`]="{ item }">
      <template v-if="canManage">
        <v-btn
          size="small"
          variant="text"
          icon="mdi-rotate-right"
          title="Rotate"
          @click="openRotate(item)"
        />
        <v-btn size="small" variant="text" icon="mdi-delete" title="Delete" @click="remove(item)" />
      </template>
    </template>
  </v-data-table>

  <v-dialog v-model="dialog" max-width="520">
    <v-card :title="rotating ? `Rotate ${rotating.kind}/${rotating.name}` : 'Add secret'">
      <v-card-text>
        <template v-if="!rotating">
          <v-text-field v-model="form.kind" label="Kind (e.g. smtp, sms, ai.openai)" />
          <v-text-field v-model="form.name" label="Name" />
          <v-text-field v-model="form.description" label="Description" />
        </template>
        <v-text-field
          v-model="form.value"
          label="Secret value"
          type="password"
          autocomplete="new-password"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="dialog = false">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!form.value" @click="submit">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

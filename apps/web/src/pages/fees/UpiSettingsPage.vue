<script setup lang="ts">
import type { FeeUpiSettingDto } from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { errorText, loadInstitutions, type Option } from './fees';

const auth = useAuthStore();
const canManage = computed(() => auth.can('fee.manage'));
const institutions = ref<Option[]>([]);
const settings = ref<FeeUpiSettingDto[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const info = ref<string | null>(null);
const UPI_ID = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$/;

const rows = computed(() =>
  institutions.value.map((i) => ({
    institution: i,
    setting: settings.value.find((s) => s.institutionId === i.id) ?? null,
  })),
);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [inst, s] = await Promise.all([
      loadInstitutions(),
      apiFetch<{ data: FeeUpiSettingDto[] }>('/api/v1/fees/upi/settings'),
    ]);
    institutions.value = inst;
    settings.value = s.data;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

const editing = ref<Option | null>(null);
const form = reactive({ upiId: '', payeeName: '', active: true });
const saving = ref(false);
function edit(i: Option, s: FeeUpiSettingDto | null) {
  Object.assign(form, {
    upiId: s?.upiId ?? '',
    payeeName: s?.payeeName ?? i.name,
    active: s?.active ?? true,
  });
  editing.value = i;
}
async function save() {
  if (!editing.value) return;
  saving.value = true;
  try {
    await apiFetch('/api/v1/fees/upi/settings', {
      method: 'PUT',
      body: JSON.stringify({
        institutionId: editing.value.id,
        upiId: form.upiId.trim(),
        payeeName: form.payeeName.trim(),
        active: form.active,
      }),
    });
    info.value = `UPI ID saved for ${editing.value.name}.`;
    editing.value = null;
    await load();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    saving.value = false;
  }
}
onMounted(load);
</script>
<template>
  <h2 class="text-h5 mb-1">UPI settings</h2>
  <p class="text-medium-emphasis mb-4">
    All fee payments are collected via UPI only. Each institution receives fees on its own UPI ID;
    students and parents see a QR code for it on their fee page.
  </p>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-alert v-if="info" type="success" class="mb-3" closable @click:close="info = null">{{
    info
  }}</v-alert>
  <v-progress-linear v-if="loading" indeterminate class="mb-2" />
  <v-table density="comfortable" data-testid="upi-settings">
    <thead>
      <tr>
        <th>Institution</th>
        <th>UPI ID</th>
        <th>Payee name</th>
        <th>Status</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="r in rows" :key="r.institution.id">
        <td>{{ r.institution.name }}</td>
        <td>{{ r.setting?.upiId ?? '—' }}</td>
        <td>{{ r.setting?.payeeName ?? '—' }}</td>
        <td>
          <v-chip v-if="!r.setting" size="small" color="warning">Not set up</v-chip>
          <v-chip v-else-if="r.setting.active" size="small" color="success">Active</v-chip>
          <v-chip v-else size="small">Inactive</v-chip>
        </td>
        <td class="text-right">
          <v-btn
            v-if="canManage"
            size="small"
            variant="text"
            color="primary"
            @click="edit(r.institution, r.setting)"
            >{{ r.setting ? 'Edit' : 'Set up' }}</v-btn
          >
        </td>
      </tr>
      <tr v-if="!rows.length && !loading">
        <td colspan="5" class="text-medium-emphasis">No institutions.</td>
      </tr>
    </tbody>
  </v-table>
  <v-dialog :model-value="!!editing" max-width="460" @update:model-value="editing = null"
    ><v-card v-if="editing"
      ><v-card-title>UPI ID — {{ editing.name }}</v-card-title
      ><v-card-text
        ><v-text-field
          v-model="form.upiId"
          label="UPI ID (VPA) *"
          placeholder="schoolname@okhdfcbank"
          :rules="[
            (v: string) => UPI_ID.test((v ?? '').trim()) || 'Enter a valid UPI ID like name@bank',
          ]"
          data-testid="upi-id" /><v-text-field
          v-model="form.payeeName"
          label="Payee name *"
          hint="Shown in the payer's UPI app"
          persistent-hint /><v-switch
          v-model="form.active"
          color="primary"
          label="Accept fee payments on this UPI ID"
          hide-details /></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="editing = null">Close</v-btn
        ><v-btn
          color="primary"
          :loading="saving"
          :disabled="!UPI_ID.test(form.upiId.trim()) || form.payeeName.trim().length < 2"
          @click="save"
          >Save</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>

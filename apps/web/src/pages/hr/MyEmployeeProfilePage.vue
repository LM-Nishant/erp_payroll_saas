<script setup lang="ts">
import type { EmployeePersonalInput, MyEmployeeDto } from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { ApiError, apiFetch } from '@/api/client';
import { label, STATUS_COLORS } from './useHrOptions';

/**
 * Employee self-service profile. Statutory / bank fields are always masked.
 * Personal-field edits are submitted as change requests (routed through the
 * `employee_profile_change` workflow, or auto-applied when no definition exists).
 */
type Address = NonNullable<EmployeePersonalInput['addresses']>[number];
type Contact = NonNullable<EmployeePersonalInput['emergencyContacts']>[number];

const me = ref<MyEmployeeDto | null>(null);
const loading = ref(true);
const notLinked = ref(false);
const error = ref<string | null>(null);
const success = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    me.value = (await apiFetch<{ data: MyEmployeeDto }>('/api/v1/employees/me')).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notLinked.value = true;
    else error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const personal = computed(() => me.value?.profile.personal ?? ({} as EmployeePersonalInput));
const sensitive = computed(() => me.value?.profile.sensitive);

const MARITAL = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'OTHER'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const form = reactive({
  open: false,
  maritalStatus: null as string | null,
  bloodGroup: null as string | null,
  personalEmail: '',
  personalPhone: '',
  addresses: [] as Address[],
  emergencyContacts: [] as Contact[],
  reason: '',
});
function openForm() {
  const p = personal.value;
  Object.assign(form, {
    open: true,
    maritalStatus: p.maritalStatus ?? null,
    bloodGroup: p.bloodGroup ?? null,
    personalEmail: p.personalEmail ?? '',
    personalPhone: p.personalPhone ?? '',
    addresses: (p.addresses ?? []).map((a) => ({ ...a })),
    emergencyContacts: (p.emergencyContacts ?? []).map((c) => ({ ...c })),
    reason: '',
  });
}
const addAddress = () =>
  form.addresses.push({ type: 'CURRENT', line1: '', city: '', country: 'India' } as Address);
const addContact = () => form.emergencyContacts.push({ name: '', relation: '', phone: '' });

/** Only send fields that actually changed. */
function diff(): Record<string, unknown> {
  const p = personal.value;
  const next: Record<string, unknown> = {
    maritalStatus: form.maritalStatus,
    bloodGroup: form.bloodGroup,
    personalEmail: form.personalEmail.trim() || null,
    personalPhone: form.personalPhone.trim() || null,
    addresses: form.addresses,
    emergencyContacts: form.emergencyContacts,
  };
  const prev = p as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(next).filter(
      ([k, v]) =>
        JSON.stringify(v ?? null) !== JSON.stringify(prev[k] ?? (Array.isArray(v) ? [] : null)),
    ),
  );
}

async function submit() {
  const changes = diff();
  if (!Object.keys(changes).length) {
    form.open = false;
    return;
  }
  try {
    await apiFetch('/api/v1/employees/me/change-requests', {
      method: 'POST',
      body: JSON.stringify({ changes, reason: form.reason.trim() || null }),
    });
    form.open = false;
    success.value = 'Change request submitted.';
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <h2 class="text-h5 mb-4">My profile</h2>
  <v-progress-linear v-if="loading" indeterminate />
  <v-alert v-if="notLinked" type="info">
    Your account is not linked to an employee record. Contact HR.
  </v-alert>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-alert v-if="success" type="success" closable class="mb-4" @click:close="success = null">
    {{ success }}
  </v-alert>

  <template v-if="me">
    <v-card class="mb-4">
      <v-card-title class="d-flex align-center">
        {{ me.displayName }}
        <v-chip class="ml-3" size="small" :color="STATUS_COLORS[me.status]">
          {{ label(me.status) }}
        </v-chip>
        <v-spacer />
        <v-btn color="primary" variant="tonal" prepend-icon="mdi-pencil" @click="openForm">
          Request changes
        </v-btn>
      </v-card-title>
      <v-card-subtitle>
        {{ me.employeeCode }} · {{ me.designation?.name ?? '—' }} · {{ me.institution?.name }}
        <span v-if="me.department"> · {{ me.department.name }}</span>
      </v-card-subtitle>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <v-list density="compact">
              <v-list-item title="Date of joining" :subtitle="me.dateOfJoining ?? '—'" />
              <v-list-item title="Employment type" :subtitle="label(me.employmentType)" />
              <v-list-item title="Personal email" :subtitle="personal.personalEmail ?? '—'" />
              <v-list-item title="Personal phone" :subtitle="personal.personalPhone ?? '—'" />
              <v-list-item
                title="Marital status"
                :subtitle="personal.maritalStatus ? label(personal.maritalStatus) : '—'"
              />
              <v-list-item title="Blood group" :subtitle="personal.bloodGroup ?? '—'" />
            </v-list>
          </v-col>
          <v-col cols="12" md="6">
            <div class="text-subtitle-2 mb-1">Statutory & bank (masked)</div>
            <v-list density="compact">
              <v-list-item title="PAN" :subtitle="sensitive?.pan ?? '—'" />
              <v-list-item title="Aadhaar" :subtitle="sensitive?.aadhaar ?? '—'" />
              <v-list-item title="UAN" :subtitle="sensitive?.uan ?? '—'" />
              <v-list-item
                title="Bank account"
                :subtitle="
                  sensitive?.bankAccount
                    ? `${sensitive.bankAccount.accountNumber} (${sensitive.bankAccount.ifsc})`
                    : '—'
                "
              />
            </v-list>
          </v-col>
        </v-row>
        <div class="text-subtitle-2 mt-2">Addresses</div>
        <div v-for="(a, i) in personal.addresses ?? []" :key="i" class="text-body-2">
          <strong>{{ label(a.type) }}:</strong> {{ a.line1 }}, {{ a.city }}, {{ a.country }}
        </div>
        <div class="text-subtitle-2 mt-2">Emergency contacts</div>
        <div v-for="(c, i) in personal.emergencyContacts ?? []" :key="i" class="text-body-2">
          {{ c.name }} ({{ c.relation }}) — {{ c.phone }}
        </div>
      </v-card-text>
    </v-card>

    <v-card v-if="me.pendingChangeRequests.length" title="Pending change requests">
      <v-list density="compact">
        <v-list-item
          v-for="r in me.pendingChangeRequests"
          :key="r.id"
          :title="Object.keys(r.changes).map(label).join(', ')"
          :subtitle="`${label(r.status)} · ${r.createdAt.slice(0, 10)}`"
        />
      </v-list>
    </v-card>
  </template>

  <v-dialog v-model="form.open" max-width="720" scrollable>
    <v-card title="Request profile changes">
      <v-card-text>
        <v-row dense>
          <v-col cols="6">
            <v-select
              v-model="form.maritalStatus"
              :items="MARITAL"
              label="Marital status"
              clearable
            />
          </v-col>
          <v-col cols="6">
            <v-select v-model="form.bloodGroup" :items="BLOOD" label="Blood group" clearable />
          </v-col>
          <v-col cols="6">
            <v-text-field v-model="form.personalEmail" label="Personal email" />
          </v-col>
          <v-col cols="6">
            <v-text-field v-model="form.personalPhone" label="Personal phone" />
          </v-col>
        </v-row>
        <div class="d-flex align-center mt-2">
          <span class="text-subtitle-2">Addresses</span>
          <v-spacer />
          <v-btn size="small" variant="text" prepend-icon="mdi-plus" @click="addAddress">Add</v-btn>
        </div>
        <v-row v-for="(a, i) in form.addresses" :key="`a${i}`" dense>
          <v-col cols="3">
            <v-select
              v-model="a.type"
              :items="['CURRENT', 'PERMANENT', 'OTHER']"
              label="Type"
              density="compact"
            />
          </v-col>
          <v-col cols="4"
            ><v-text-field v-model="a.line1" label="Line 1" density="compact"
          /></v-col>
          <v-col cols="2"><v-text-field v-model="a.city" label="City" density="compact" /></v-col>
          <v-col cols="2">
            <v-text-field v-model="a.country" label="Country" density="compact" />
          </v-col>
          <v-col cols="1">
            <v-btn
              icon="mdi-delete"
              variant="text"
              size="small"
              @click="form.addresses.splice(i, 1)"
            />
          </v-col>
        </v-row>
        <div class="d-flex align-center mt-2">
          <span class="text-subtitle-2">Emergency contacts</span>
          <v-spacer />
          <v-btn size="small" variant="text" prepend-icon="mdi-plus" @click="addContact">Add</v-btn>
        </div>
        <v-row v-for="(c, i) in form.emergencyContacts" :key="`c${i}`" dense>
          <v-col cols="4"><v-text-field v-model="c.name" label="Name" density="compact" /></v-col>
          <v-col cols="3">
            <v-text-field v-model="c.relation" label="Relation" density="compact" />
          </v-col>
          <v-col cols="4"><v-text-field v-model="c.phone" label="Phone" density="compact" /></v-col>
          <v-col cols="1">
            <v-btn
              icon="mdi-delete"
              variant="text"
              size="small"
              @click="form.emergencyContacts.splice(i, 1)"
            />
          </v-col>
        </v-row>
        <v-textarea v-model="form.reason" label="Reason" rows="2" class="mt-2" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="form.open = false">Cancel</v-btn>
        <v-btn color="primary" @click="submit">Submit</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

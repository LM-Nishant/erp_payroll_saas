<script setup lang="ts">
import type { MyHostelDto } from '@erp/shared';
import { HOSTEL_COMPLAINT_CATEGORIES, OUTPASS_TYPES } from '@erp/shared';
import { onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const items = ref<MyHostelDto[]>([]);
const error = ref<string | null>(null);
const loading = ref(true);
const outpass = reactive({
  open: false,
  studentId: '',
  passType: 'OUTING',
  fromAt: '',
  toAt: '',
  destination: '',
  reason: '',
});
const complaint = reactive({
  open: false,
  studentId: '',
  category: 'MAINTENANCE',
  title: '',
  description: '',
});

async function load() {
  try {
    items.value = (await apiFetch<{ data: MyHostelDto[] }>('/api/v1/hostel/me')).data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function run(fn: () => Promise<unknown>) {
  error.value = null;
  try {
    await fn();
    await load();
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    return false;
  }
}
function openOutpass(studentId: string) {
  Object.assign(outpass, {
    open: true,
    studentId,
    fromAt: '',
    toAt: '',
    destination: '',
    reason: '',
  });
}
async function applyOutpass() {
  const ok = await run(() =>
    apiFetch('/api/v1/hostel/me/outpasses', {
      method: 'POST',
      body: JSON.stringify({
        studentId: outpass.studentId,
        passType: outpass.passType,
        fromAt: new Date(outpass.fromAt).toISOString(),
        toAt: new Date(outpass.toAt).toISOString(),
        destination: outpass.destination || null,
        reason: outpass.reason,
      }),
    }),
  );
  if (ok) outpass.open = false;
}
async function cancelOutpass(id: string) {
  await run(() => apiFetch(`/api/v1/hostel/me/outpasses/${id}/cancel`, { method: 'POST' }));
}
function openComplaint(studentId: string) {
  Object.assign(complaint, { open: true, studentId, title: '', description: '' });
}
async function raiseComplaint() {
  const ok = await run(() =>
    apiFetch('/api/v1/hostel/me/complaints', {
      method: 'POST',
      body: JSON.stringify({
        studentId: complaint.studentId,
        category: complaint.category,
        title: complaint.title,
        description: complaint.description || null,
      }),
    }),
  );
  if (ok) complaint.open = false;
}
const fmt = (v: string) => new Date(v).toLocaleString();
onMounted(load);
</script>

<template>
  <h2 class="text-h5 mb-4">My hostel</h2>
  <v-progress-linear v-if="loading" indeterminate />
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <v-alert v-if="!loading && !items.length && !error" type="info">No hostel details found.</v-alert>
  <v-card v-for="h in items" :key="h.studentId" class="mb-6">
    <v-card-title>{{ h.studentName }}</v-card-title>
    <v-card-text v-if="!h.allocation">Not allocated to a hostel room.</v-card-text>
    <template v-else>
      <v-card-subtitle>
        {{ h.hostel?.name }} ({{ h.hostel?.hostelType }}) · Room {{ h.allocation.room.roomNo }} ·
        Bed {{ h.allocation.bed.bedNo }}
      </v-card-subtitle>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <div>Warden: {{ h.hostel?.wardenName ?? '—' }} · {{ h.hostel?.phone ?? '' }}</div>
            <div>Since {{ h.allocation.fromDate }} · Rent ₹{{ h.allocation.monthlyRent }}/mo</div>
            <div v-if="h.allocation.messPlan">
              Mess: {{ h.allocation.messPlan.name }} (₹{{ h.allocation.messPlan.monthlyFee }})
            </div>
          </v-col>
          <v-col cols="12" md="6">
            <div class="text-subtitle-2">Roommates</div>
            <div v-for="r in h.roommates" :key="r.bedNo">{{ r.name }} (bed {{ r.bedNo }})</div>
            <div v-if="!h.roommates.length">None</div>
          </v-col>
        </v-row>

        <div class="d-flex align-center mt-4">
          <div class="text-subtitle-1">Out-passes</div>
          <v-spacer />
          <v-btn
            v-if="auth.can('hostel.apply_own')"
            size="small"
            color="primary"
            prepend-icon="mdi-exit-run"
            @click="openOutpass(h.studentId)"
            >Apply</v-btn
          >
        </div>
        <v-table density="compact">
          <tbody>
            <tr v-for="o in h.outpasses" :key="o.id">
              <td>{{ o.passType }}</td>
              <td>{{ fmt(o.fromAt) }} → {{ fmt(o.toAt) }}</td>
              <td>{{ o.reason }}</td>
              <td>
                <v-chip size="small">{{ o.status }}</v-chip>
              </td>
              <td>
                <v-btn
                  v-if="['PENDING', 'APPROVED'].includes(o.status) && auth.can('hostel.apply_own')"
                  size="x-small"
                  variant="text"
                  color="warning"
                  title="Withdraw your request before you leave"
                  @click="cancelOutpass(o.id)"
                  >Withdraw</v-btn
                >
              </td>
            </tr>
            <tr v-if="!h.outpasses.length">
              <td>No out-passes.</td>
            </tr>
          </tbody>
        </v-table>

        <div class="d-flex align-center mt-4">
          <div class="text-subtitle-1">Complaints</div>
          <v-spacer />
          <v-btn
            v-if="auth.can('hostel.apply_own')"
            size="small"
            variant="tonal"
            prepend-icon="mdi-tools"
            @click="openComplaint(h.studentId)"
            >Raise</v-btn
          >
        </div>
        <v-table density="compact">
          <tbody>
            <tr v-for="c in h.complaints" :key="c.id">
              <td>{{ c.category }}</td>
              <td>{{ c.title }}</td>
              <td>
                <v-chip size="small">{{ c.status }}</v-chip>
              </td>
              <td>{{ c.resolution ?? '' }}</td>
            </tr>
            <tr v-if="!h.complaints.length">
              <td>No complaints.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </template>
  </v-card>

  <v-dialog v-model="outpass.open" max-width="560">
    <v-card title="Apply for out-pass">
      <v-card-text>
        <v-select v-model="outpass.passType" :items="[...OUTPASS_TYPES] as string[]" label="Type" />
        <v-text-field v-model="outpass.fromAt" type="datetime-local" label="From" />
        <v-text-field v-model="outpass.toAt" type="datetime-local" label="To" />
        <v-text-field v-model="outpass.destination" label="Destination" />
        <v-textarea v-model="outpass.reason" label="Reason" rows="2" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="outpass.open = false">Cancel</v-btn>
        <v-btn color="primary" @click="applyOutpass">Submit</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog v-model="complaint.open" max-width="560">
    <v-card title="Raise a complaint">
      <v-card-text>
        <v-select
          v-model="complaint.category"
          :items="[...HOSTEL_COMPLAINT_CATEGORIES] as string[]"
          label="Category"
        />
        <v-text-field v-model="complaint.title" label="Title" />
        <v-textarea v-model="complaint.description" label="Details" rows="3" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="complaint.open = false">Cancel</v-btn>
        <v-btn color="primary" @click="raiseComplaint">Submit</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

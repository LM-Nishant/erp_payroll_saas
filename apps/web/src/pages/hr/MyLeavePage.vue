<script setup lang="ts">
import type { LeaveBalanceDto, LeavePreviewDto, LeaveRequestDto, LeaveTypeDto } from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { REQUEST_COLORS } from './timeOffice';
import { label } from './useHrOptions';

/** Employee self-service: leave balances, apply (with live day preview) and own requests. */
const auth = useAuthStore();
const balances = ref<LeaveBalanceDto[]>([]);
const requests = ref<LeaveRequestDto[]>([]);
const types = ref<LeaveTypeDto[]>([]);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const run = async (fn: () => Promise<void>) => {
  error.value = null;
  try {
    await fn();
  } catch (e) {
    error.value = (e as Error).message;
  }
};

async function load() {
  await run(async () => {
    [balances.value, requests.value, types.value] = await Promise.all([
      apiFetch<{ data: LeaveBalanceDto[] }>('/api/v1/leave/me/balances').then((r) => r.data),
      apiFetch<{ data: LeaveRequestDto[] }>('/api/v1/leave/me/requests').then((r) => r.data),
      apiFetch<{ data: LeaveTypeDto[] }>('/api/v1/leave/types').then((r) => r.data),
    ]);
  });
}
onMounted(load);

const form = reactive({
  open: false,
  leaveTypeId: null as string | null,
  fromDate: '',
  toDate: '',
  startHalf: false,
  endHalf: false,
  reason: '',
});
const preview = ref<LeavePreviewDto | null>(null);
const previewError = ref<string | null>(null);
watch(
  () => [form.leaveTypeId, form.fromDate, form.toDate, form.startHalf, form.endHalf],
  async () => {
    preview.value = null;
    previewError.value = null;
    if (!form.leaveTypeId || !form.fromDate || !form.toDate || form.fromDate > form.toDate) return;
    try {
      preview.value = (
        await apiFetch<{ data: LeavePreviewDto }>('/api/v1/leave/preview', {
          method: 'POST',
          body: JSON.stringify({
            leaveTypeId: form.leaveTypeId,
            fromDate: form.fromDate,
            toDate: form.toDate,
            startHalf: form.startHalf,
            endHalf: form.endHalf,
          }),
        })
      ).data;
    } catch (e) {
      previewError.value = (e as Error).message;
    }
  },
);
function openApply() {
  Object.assign(form, {
    open: true,
    leaveTypeId: null,
    fromDate: '',
    toDate: '',
    startHalf: false,
    endHalf: false,
    reason: '',
  });
}
async function submit() {
  await run(async () => {
    await apiFetch('/api/v1/leave/me/requests', {
      method: 'POST',
      body: JSON.stringify({
        leaveTypeId: form.leaveTypeId,
        fromDate: form.fromDate,
        toDate: form.toDate,
        startHalf: form.startHalf,
        endHalf: form.endHalf,
        reason: form.reason.trim(),
      }),
    });
    form.open = false;
    notice.value = 'Leave request submitted';
    await load();
  });
}

const cancel = reactive({ open: false, id: '', reason: '' });
async function saveCancel() {
  await run(async () => {
    await apiFetch(`/api/v1/leave/requests/${cancel.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: cancel.reason.trim() }),
    });
    cancel.open = false;
    await load();
  });
}
const today = new Date().toISOString().slice(0, 10);
const cancellable = (r: LeaveRequestDto) =>
  r.status === 'PENDING_APPROVAL' || (r.status === 'APPROVED' && r.fromDate > today);
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">My leave</h2>
    <v-spacer />
    <v-btn
      v-if="auth.can('leave.apply_own')"
      color="primary"
      prepend-icon="mdi-plus"
      @click="openApply"
    >
      Apply leave
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-alert v-if="notice" type="success" closable class="mb-4" @click:close="notice = null">
    {{ notice }}
  </v-alert>

  <v-row>
    <v-col v-for="b in balances" :key="b.leaveTypeId" cols="12" sm="6" md="3">
      <v-card variant="outlined">
        <v-card-title class="text-subtitle-1">{{ b.name }}</v-card-title>
        <v-card-text>
          <div class="text-h4">{{ b.isPaid ? b.available : '—' }}</div>
          <div class="text-caption">
            <template v-if="b.isPaid">
              available · {{ b.balance }} balance · {{ b.pending }} pending
            </template>
            <template v-else>Unpaid — {{ -b.consumed || 0 }} taken</template>
          </div>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>

  <h3 class="text-h6 mt-8 mb-2">My requests</h3>
  <v-table density="compact">
    <thead>
      <tr>
        <th>Type</th>
        <th>From</th>
        <th>To</th>
        <th>Days</th>
        <th>Status</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="r in requests" :key="r.id">
        <td>{{ r.leaveTypeCode ?? r.leaveTypeId }}</td>
        <td>{{ r.fromDate }}{{ r.startHalf ? ' (2nd half)' : '' }}</td>
        <td>{{ r.toDate }}{{ r.endHalf ? ' (1st half)' : '' }}</td>
        <td>{{ r.days }}</td>
        <td>
          <v-chip :color="REQUEST_COLORS[r.status]" size="small">{{ label(r.status) }}</v-chip>
        </td>
        <td class="text-right">
          <v-btn
            v-if="cancellable(r)"
            size="small"
            variant="text"
            @click="Object.assign(cancel, { open: true, id: r.id, reason: '' })"
          >
            {{ r.status === 'PENDING_APPROVAL' ? 'Withdraw' : 'Cancel' }}
          </v-btn>
        </td>
      </tr>
      <tr v-if="!requests.length">
        <td colspan="6" class="text-medium-emphasis">No leave requests.</td>
      </tr>
    </tbody>
  </v-table>

  <v-dialog v-model="form.open" max-width="560">
    <v-card title="Apply leave">
      <v-card-text>
        <v-select
          v-model="form.leaveTypeId"
          :items="types"
          item-title="name"
          item-value="id"
          label="Leave type *"
        />
        <v-row dense>
          <v-col cols="6"
            ><v-text-field v-model="form.fromDate" type="date" label="From *"
          /></v-col>
          <v-col cols="6"><v-text-field v-model="form.toDate" type="date" label="To *" /></v-col>
        </v-row>
        <v-checkbox v-model="form.startHalf" label="Start from second half" hide-details />
        <v-checkbox v-model="form.endHalf" label="End after first half" hide-details />
        <v-alert v-if="previewError" type="warning" variant="tonal" density="compact" class="my-2">
          {{ previewError }}
        </v-alert>
        <v-alert v-if="preview" type="info" variant="tonal" density="compact" class="my-2">
          <strong>{{ preview.days }}</strong> day(s) will be counted
          <template v-if="preview.balance?.isPaid">
            (available {{ preview.balance.available }})
          </template>
          <div class="text-caption">
            <span v-for="d in preview.breakdown.filter((x) => x.kind !== 'WORKING')" :key="d.date">
              {{ d.date }} {{ label(d.kind) }}{{ d.sandwiched ? ' (sandwiched)' : '' }};
            </span>
          </div>
          <div v-if="preview.requiresDocument" class="text-caption">
            A supporting document is required for this leave.
          </div>
          <ul v-if="preview.rules?.hints.length" class="text-caption mt-1 pl-4">
            <li v-for="h in preview.rules.hints" :key="h">{{ h }}</li>
          </ul>
        </v-alert>
        <v-alert
          v-if="preview?.violations.length"
          type="error"
          variant="tonal"
          density="compact"
          class="my-2"
          title="This request breaks the leave policy"
        >
          <ul class="pl-4">
            <li v-for="v in preview.violations" :key="v.code">{{ v.message }}</li>
          </ul>
        </v-alert>
        <v-textarea v-model="form.reason" label="Reason *" rows="2" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="form.open = false">Close</v-btn>
        <v-btn
          color="primary"
          :disabled="!preview || !!preview.violations.length || form.reason.trim().length < 3"
          @click="submit"
        >
          Submit
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="cancel.open" max-width="480">
    <v-card title="Cancel leave request">
      <v-card-text>
        <v-textarea v-model="cancel.reason" label="Reason *" rows="2" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="cancel.open = false">Close</v-btn>
        <v-btn color="error" :disabled="cancel.reason.trim().length < 3" @click="saveCancel">
          Confirm
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

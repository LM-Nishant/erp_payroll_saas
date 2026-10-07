<script setup lang="ts">
import {
  LEAVE_REQUEST_STATUSES,
  type ApiListResponse,
  type LeaveBalanceDto,
  type LeaveLedgerEntryDto,
  type LeaveRequestDto,
  type LeaveTypeDto,
} from '@erp/shared';
import { onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import EmployeePicker from '@/components/EmployeePicker.vue';
import { useAuthStore } from '@/stores/auth';
import { REQUEST_COLORS } from './timeOffice';
import { label, todayIso } from './useHrOptions';

/** Leave requests register, balances / ledger lookup, adjustments and apply-on-behalf (HR). */
const auth = useAuthStore();
const tab = ref('requests');
const types = ref<LeaveTypeDto[]>([]);
const error = ref<string | null>(null);
const run = async (fn: () => Promise<void>) => {
  error.value = null;
  try {
    await fn();
  } catch (e) {
    error.value = (e as Error).message;
  }
};
const typeCode = (id: string) => types.value.find((t) => t.id === id)?.code ?? id;

// Requests
const status = ref<string | null>('PENDING_APPROVAL');
const requests = ref<LeaveRequestDto[]>([]);
const loading = ref(false);
async function loadRequests() {
  loading.value = true;
  await run(async () => {
    const q = status.value ? `&status=${status.value}` : '';
    requests.value = (
      await apiFetch<ApiListResponse<LeaveRequestDto>>(`/api/v1/leave/requests?pageSize=100${q}`)
    ).data;
  });
  loading.value = false;
}
const cancel = reactive({ open: false, id: '', reason: '' });
async function saveCancel() {
  await run(async () => {
    await apiFetch(`/api/v1/leave/requests/${cancel.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: cancel.reason.trim() }),
    });
    cancel.open = false;
    await loadRequests();
  });
}

// Apply on behalf
const apply = reactive({
  open: false,
  employeeId: null as string | null,
  leaveTypeId: null as string | null,
  fromDate: '',
  toDate: '',
  startHalf: false,
  endHalf: false,
  reason: '',
  ruleOverrideReason: '',
});
async function saveApply() {
  await run(async () => {
    await apiFetch('/api/v1/leave/requests', {
      method: 'POST',
      body: JSON.stringify({
        ...apply,
        open: undefined,
        reason: apply.reason.trim(),
        ruleOverrideReason: apply.ruleOverrideReason.trim() || null,
      }),
    });
    apply.open = false;
    apply.ruleOverrideReason = '';
    await loadRequests();
  });
}

// Balances
const employeeId = ref<string | null>(null);
const asOf = ref(todayIso());
const balances = ref<LeaveBalanceDto[]>([]);
const ledger = ref<LeaveLedgerEntryDto[]>([]);
async function loadBalances() {
  if (!employeeId.value) return;
  await run(async () => {
    [balances.value, ledger.value] = await Promise.all([
      apiFetch<{ data: LeaveBalanceDto[] }>(
        `/api/v1/leave/balances?employeeId=${employeeId.value}&asOf=${asOf.value}`,
      ).then((r) => r.data),
      apiFetch<ApiListResponse<LeaveLedgerEntryDto>>(
        `/api/v1/leave/ledger?employeeId=${employeeId.value}&pageSize=100`,
      ).then((r) => r.data),
    ]);
  });
}
const adjust = reactive({
  open: false,
  leaveTypeId: null as string | null,
  entryType: 'ADJUSTMENT' as 'ADJUSTMENT' | 'ENCASHMENT',
  days: 1,
  effectiveDate: todayIso(),
  reason: '',
});
async function saveAdjust() {
  await run(async () => {
    await apiFetch('/api/v1/leave/adjustments', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: employeeId.value,
        leaveTypeId: adjust.leaveTypeId,
        entryType: adjust.entryType,
        days: Number(adjust.days),
        effectiveDate: adjust.effectiveDate,
        reason: adjust.reason.trim(),
      }),
    });
    adjust.open = false;
    await loadBalances();
  });
}

onMounted(async () => {
  await run(async () => {
    types.value = (await apiFetch<{ data: LeaveTypeDto[] }>('/api/v1/leave/types')).data;
  });
  await loadRequests();
});

const requestHeaders = [
  { title: 'Employee', key: 'employee', sortable: false },
  { title: 'Type', key: 'leaveTypeId' },
  { title: 'From', key: 'fromDate' },
  { title: 'To', key: 'toDate' },
  { title: 'Days', key: 'days' },
  { title: 'Reason', key: 'reason', sortable: false },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
const statuses = LEAVE_REQUEST_STATUSES.map((value) => ({ value, title: label(value) }));
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Leave</h2>
    <v-spacer />
    <v-btn
      v-if="auth.can('leave.apply')"
      color="primary"
      prepend-icon="mdi-plus"
      @click="apply.open = true"
    >
      Apply on behalf
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-tabs v-model="tab" class="mb-4">
    <v-tab value="requests">Requests</v-tab>
    <v-tab value="balances">Balances &amp; ledger</v-tab>
  </v-tabs>

  <template v-if="tab === 'requests'">
    <v-select
      v-model="status"
      :items="statuses"
      label="Status"
      density="compact"
      clearable
      style="max-width: 240px"
      @update:model-value="loadRequests"
    />
    <v-data-table :items="requests" :headers="requestHeaders" :loading="loading" density="compact">
      <template #[`item.employee`]="{ item }">
        {{ item.employeeCode }} {{ item.employeeName }}
      </template>
      <template #[`item.leaveTypeId`]="{ item }">
        {{ item.leaveTypeCode ?? typeCode(item.leaveTypeId) }}
      </template>
      <template #[`item.status`]="{ item }">
        <v-chip :color="REQUEST_COLORS[item.status]" size="small">{{ label(item.status) }}</v-chip>
      </template>
      <template #[`item.actions`]="{ item }">
        <v-btn
          v-if="
            auth.can('leave.apply') &&
            (item.status === 'APPROVED' || item.status === 'PENDING_APPROVAL')
          "
          size="small"
          variant="text"
          @click="Object.assign(cancel, { open: true, id: item.id, reason: '' })"
        >
          Cancel
        </v-btn>
      </template>
    </v-data-table>
  </template>

  <template v-else>
    <div class="d-flex ga-2 align-center mb-4">
      <EmployeePicker
        v-model="employeeId"
        density="compact"
        hide-details
        style="min-width: 280px"
      />
      <v-text-field
        v-model="asOf"
        type="date"
        label="As of"
        density="compact"
        hide-details
        style="max-width: 180px"
      />
      <v-btn :disabled="!employeeId" variant="tonal" @click="loadBalances">Show</v-btn>
      <v-btn
        v-if="auth.can('leave.adjust')"
        :disabled="!employeeId"
        variant="tonal"
        @click="adjust.open = true"
      >
        Adjust
      </v-btn>
    </div>
    <v-table density="compact">
      <thead>
        <tr>
          <th>Type</th>
          <th>Accrued</th>
          <th>Consumed</th>
          <th>Balance</th>
          <th>Pending</th>
          <th>Available</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="b in balances" :key="b.leaveTypeId">
          <td>{{ b.code }} — {{ b.name }}</td>
          <td>{{ b.accrued }}</td>
          <td>{{ b.consumed }}</td>
          <td>{{ b.balance }}</td>
          <td>{{ b.pending }}</td>
          <td>
            <strong>{{ b.available }}</strong>
          </td>
        </tr>
      </tbody>
    </v-table>
    <h3 class="text-h6 mt-6 mb-2">Ledger</h3>
    <v-table density="compact">
      <tbody>
        <tr v-for="e in ledger" :key="e.id">
          <td>{{ e.effectiveDate }}</td>
          <td>{{ typeCode(e.leaveTypeId) }}</td>
          <td>{{ label(e.entryType) }}</td>
          <td :class="e.days < 0 ? 'text-error' : 'text-success'">{{ e.days }}</td>
          <td>{{ e.reason }}</td>
        </tr>
      </tbody>
    </v-table>
  </template>

  <v-dialog v-model="cancel.open" max-width="480">
    <v-card title="Cancel leave">
      <v-card-text>
        <p class="text-body-2 mb-2">Consumed days are credited back to the balance.</p>
        <v-textarea v-model="cancel.reason" label="Reason *" rows="2" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="cancel.open = false">Close</v-btn>
        <v-btn color="error" :disabled="cancel.reason.trim().length < 3" @click="saveCancel">
          Cancel leave
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="apply.open" max-width="520">
    <v-card title="Apply leave on behalf">
      <v-card-text>
        <EmployeePicker v-model="apply.employeeId" label="Employee *" />
        <v-select
          v-model="apply.leaveTypeId"
          :items="types"
          item-title="name"
          item-value="id"
          label="Leave type *"
        />
        <v-text-field v-model="apply.fromDate" type="date" label="From *" />
        <v-text-field v-model="apply.toDate" type="date" label="To *" />
        <v-checkbox v-model="apply.startHalf" label="Start from second half" hide-details />
        <v-checkbox v-model="apply.endHalf" label="End after first half" hide-details />
        <v-textarea v-model="apply.reason" label="Reason *" rows="2" />
        <v-text-field
          v-if="auth.can('leave.manage')"
          v-model="apply.ruleOverrideReason"
          label="Override policy rules — reason (only if notice / limit rules block the request)"
          hint="Recorded in the audit log"
          persistent-hint
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="apply.open = false">Close</v-btn>
        <v-btn
          color="primary"
          :disabled="!apply.employeeId || !apply.leaveTypeId || !apply.fromDate || !apply.toDate"
          @click="saveApply"
        >
          Apply
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="adjust.open" max-width="480">
    <v-card title="Adjust balance">
      <v-card-text>
        <v-select
          v-model="adjust.leaveTypeId"
          :items="types"
          item-title="name"
          item-value="id"
          label="Leave type *"
        />
        <v-btn-toggle v-model="adjust.entryType" mandatory density="compact" class="mb-4">
          <v-btn value="ADJUSTMENT">Adjustment</v-btn>
          <v-btn value="ENCASHMENT">Encashment</v-btn>
        </v-btn-toggle>
        <v-text-field
          v-model.number="adjust.days"
          type="number"
          step="0.5"
          :label="adjust.entryType === 'ADJUSTMENT' ? 'Days (±)' : 'Days to encash'"
        />
        <v-text-field v-model="adjust.effectiveDate" type="date" label="Effective date" />
        <v-textarea v-model="adjust.reason" label="Reason *" rows="2" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="adjust.open = false">Close</v-btn>
        <v-btn
          color="primary"
          :disabled="!adjust.leaveTypeId || adjust.reason.trim().length < 3"
          @click="saveAdjust"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

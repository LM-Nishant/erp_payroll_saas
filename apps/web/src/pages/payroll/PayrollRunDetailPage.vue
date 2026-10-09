<script setup lang="ts">
import {
  STATUTORY_PACKS,
  type ApiListResponse,
  type PayrollAdjustmentDto,
  type PayrollPaymentDto,
  type PayrollRunDto,
  type PayrollRunEmployeeDto,
  type PayslipDto,
} from '@erp/shared';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { apiDownload, apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { label } from '@/pages/hr/useHrOptions';
import { RUN_STATUS_COLORS, money, openSignedUrl } from './payroll';

/**
 * Payroll run wizard: compute → review (per-employee drill-down with calc trace) → adjustments →
 * submit → approve → finalize (locked) → payments / payslips / reports; reopen is audited.
 */
const props = defineProps<{ id: string }>();
const auth = useAuthStore();
const router = useRouter();
const run = ref<PayrollRunDto | null>(null);
const employees = ref<PayrollRunEmployeeDto[]>([]);
const empTotal = ref(0);
const empPage = ref(1);
const adjustments = ref<PayrollAdjustmentDto[]>([]);
const payments = ref<PayrollPaymentDto[]>([]);
const payslips = ref<PayslipDto[]>([]);
const tab = ref('employees');
const error = ref<string | null>(null);
const busy = ref(false);
const base = computed(() => `/api/v1/payroll/runs/${props.id}`);

async function loadRun() {
  run.value = (await apiFetch<{ data: PayrollRunDto }>(base.value)).data;
}
async function loadTab() {
  try {
    if (tab.value === 'employees') {
      const res = await apiFetch<ApiListResponse<PayrollRunEmployeeDto>>(
        `${base.value}/employees?page=${empPage.value}&pageSize=50`,
      );
      employees.value = res.data;
      empTotal.value = res.meta.total;
    } else if (tab.value === 'adjustments') {
      adjustments.value = (
        await apiFetch<{ data: PayrollAdjustmentDto[] }>(`${base.value}/adjustments`)
      ).data;
    } else if (tab.value === 'payments') {
      payments.value = (
        await apiFetch<{ data: PayrollPaymentDto[] }>(`${base.value}/payments`)
      ).data;
    } else if (tab.value === 'payslips') {
      payslips.value = (
        await apiFetch<ApiListResponse<PayslipDto>>(
          `/api/v1/payroll/payslips?runId=${props.id}&pageSize=100`,
        )
      ).data;
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function reload() {
  try {
    await loadRun();
    await loadTab();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(reload);
watch([tab, empPage], loadTab);
watch(() => props.id, reload);

// Compute runs in background batches: poll until the run leaves COMPUTING.
let pollTimer: ReturnType<typeof setTimeout> | undefined;
watch(run, (r) => {
  clearTimeout(pollTimer);
  if (r?.status === 'COMPUTING') pollTimer = setTimeout(reload, 2000);
});
onBeforeUnmount(() => clearTimeout(pollTimer));

const status = computed(() => run.value?.status);
const editable = computed(() => ['DRAFT', 'COMPUTED', 'REOPENED'].includes(status.value ?? ''));
const step = computed(() => {
  switch (status.value) {
    case 'DRAFT':
    case 'REOPENED':
      return 1;
    case 'COMPUTING':
    case 'COMPUTED':
      return 2;
    case 'PENDING_APPROVAL':
      return 3;
    case 'APPROVED':
      return 4;
    case 'FINALIZED':
      return 5;
    default:
      return 1;
  }
});

async function act(path: string, body: unknown = {}, after?: (r: PayrollRunDto) => unknown) {
  busy.value = true;
  error.value = null;
  try {
    const res = await apiFetch<{ data: PayrollRunDto }>(`${base.value}/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (after) await after(res.data);
    await reload();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

const reopen = reactive({ open: false, reason: '' });
async function doReopen() {
  await act('reopen', { reason: reopen.reason.trim() }, (r) => {
    reopen.open = false;
    if (r.id !== props.id) return router.push(`/hr/payroll/runs/${r.id}`);
  });
}

// Per-employee drill-down with the calculation trace.
const detail = ref<PayrollRunEmployeeDto | null>(null);
function onEmployeeRow(_e: unknown, row: { item: PayrollRunEmployeeDto }) {
  void openDetail(row.item);
}
async function openDetail(e: PayrollRunEmployeeDto) {
  try {
    detail.value = (
      await apiFetch<{ data: PayrollRunEmployeeDto }>(`${base.value}/employees/${e.employeeId}`)
    ).data;
  } catch (err) {
    error.value = (err as Error).message;
  }
}

const adj = reactive({
  open: false,
  employeeId: null as string | null,
  type: 'EARNING',
  code: '',
  amount: null as number | null,
  taxable: true,
  description: '',
});
async function addAdjustment() {
  try {
    await apiFetch(`${base.value}/adjustments`, {
      method: 'POST',
      body: JSON.stringify({
        employeeId: adj.employeeId,
        type: adj.type,
        ...(adj.code.trim() ? { code: adj.code.trim() } : {}),
        amount: Number(adj.amount),
        taxable: adj.taxable,
        description: adj.description.trim(),
      }),
    });
    adj.open = false;
    await loadTab();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function cancelAdjustment(a: PayrollAdjustmentDto) {
  try {
    await apiFetch(`/api/v1/payroll/adjustments/${a.id}/cancel`, { method: 'POST', body: '{}' });
    await loadTab();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const paidRef = ref('');
async function markPaid() {
  try {
    await apiFetch(`${base.value}/payments/mark-paid`, {
      method: 'POST',
      body: JSON.stringify({ reference: paidRef.value.trim() }),
    });
    paidRef.value = '';
    await loadTab();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function download(path: string, fileName: string) {
  try {
    await apiDownload(path, fileName);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const formats = ['csv', 'xlsx', 'pdf'] as const;
const reports = computed(() => [
  {
    key: 'register',
    title: 'Payroll register',
    path: `/api/v1/payroll/reports/runs/${props.id}/register`,
  },
  {
    key: 'components',
    title: 'Component summary',
    path: `/api/v1/payroll/reports/runs/${props.id}/components`,
  },
  ...STATUTORY_PACKS.map((pack) => ({
    key: `statutory-${pack}`,
    title: `${pack} statutory summary`,
    path: `/api/v1/payroll/reports/statutory?runId=${props.id}&pack=${pack}`,
  })),
]);
const withFormat = (path: string, f: string) =>
  `${path}${path.includes('?') ? '&' : '?'}format=${f}`;

async function slipDownload(p: PayslipDto) {
  try {
    await openSignedUrl(`/api/v1/payroll/payslips/${p.id}/download-url`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const empHeaders = [
  { title: 'Code', key: 'employeeCode' },
  { title: 'Name', key: 'employeeName' },
  { title: 'Status', key: 'status' },
  { title: 'Payable / days', key: 'days', sortable: false },
  { title: 'LOP', key: 'lopDays' },
  { title: 'Gross', key: 'gross', align: 'end' as const },
  { title: 'Deductions', key: 'deductions', align: 'end' as const },
  { title: 'Net', key: 'net', align: 'end' as const },
];
</script>

<template>
  <div v-if="run">
    <div class="d-flex align-center mb-2 ga-2 flex-wrap">
      <v-btn icon="mdi-arrow-left" variant="text" to="/hr/payroll/runs" />
      <h2 class="text-h5">{{ run.label }}</h2>
      <v-chip :color="RUN_STATUS_COLORS[run.status]">{{ label(run.status) }}</v-chip>
      <v-chip v-if="run.revision > 1" size="small">Revision {{ run.revision }}</v-chip>
      <v-chip
        v-if="run.status === 'FINALIZED'"
        size="small"
        prepend-icon="mdi-lock"
        color="success"
      >
        Locked
      </v-chip>
      <v-spacer />
      <v-btn
        v-if="editable && auth.can('payroll.process')"
        :loading="busy"
        color="primary"
        variant="tonal"
        @click="act('compute')"
      >
        {{ status === 'COMPUTED' ? 'Recompute' : 'Compute' }}
      </v-btn>
      <v-btn
        v-if="status === 'COMPUTED' && auth.can('payroll.process')"
        :loading="busy"
        color="primary"
        @click="act('submit')"
      >
        Submit for approval
      </v-btn>
      <template v-if="status === 'PENDING_APPROVAL' && auth.can('payroll.approve')">
        <v-btn v-if="run.workflowInstanceId" variant="tonal" to="/hr/approvals">
          Open in approvals
        </v-btn>
        <template v-else>
          <v-btn color="success" :loading="busy" @click="act('decision', { approved: true })">
            Approve
          </v-btn>
          <v-btn color="error" variant="tonal" @click="act('decision', { approved: false })">
            Reject
          </v-btn>
        </template>
      </template>
      <v-btn
        v-if="status === 'APPROVED' && auth.can('payroll.lock')"
        color="success"
        :loading="busy"
        @click="act('finalize')"
      >
        Finalize &amp; lock
      </v-btn>
      <v-btn
        v-if="status === 'FINALIZED' && auth.can('payroll.reopen')"
        color="warning"
        variant="tonal"
        @click="reopen.open = true"
      >
        Reopen…
      </v-btn>
      <v-btn
        v-if="editable && auth.can('payroll.process')"
        color="error"
        variant="text"
        @click="act('cancel')"
      >
        Cancel run
      </v-btn>
    </div>

    <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
      {{ error }}
    </v-alert>
    <v-alert v-if="run.reopenReason" type="info" density="compact" class="mb-2">
      Reopened: {{ run.reopenReason }}
    </v-alert>

    <v-stepper :model-value="step" alt-labels flat class="mb-4">
      <v-stepper-header>
        <v-stepper-item :value="1" title="Draft" :complete="step > 1" />
        <v-divider />
        <v-stepper-item :value="2" title="Computed / review" :complete="step > 2" />
        <v-divider />
        <v-stepper-item :value="3" title="Approval" :complete="step > 3" />
        <v-divider />
        <v-stepper-item :value="4" title="Approved" :complete="step > 4" />
        <v-divider />
        <v-stepper-item :value="5" title="Finalized" :complete="step >= 5" />
      </v-stepper-header>
    </v-stepper>

    <v-row class="mb-2" dense>
      <v-col
        v-for="t in [
          ['Period', `${run.periodStart} → ${run.periodEnd}`],
          ['Attendance', run.attendanceLocked ? 'Locked' : 'Not locked'],
          ['Employees', `${run.employeeCount} (${run.errorCount} errors)`],
          ['Gross', money(run.grossTotal)],
          ['Deductions', money(run.deductionTotal)],
          ['Net', money(run.netTotal)],
          ['Employer', money(run.employerTotal)],
        ]"
        :key="t[0]"
        cols="6"
        md="3"
        lg=""
      >
        <v-card variant="tonal" class="pa-2">
          <div class="text-caption">{{ t[0] }}</div>
          <div class="text-subtitle-1">{{ t[1] }}</div>
        </v-card>
      </v-col>
    </v-row>

    <v-tabs v-model="tab" class="mb-2">
      <v-tab value="employees">Employees</v-tab>
      <v-tab value="adjustments">Adjustments</v-tab>
      <v-tab value="payments">Payments</v-tab>
      <v-tab value="payslips">Payslips</v-tab>
      <v-tab v-if="auth.can('payroll.report')" value="reports">Reports</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="employees">
        <v-data-table-server
          v-model:page="empPage"
          :headers="empHeaders"
          :items="employees"
          :items-length="empTotal"
          items-per-page="50"
          hover
          @click:row="onEmployeeRow"
        >
          <template #[`item.status`]="{ item }">
            <v-chip
              size="small"
              :color="
                item.status === 'OK' ? 'success' : item.status === 'ERROR' ? 'error' : 'default'
              "
            >
              {{ item.status }}
            </v-chip>
            <span v-if="item.error" class="text-caption text-error ml-1">{{ item.error }}</span>
          </template>
          <template #[`item.days`]="{ item }">
            {{ item.payableDays }} / {{ item.calendarDays }}
            <span v-if="item.institutionDays !== item.calendarDays" class="text-caption">
              ({{ item.institutionDays }} here)
            </span>
          </template>
          <template #[`item.gross`]="{ item }">{{ money(item.gross) }}</template>
          <template #[`item.deductions`]="{ item }">{{ money(item.deductions) }}</template>
          <template #[`item.net`]="{ item }">{{ money(item.net) }}</template>
        </v-data-table-server>
      </v-window-item>

      <v-window-item value="adjustments">
        <div class="d-flex mb-2">
          <v-spacer />
          <v-btn
            v-if="editable && auth.can('payroll.process')"
            prepend-icon="mdi-plus"
            @click="adj.open = true"
          >
            Add adjustment
          </v-btn>
        </div>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Type</th>
              <th>Code</th>
              <th>Description</th>
              <th>Source</th>
              <th class="text-end">Amount</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in adjustments" :key="a.id">
              <td>
                {{
                  employees.find((e) => e.employeeId === a.employeeId)?.employeeCode ?? a.employeeId
                }}
              </td>
              <td>{{ label(a.type) }}</td>
              <td>{{ a.code }}</td>
              <td>{{ a.description }}</td>
              <td>{{ a.source }}</td>
              <td class="text-end">{{ money(a.amount) }}</td>
              <td>{{ label(a.status) }}</td>
              <td>
                <v-btn
                  v-if="editable && a.status !== 'CANCELLED' && a.source === 'manual'"
                  icon="mdi-close"
                  size="small"
                  variant="text"
                  @click="cancelAdjustment(a)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-window-item>

      <v-window-item value="payments">
        <div v-if="auth.can('payroll.disburse') && status === 'FINALIZED'" class="d-flex ga-2 mb-2">
          <v-btn
            prepend-icon="mdi-bank-transfer"
            variant="tonal"
            @click="download(`${base}/payments/bank-file`, `bank-file-${run.periodStart}.csv`)"
          >
            Bank file (CSV)
          </v-btn>
          <v-text-field
            v-model="paidRef"
            label="Payment reference (UTR)"
            density="compact"
            hide-details
            style="max-width: 260px"
          />
          <v-btn color="primary" :disabled="!paidRef.trim()" @click="markPaid">Mark all paid</v-btn>
        </div>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Account</th>
              <th class="text-end">Amount</th>
              <th>Status</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in payments" :key="p.id">
              <td>{{ p.employeeCode }}</td>
              <td>{{ p.bankAccountMasked ?? '—' }}</td>
              <td class="text-end">{{ money(p.amount) }}</td>
              <td>{{ label(p.status) }}</td>
              <td>{{ p.reference ?? '' }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-window-item>

      <v-window-item value="payslips">
        <div class="d-flex mb-2">
          <v-spacer />
          <v-btn
            v-if="status === 'FINALIZED' && auth.can('payroll.lock')"
            variant="tonal"
            @click="act('payslips/regenerate')"
          >
            Regenerate payslips
          </v-btn>
        </div>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Revision</th>
              <th class="text-end">Net</th>
              <th>Status</th>
              <th>Published</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in payslips" :key="p.id">
              <td>{{ p.employeeCode }} · {{ p.employeeName }}</td>
              <td>{{ p.revision }}</td>
              <td class="text-end">{{ money(p.net) }}</td>
              <td>{{ label(p.status) }}</td>
              <td>{{ p.publishedAt.slice(0, 10) }}</td>
              <td>
                <v-btn icon="mdi-download" size="small" variant="text" @click="slipDownload(p)" />
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-window-item>

      <v-window-item value="reports">
        <v-list density="compact">
          <v-list-item v-for="r in reports" :key="r.key" :title="r.title">
            <template #append>
              <v-btn
                v-for="f in formats"
                :key="f"
                size="small"
                variant="text"
                @click="download(withFormat(r.path, f), `${r.key}-${run.periodStart}.${f}`)"
              >
                {{ f.toUpperCase() }}
              </v-btn>
            </template>
          </v-list-item>
        </v-list>
      </v-window-item>
    </v-window>
  </div>
  <v-alert v-else-if="error" type="error">{{ error }}</v-alert>

  <v-dialog :model-value="!!detail" max-width="960" @update:model-value="detail = null">
    <v-card v-if="detail" :title="`${detail.employeeCode} · ${detail.employeeName}`">
      <v-card-subtitle>
        Payable {{ detail.payableDays }} / {{ detail.calendarDays }} · LOP {{ detail.lopDays }} ·
        Institution days {{ detail.institutionDays }} · factor {{ detail.factor }}
      </v-card-subtitle>
      <v-card-text>
        <v-alert
          v-for="w in detail.warnings"
          :key="w"
          type="warning"
          density="compact"
          class="mb-1"
        >
          {{ w }}
        </v-alert>
        <v-table density="compact" class="mb-4">
          <thead>
            <tr>
              <th>Component</th>
              <th>Category</th>
              <th class="text-end">Full</th>
              <th class="text-end">Amount</th>
              <th>Explanation</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in detail.lines" :key="l.code">
              <td>{{ l.code }} · {{ l.name }}</td>
              <td>{{ label(l.category) }}</td>
              <td class="text-end">{{ money(l.fullAmount) }}</td>
              <td class="text-end">{{ money(l.amount) }}</td>
              <td class="text-caption">{{ l.explanation }}</td>
            </tr>
            <tr>
              <th colspan="3">
                Gross {{ money(detail.gross) }} · Deductions {{ money(detail.deductions) }}
              </th>
              <th class="text-end">Net {{ money(detail.net) }}</th>
              <th>Employer {{ money(detail.employerContributions) }}</th>
            </tr>
          </tbody>
        </v-table>
        <h4 class="text-subtitle-2 mb-1">Calculation trace</h4>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Code</th>
              <th>Source</th>
              <th>Expression</th>
              <th>Inputs</th>
              <th class="text-end">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(t, i) in detail.trace" :key="i">
              <td>{{ t.code }}</td>
              <td>{{ t.source }}</td>
              <td>
                <code class="text-caption">{{ t.expression }}</code>
              </td>
              <td class="text-caption">{{ JSON.stringify(t.inputs) }}</td>
              <td class="text-end">{{ money(t.amount) }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="detail = null">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="adj.open" max-width="520">
    <v-card title="One-time adjustment">
      <v-card-text>
        <v-select
          v-model="adj.employeeId"
          :items="employees"
          :item-title="(e: PayrollRunEmployeeDto) => `${e.employeeCode} · ${e.employeeName}`"
          item-value="employeeId"
          label="Employee"
        />
        <v-select
          v-model="adj.type"
          :items="['EARNING', 'DEDUCTION', 'ARREAR', 'REIMBURSEMENT']"
          label="Type"
        />
        <v-text-field v-model="adj.code" label="Code (optional)" />
        <v-text-field v-model="adj.amount" type="number" label="Amount" />
        <v-text-field v-model="adj.description" label="Description" />
        <v-checkbox v-model="adj.taxable" label="Taxable" density="compact" />
        <v-alert type="info" density="compact">Recompute the run to apply the adjustment.</v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="adj.open = false">Cancel</v-btn>
        <v-btn color="primary" @click="addAdjustment">Add</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="reopen.open" max-width="520">
    <v-card title="Reopen finalized payroll">
      <v-card-text>
        <v-alert type="warning" density="compact" class="mb-2">
          Reopening is audited and creates a new revision; the finalized run stays unchanged.
        </v-alert>
        <v-textarea v-model="reopen.reason" label="Reason (required)" rows="3" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="reopen.open = false">Cancel</v-btn>
        <v-btn color="warning" :disabled="reopen.reason.trim().length < 5" @click="doReopen">
          Reopen
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

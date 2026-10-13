<script setup lang="ts">
/**
 * Date-range KPI dashboard (fees, expenses, payroll, students, employees, hostel, transport).
 * Sections come from `/dashboard/overview` and only appear when the user may view them.
 */
import type { ApiListResponse, DashboardOverviewDto } from '@erp/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { apiFetch, ApiError } from '@/api/client';
import { MENUS, visibleMenu, type LayoutKey } from '@/navigation/menus';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ layout: Exclude<LayoutKey, 'platform'> }>();
const auth = useAuthStore();

type Preset = 'today' | 'yesterday' | 'tomorrow' | 'week' | 'month' | 'lastMonth' | 'custom';
const PRESETS: { value: Preset; title: string }[] = [
  { value: 'today', title: 'Today' },
  { value: 'yesterday', title: 'Yesterday' },
  { value: 'tomorrow', title: 'Tomorrow' },
  { value: 'week', title: 'This week' },
  { value: 'month', title: 'This month' },
  { value: 'lastMonth', title: 'Last month' },
  { value: 'custom', title: 'Custom' },
];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};
function rangeFor(p: Preset): [string, string] {
  const now = new Date();
  switch (p) {
    case 'yesterday':
      return [iso(shift(-1)), iso(shift(-1))];
    case 'tomorrow':
      return [iso(shift(1)), iso(shift(1))];
    case 'week': {
      const monday = shift(-((now.getDay() + 6) % 7));
      return [iso(monday), iso(now)];
    }
    case 'month':
      return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)];
    case 'lastMonth':
      return [
        iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      ];
    default:
      return [iso(now), iso(now)];
  }
}

const preset = ref<Preset>('today');
const from = ref(iso(new Date()));
const to = ref(iso(new Date()));
const institutionId = ref<string | null>(null);
const institutions = ref<{ id: string; name: string }[]>([]);
const data = ref<DashboardOverviewDto | null>(null);
const loading = ref(false);
const error = ref('');

const money = (v: number) =>
  `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const multiDay = computed(() => (data.value?.range.days ?? 1) > 1);
const unit = (who: string) => (multiDay.value ? `${who}-days` : who);
const hasAny = computed(() => {
  const d = data.value;
  return Boolean(
    d &&
    (d.fees || d.expenses || d.payroll || d.students || d.employees || d.hostel || d.transport),
  );
});
const rangeLabel = computed(() =>
  from.value === to.value ? from.value : `${from.value} → ${to.value}`,
);
const maxTrend = computed(() =>
  Math.max(1, ...(data.value?.trend ?? []).flatMap((t) => [t.collected, t.expenses])),
);

/** First visible menu entry whose path ends with `suffix` (current layout first). */
function linkTo(suffix: string): string | undefined {
  const order: Exclude<LayoutKey, 'platform'>[] = [props.layout, 'institution', 'group', 'hr'];
  for (const layout of order) {
    const item = visibleMenu(
      MENUS[layout],
      auth.can,
      auth.hasFeature,
      auth.me?.organization?.kind,
    ).find((i) => i.to.endsWith(suffix));
    if (item) return item.to;
  }
  return undefined;
}

async function load() {
  if (from.value > to.value) {
    error.value = '"From" must be on or before "To".';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const q = new URLSearchParams({ from: from.value, to: to.value });
    if (institutionId.value) q.set('institutionId', institutionId.value);
    data.value = (
      await apiFetch<{ data: DashboardOverviewDto }>(`/api/v1/dashboard/overview?${q}`)
    ).data;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Could not load the dashboard';
  } finally {
    loading.value = false;
  }
}

watch(preset, (p) => {
  if (p === 'custom') return;
  [from.value, to.value] = rangeFor(p);
  void load();
});
watch(institutionId, () => void load());

onMounted(async () => {
  if (auth.can('institution.view')) {
    institutions.value = await apiFetch<ApiListResponse<{ id: string; name: string }>>(
      '/api/v1/institutions?pageSize=100',
    )
      .then((r) => r.data)
      .catch(() => []);
  }
  await load();
});
</script>

<template>
  <v-card v-if="loading || hasAny || error" class="mb-6" data-testid="overview-panel">
    <v-card-title class="d-flex flex-wrap align-center ga-2">
      <v-icon color="primary">mdi-view-dashboard-outline</v-icon>
      <span>Overview</span>
      <span class="text-body-2 text-medium-emphasis">{{ rangeLabel }}</span>
      <v-spacer />
      <v-select
        v-if="institutions.length > 1"
        v-model="institutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Institution"
        placeholder="All institutions"
        clearable
        density="compact"
        hide-details
        max-width="260"
        data-testid="overview-institution"
      />
    </v-card-title>
    <v-card-text>
      <div class="d-flex flex-wrap align-center ga-2 mb-4">
        <v-chip-group
          v-model="preset"
          mandatory
          selected-class="text-primary"
          data-testid="overview-presets"
        >
          <v-chip
            v-for="p in PRESETS"
            :key="p.value"
            :value="p.value"
            filter
            variant="outlined"
            size="small"
          >
            {{ p.title }}
          </v-chip>
        </v-chip-group>
        <template v-if="preset === 'custom'">
          <v-text-field
            v-model="from"
            type="date"
            label="From"
            density="compact"
            hide-details
            max-width="170"
            data-testid="overview-from"
          />
          <v-text-field
            v-model="to"
            type="date"
            label="To"
            density="compact"
            hide-details
            max-width="170"
            data-testid="overview-to"
          />
          <v-btn color="primary" :loading="loading" data-testid="overview-apply" @click="load">
            Apply
          </v-btn>
        </template>
        <v-progress-circular v-if="loading" indeterminate size="20" width="2" />
      </div>

      <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

      <v-row v-if="data" dense>
        <v-col v-if="data.fees" cols="12" sm="6" lg="3">
          <v-card variant="tonal" color="success" height="100%" :to="linkTo('/fees/receipts')">
            <v-card-text data-testid="kpi-fees">
              <div class="text-overline">Fee collection</div>
              <div class="text-h5">{{ money(data.fees.netCollected) }}</div>
              <div class="text-caption">
                {{ data.fees.receipts }} receipts · {{ money(data.fees.collected) }} collected
                <span v-if="data.fees.refunded"> · {{ money(data.fees.refunded) }} refunded</span>
              </div>
              <div class="text-caption">Due in range {{ money(data.fees.dueInRange) }}</div>
              <div class="text-caption">Outstanding {{ money(data.fees.outstanding) }}</div>
              <div v-if="data.fees.upiPending.count" class="text-caption font-weight-bold">
                {{ data.fees.upiPending.count }} UPI payment(s) awaiting verification ({{
                  money(data.fees.upiPending.amount)
                }})
              </div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col v-if="data.expenses" cols="12" sm="6" lg="3">
          <v-card variant="tonal" color="error" height="100%" :to="linkTo('/finance/expenses')">
            <v-card-text data-testid="kpi-expenses">
              <div class="text-overline">Expenses</div>
              <div class="text-h5">{{ money(data.expenses.total) }}</div>
              <div class="text-caption">{{ data.expenses.count }} expense entries</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col v-if="data.payroll" cols="12" sm="6" lg="3">
          <v-card variant="tonal" color="deep-purple" height="100%" :to="linkTo('/payroll/runs')">
            <v-card-text data-testid="kpi-payroll">
              <div class="text-overline">Payroll &amp; payouts</div>
              <div class="text-h5">{{ money(data.payroll.paid) }}</div>
              <div class="text-caption">Salary paid ({{ data.payroll.paidCount }} employees)</div>
              <div class="text-caption">
                Finalized {{ money(data.payroll.finalizedNet) }} ({{ data.payroll.finalizedRuns }}
                run(s))
              </div>
              <div class="text-caption">
                Pending payout {{ money(data.payroll.pendingPayout) }} ({{
                  data.payroll.pendingPayoutCount
                }})
              </div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col v-if="data.cashFlow" cols="12" sm="6" lg="3">
          <v-card
            variant="tonal"
            :color="data.cashFlow.net >= 0 ? 'teal' : 'orange-darken-2'"
            height="100%"
          >
            <v-card-text data-testid="kpi-cashflow">
              <div class="text-overline">Net cash flow</div>
              <div class="text-h5">{{ money(data.cashFlow.net) }}</div>
              <div class="text-caption">In {{ money(data.cashFlow.inflow) }}</div>
              <div class="text-caption">
                Out {{ money(data.cashFlow.outflow) }} (expenses + salary paid)
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <v-col v-if="data.students" cols="12" sm="6" lg="3">
          <v-card
            variant="tonal"
            color="primary"
            height="100%"
            :to="linkTo('/student-attendance') ?? linkTo('/students')"
          >
            <v-card-text data-testid="kpi-students">
              <div class="text-overline">Students</div>
              <div class="text-h5">{{ data.students.active }} active</div>
              <template v-if="data.students.attendance">
                <div v-if="data.students.attendance.marked" class="text-caption">
                  Present {{ data.students.attendance.present }} · Absent
                  {{ data.students.attendance.absent }} · Late
                  {{ data.students.attendance.late }}
                  <span v-if="data.students.attendance.leave">
                    · Leave {{ data.students.attendance.leave }}</span
                  >
                  <span v-if="data.students.attendance.halfDay">
                    · Half day {{ data.students.attendance.halfDay }}</span
                  >
                </div>
                <div class="text-caption">
                  {{ data.students.attendance.marked }} {{ unit('student') }} marked
                  <span v-if="!multiDay && data.students.attendance.marked < data.students.active">
                    · {{ data.students.active - data.students.attendance.marked }} not marked
                  </span>
                </div>
              </template>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col v-if="data.employees" cols="12" sm="6" lg="3">
          <v-card
            variant="tonal"
            color="indigo"
            height="100%"
            :to="linkTo('/attendance') ?? linkTo('/employees')"
          >
            <v-card-text data-testid="kpi-employees">
              <div class="text-overline">Employees</div>
              <div class="text-h5">{{ data.employees.active }} active</div>
              <div v-if="data.employees.attendance" class="text-caption">
                Present {{ data.employees.attendance.present }} · Absent
                {{ data.employees.attendance.absent }} · Half day
                {{ data.employees.attendance.halfDay }} · On leave
                {{ data.employees.attendance.onLeave }}
                <span v-if="data.employees.attendance.offOrHoliday">
                  · Off/holiday {{ data.employees.attendance.offOrHoliday }}</span
                >
                <span v-if="multiDay"> ({{ unit('employee') }})</span>
              </div>
              <div v-if="data.employees.leave" class="text-caption">
                {{ data.employees.leave.onApprovedLeave }} on approved leave ·
                {{ data.employees.leave.pendingRequests }} leave request(s) pending
              </div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col v-if="data.hostel" cols="12" sm="6" lg="3">
          <v-card variant="tonal" color="brown" height="100%" :to="linkTo('/hostel')">
            <v-card-text data-testid="kpi-hostel">
              <div class="text-overline">Hostel availability</div>
              <div class="text-h5">{{ data.hostel.available }} beds free</div>
              <div class="text-caption">
                {{ data.hostel.occupied }} occupied of {{ data.hostel.beds }} beds ·
                {{ data.hostel.hostels }} hostel(s)
                <span v-if="data.hostel.blocked"> · {{ data.hostel.blocked }} blocked</span>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col v-if="data.transport" cols="12" sm="6" lg="3">
          <v-card variant="tonal" color="amber-darken-3" height="100%" :to="linkTo('/transport')">
            <v-card-text data-testid="kpi-transport">
              <div class="text-overline">Transport availability</div>
              <div class="text-h5">{{ data.transport.available }} seats free</div>
              <div class="text-caption">
                {{ data.transport.allocated }} allocated of {{ data.transport.capacity }} seats ·
                {{ data.transport.vehicles }} vehicle(s) · {{ data.transport.routes }} route(s)
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <div v-if="data?.trend && data.trend.length > 1" class="mt-4" data-testid="overview-trend">
        <div class="text-subtitle-2 mb-1">
          Daily fee collection
          <v-icon color="success" size="small">mdi-square</v-icon>
          <template v-if="data.expenses">
            vs expenses <v-icon color="error" size="small">mdi-square</v-icon>
          </template>
        </div>
        <div class="d-flex align-end ga-1" style="height: 120px">
          <div
            v-for="t in data.trend"
            :key="t.date"
            class="d-flex align-end ga-px flex-grow-1"
            style="height: 100%"
            :title="`${t.date}: collected ${money(t.collected)}, expenses ${money(t.expenses)}`"
          >
            <div
              class="bg-success flex-grow-1 rounded-t"
              :style="{ height: `${(t.collected / maxTrend) * 100}%`, minHeight: '1px' }"
            />
            <div
              v-if="data.expenses"
              class="bg-error flex-grow-1 rounded-t"
              :style="{ height: `${(t.expenses / maxTrend) * 100}%`, minHeight: '1px' }"
            />
          </div>
        </div>
        <div class="d-flex justify-space-between text-caption text-medium-emphasis">
          <span>{{ data.trend[0]!.date }}</span>
          <span>{{ data.trend[data.trend.length - 1]!.date }}</span>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

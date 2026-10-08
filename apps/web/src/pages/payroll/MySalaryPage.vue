<script setup lang="ts">
import type {
  MySalaryComponentDto,
  MySalaryDto,
  SalaryStatementDto,
  SignedUrlDto,
} from '@erp/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { money } from './payroll';

/**
 * Employee self-service "My salary": the salary structure in force today (monthly + annual per
 * component) and the financial-year statement (month-wise earnings, deductions, TDS, YTD).
 */
const tab = ref<'structure' | 'statement'>('structure');
const salary = ref<MySalaryDto | null>(null);
const statement = ref<SalaryStatementDto | null>(null);
const fy = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const inr = (v: number) => `₹${money(v)}`;
const fmtDate = (d: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB') : '—';
const effectiveLabel = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleString('en-US', { month: 'long', year: 'numeric' });

async function loadSalary() {
  try {
    salary.value = (await apiFetch<{ data: MySalaryDto }>('/api/v1/payroll/me/salary')).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function loadStatement() {
  loading.value = true;
  try {
    const q = fy.value ? `?fy=${encodeURIComponent(fy.value)}` : '';
    statement.value = (
      await apiFetch<{ data: SalaryStatementDto }>(`/api/v1/payroll/me/salary-statement${q}`)
    ).data;
    fy.value = statement.value.financialYear;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(() => Promise.all([loadSalary(), loadStatement()]));
watch(fy, (v, old) => {
  if (old && v && v !== statement.value?.financialYear) void loadStatement();
});

const sections = computed(() =>
  salary.value
    ? (
        [
          ['Earnings', salary.value.earnings],
          ['Deductions (from your pay)', salary.value.deductions],
          [
            'Employer contributions (part of CTC, not paid in hand)',
            salary.value.employerContributions,
          ],
        ] as [string, MySalaryComponentDto[]][]
      ).filter(([, rows]) => rows.length)
    : [],
);

const statementSections = computed(() => {
  const rows = statement.value?.rows ?? [];
  return (
    [
      ['Earnings', rows.filter((r) => r.category === 'EARNING' || r.category === 'REIMBURSEMENT')],
      ['Deductions', rows.filter((r) => r.category === 'DEDUCTION')],
      ['Employer contributions', rows.filter((r) => r.category === 'EMPLOYER_CONTRIBUTION')],
    ] as const
  ).filter(([, r]) => r.length);
});

/* Print-only letterhead: brand name on the left, the company logo in the top-right corner
 * (same placement as generated PDFs). The signed logo URL is audited, so fetch it once. */
const auth = useAuthStore();
const brandName = computed(
  () => auth.me?.branding?.displayName ?? auth.me?.organization?.name ?? '',
);
const logoUrl = ref<string | null>(null);
async function loadLogo() {
  if (!auth.me?.branding?.logoFileId) return;
  try {
    logoUrl.value =
      (await apiFetch<{ data: SignedUrlDto | null }>('/api/v1/branding/home-logo-url')).data?.url ??
      null;
  } catch {
    logoUrl.value = null;
  }
}
onMounted(loadLogo);

const print = () => window.print();
</script>

<template>
  <div class="print-letterhead d-none d-print-flex align-start mb-4">
    <div class="text-h6 font-weight-bold">{{ brandName }}</div>
    <v-spacer />
    <img v-if="logoUrl" :src="logoUrl" alt="" class="print-logo" />
  </div>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">My salary</h2>
    <v-spacer />
    <v-btn prepend-icon="mdi-printer" variant="tonal" class="d-print-none" @click="print">
      Print / save PDF
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>

  <v-tabs v-model="tab" class="mb-4 d-print-none">
    <v-tab value="structure">Salary structure</v-tab>
    <v-tab value="statement">Annual statement</v-tab>
  </v-tabs>

  <v-window v-model="tab">
    <v-window-item value="structure">
      <v-card v-if="salary">
        <v-card-text>
          <div class="text-overline">Salary structure</div>
          <v-row dense class="mb-2">
            <v-col cols="12" sm="6" md="3">
              <div class="text-caption text-medium-emphasis">Employee</div>
              <div>{{ salary.employeeName }}, {{ salary.employeeCode }}</div>
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <div class="text-caption text-medium-emphasis">Designation</div>
              <div>{{ salary.designation ?? '—' }}</div>
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <div class="text-caption text-medium-emphasis">Date of joining</div>
              <div>{{ fmtDate(salary.dateOfJoining) }}</div>
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <div class="text-caption text-medium-emphasis">Salary effective from</div>
              <div>{{ effectiveLabel(salary.effectiveFrom) }}</div>
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <div class="text-caption text-medium-emphasis">Annual CTC</div>
              <div class="text-h6">{{ inr(salary.annualCtc) }}</div>
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <div class="text-caption text-medium-emphasis">Monthly in-hand (approx.)</div>
              <div class="text-h6 text-success">{{ inr(salary.netMonthly) }}</div>
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <div class="text-caption text-medium-emphasis">Structure</div>
              <div>{{ salary.structureName ?? '—' }}</div>
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <div class="text-caption text-medium-emphasis">Tax regime</div>
              <div>{{ salary.taxRegime === 'OLD' ? 'Old regime' : 'New regime' }}</div>
            </v-col>
          </v-row>

          <v-table density="compact">
            <thead>
              <tr>
                <th>Salary components</th>
                <th class="text-end">Monthly amount</th>
                <th class="text-end">Annual amount</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="[title, rows] in sections" :key="title">
                <tr>
                  <td colspan="3" class="font-weight-bold bg-grey-lighten-4">{{ title }}</td>
                </tr>
                <tr v-for="c in rows" :key="`${title}-${c.code}`">
                  <td>{{ c.name }}</td>
                  <td class="text-end">{{ inr(c.monthly) }}</td>
                  <td class="text-end">{{ inr(c.annual) }}</td>
                </tr>
              </template>
              <tr class="font-weight-bold">
                <td>Gross earnings</td>
                <td class="text-end">{{ inr(salary.grossMonthly) }}</td>
                <td class="text-end">{{ inr(salary.grossMonthly * 12) }}</td>
              </tr>
              <tr>
                <td>Total deductions</td>
                <td class="text-end">{{ inr(salary.deductionsMonthly) }}</td>
                <td class="text-end">{{ inr(salary.deductionsMonthly * 12) }}</td>
              </tr>
              <tr class="font-weight-bold text-success">
                <td>Net pay (take-home)</td>
                <td class="text-end">{{ inr(salary.netMonthly) }}</td>
                <td class="text-end">{{ inr(salary.netMonthly * 12) }}</td>
              </tr>
              <tr class="font-weight-bold">
                <td>Cost to company</td>
                <td class="text-end">{{ inr(salary.monthlyCtc) }}</td>
                <td class="text-end">{{ inr(salary.annualCtc) }}</td>
              </tr>
            </tbody>
          </v-table>
          <div class="text-caption text-medium-emphasis mt-2">
            Computed for a full month with no loss of pay. Actual pay depends on attendance, TDS and
            one-time adjustments — see your payslips.
          </div>
        </v-card-text>
      </v-card>

      <v-card v-if="salary?.revisions.length" title="Salary revisions" class="mt-4">
        <v-table density="compact">
          <thead>
            <tr>
              <th>Effective from</th>
              <th class="text-end">Annual CTC</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in salary.revisions" :key="r.effectiveFrom + r.annualCtc">
              <td>{{ fmtDate(r.effectiveFrom) }}</td>
              <td class="text-end">{{ inr(r.annualCtc) }}</td>
              <td>{{ r.reason }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card>
    </v-window-item>

    <v-window-item value="statement">
      <v-card :loading="loading">
        <v-card-text v-if="statement">
          <div class="d-flex align-center mb-3">
            <div class="text-overline">Salary statement · FY {{ statement.financialYear }}</div>
            <v-spacer />
            <v-select
              v-model="fy"
              :items="statement.availableYears"
              label="Financial year"
              density="compact"
              hide-details
              style="max-width: 180px"
              class="d-print-none"
            />
          </div>
          <v-row dense class="mb-3">
            <v-col
              v-for="[label, value, color] in [
                ['Gross earnings (YTD)', statement.totals.gross, ''],
                ['Deductions (YTD)', statement.totals.deductions, ''],
                ['Income tax / TDS (YTD)', statement.totals.tds, ''],
                ['Net paid (YTD)', statement.totals.net, 'text-success'],
              ] as const"
              :key="label"
              cols="6"
              md="3"
            >
              <v-card variant="tonal">
                <v-card-text>
                  <div class="text-caption">{{ label }}</div>
                  <div class="text-h6" :class="color">{{ inr(value) }}</div>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
          <div v-if="!statement.months.length" class="text-medium-emphasis">
            No payslips published for FY {{ statement.financialYear }} yet.
          </div>
          <div v-else style="overflow-x: auto">
            <v-table density="compact">
              <thead>
                <tr>
                  <th>Component</th>
                  <th v-for="m in statement.months" :key="m.month" class="text-end">
                    {{ m.label }}
                  </th>
                  <th class="text-end">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="text-medium-emphasis">Paid days / LOP</td>
                  <td v-for="m in statement.months" :key="m.month" class="text-end">
                    {{ m.payableDays }} / {{ m.lopDays }}
                  </td>
                  <td />
                </tr>
                <template v-for="[title, rows] in statementSections" :key="title">
                  <tr>
                    <td
                      :colspan="statement.months.length + 2"
                      class="font-weight-bold bg-grey-lighten-4"
                    >
                      {{ title }}
                    </td>
                  </tr>
                  <tr v-for="r in rows" :key="`${r.category}-${r.code}`">
                    <td>{{ r.name }}</td>
                    <td v-for="m in statement.months" :key="m.month" class="text-end">
                      {{ r.amounts[m.month] ? money(r.amounts[m.month]) : '—' }}
                    </td>
                    <td class="text-end font-weight-medium">{{ money(r.total) }}</td>
                  </tr>
                </template>
                <tr class="font-weight-bold">
                  <td>Gross earnings</td>
                  <td v-for="m in statement.months" :key="m.month" class="text-end">
                    {{ money(m.gross) }}
                  </td>
                  <td class="text-end">{{ money(statement.totals.gross) }}</td>
                </tr>
                <tr class="font-weight-bold">
                  <td>Total deductions</td>
                  <td v-for="m in statement.months" :key="m.month" class="text-end">
                    {{ money(m.deductions) }}
                  </td>
                  <td class="text-end">{{ money(statement.totals.deductions) }}</td>
                </tr>
                <tr class="font-weight-bold text-success">
                  <td>Net pay</td>
                  <td v-for="m in statement.months" :key="m.month" class="text-end">
                    {{ money(m.net) }}
                  </td>
                  <td class="text-end">{{ money(statement.totals.net) }}</td>
                </tr>
              </tbody>
            </v-table>
          </div>
        </v-card-text>
      </v-card>
    </v-window-item>
  </v-window>
</template>

<style scoped>
.print-letterhead {
  border-bottom: 2px solid currentColor;
  padding-bottom: 8px;
}
.print-logo {
  max-width: 150px;
  max-height: 75px;
  object-fit: contain;
}
</style>

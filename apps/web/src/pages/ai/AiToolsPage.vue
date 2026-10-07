<script setup lang="ts">
import type {
  AiPayrollExplanationDto,
  AiStudentInsightDto,
  AiSummaryDto,
  ApiListResponse,
  PayrollRunDto,
} from '@erp/shared';
import { computed, onMounted, ref } from 'vue';
import { apiFetch } from '@/api/client';
import DraftWithAiButton from '@/components/ai/DraftWithAiButton.vue';
import { useAuthStore } from '@/stores/auth';

/** AI workbench: payroll anomaly explanation, student insights, summarizer and drafting. */
const auth = useAuthStore();
const tab = ref('draft');
const error = ref<string | null>(null);

const canPayroll = computed(() => auth.hasFeature('payroll') && auth.can('payroll.view'));
const canStudents = computed(() => auth.hasFeature('education') && auth.can('student.view'));

// Drafting
const draft = ref<{ subject: string; body: string } | null>(null);

// Payroll anomaly
const runs = ref<PayrollRunDto[]>([]);
const runId = ref<string | null>(null);
const explaining = ref(false);
const explanation = ref<AiPayrollExplanationDto | null>(null);
async function loadRuns() {
  if (!canPayroll.value) return;
  try {
    runs.value = (
      await apiFetch<ApiListResponse<PayrollRunDto>>('/api/v1/payroll/runs?pageSize=50')
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function explain() {
  if (!runId.value) return;
  explaining.value = true;
  error.value = null;
  try {
    explanation.value = (
      await apiFetch<{ data: AiPayrollExplanationDto }>('/api/v1/ai/payroll/explain', {
        method: 'POST',
        body: JSON.stringify({ runId: runId.value }),
      })
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    explaining.value = false;
  }
}

// Student insight
const insighting = ref(false);
const insight = ref<AiStudentInsightDto | null>(null);
async function studentInsight() {
  insighting.value = true;
  error.value = null;
  try {
    insight.value = (
      await apiFetch<{ data: AiStudentInsightDto }>('/api/v1/ai/students/insights', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    insighting.value = false;
  }
}

// Summarizer
const summaryKind = ref<'resume' | 'jd' | 'generic'>('resume');
const summaryText = ref('');
const summarizing = ref(false);
const summary = ref<AiSummaryDto | null>(null);
async function summarize() {
  summarizing.value = true;
  error.value = null;
  try {
    summary.value = (
      await apiFetch<{ data: AiSummaryDto }>('/api/v1/ai/summarize', {
        method: 'POST',
        body: JSON.stringify({ kind: summaryKind.value, text: summaryText.value }),
      })
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    summarizing.value = false;
  }
}

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
onMounted(loadRuns);
</script>

<template>
  <h1 class="text-h5 mb-4">AI tools</h1>
  <v-alert v-if="error" type="error" class="mb-4" closable>{{ error }}</v-alert>
  <v-tabs v-model="tab" class="mb-4">
    <v-tab value="draft">Draft a document</v-tab>
    <v-tab v-if="canPayroll" value="payroll">Payroll anomalies</v-tab>
    <v-tab v-if="canStudents" value="students">Student insights</v-tab>
    <v-tab value="summarize">Resume / JD summary</v-tab>
  </v-tabs>

  <v-window v-model="tab">
    <v-window-item value="draft">
      <v-card>
        <v-card-text>
          <p class="mb-2">
            Offer letters, circulars, notices, emails to parents… Copy the result into a
            communication template or an HR letter.
          </p>
          <DraftWithAiButton label="New draft" @drafted="draft = $event" />
          <template v-if="draft">
            <v-text-field v-model="draft.subject" label="Subject" class="mt-4" />
            <v-textarea v-model="draft.body" label="Body" rows="12" auto-grow />
          </template>
        </v-card-text>
      </v-card>
    </v-window-item>

    <v-window-item v-if="canPayroll" value="payroll">
      <v-card>
        <v-card-text>
          <div class="d-flex align-center ga-2">
            <v-select
              v-model="runId"
              :items="runs"
              item-value="id"
              :item-title="
                (r: PayrollRunDto) => `${r.label} · ${r.institutionName ?? ''} · ${r.status}`
              "
              label="Payroll run"
              hide-details
            />
            <v-btn color="primary" :loading="explaining" :disabled="!runId" @click="explain">
              Explain
            </v-btn>
          </div>
          <template v-if="explanation">
            <v-row class="mt-4">
              <v-col cols="12" md="6">
                <v-table density="compact">
                  <thead>
                    <tr>
                      <th />
                      <th class="text-right">This run</th>
                      <th class="text-right">Previous</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="k in ['gross', 'deductions', 'net', 'employees'] as const" :key="k">
                      <td>{{ k }}</td>
                      <td class="text-right">{{ money(explanation.totals.current[k]) }}</td>
                      <td class="text-right">
                        {{
                          explanation.totals.previous ? money(explanation.totals.previous[k]) : '—'
                        }}
                      </td>
                    </tr>
                  </tbody>
                </v-table>
              </v-col>
              <v-col cols="12" md="6">
                <v-sheet color="surface-variant" rounded class="pa-3 ai-text">
                  {{ explanation.narrative }}
                </v-sheet>
              </v-col>
            </v-row>
            <h3 class="text-subtitle-1 mt-4">
              Flagged employees ({{ explanation.outliers.length }})
            </h3>
            <v-table density="compact">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th class="text-right">Net</th>
                  <th class="text-right">Previous</th>
                  <th class="text-right">Change</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="o in explanation.outliers" :key="o.employeeId">
                  <td>{{ o.employeeCode }} · {{ o.employeeName }}</td>
                  <td class="text-right">{{ money(o.currentNet) }}</td>
                  <td class="text-right">
                    {{ o.previousNet === null ? '—' : money(o.previousNet) }}
                  </td>
                  <td class="text-right">
                    {{ o.changePercent === null ? '—' : `${o.changePercent}%` }}
                  </td>
                  <td>{{ o.reasons.join('; ') }}</td>
                </tr>
              </tbody>
            </v-table>
          </template>
        </v-card-text>
      </v-card>
    </v-window-item>

    <v-window-item v-if="canStudents" value="students">
      <v-card>
        <v-card-text>
          <p class="mb-2">
            Heuristic at-risk signals from the data available (status, detention history,
            guardian/contact gaps; exam and attendance signals plug in when those modules exist).
            Names are shown to you only — they are never sent to the AI provider.
          </p>
          <v-btn color="primary" :loading="insighting" @click="studentInsight">
            Generate insights
          </v-btn>
          <template v-if="insight">
            <v-row class="mt-4">
              <v-col cols="12" md="5">
                <v-list density="compact">
                  <v-list-item title="Students" :subtitle="String(insight.totals.total)" />
                  <v-list-item
                    v-for="s in insight.signals"
                    :key="s.label"
                    :title="s.label"
                    :subtitle="s.value"
                  />
                </v-list>
              </v-col>
              <v-col cols="12" md="7">
                <v-sheet color="surface-variant" rounded class="pa-3 ai-text">
                  {{ insight.narrative }}
                </v-sheet>
              </v-col>
            </v-row>
            <h3 class="text-subtitle-1 mt-4">Needs attention ({{ insight.atRisk.length }})</h3>
            <v-table density="compact">
              <tbody>
                <tr v-for="s in insight.atRisk" :key="s.studentId">
                  <td>{{ s.admissionNo }}</td>
                  <td>{{ s.name }}</td>
                  <td>{{ s.reasons.join('; ') }}</td>
                </tr>
              </tbody>
            </v-table>
          </template>
        </v-card-text>
      </v-card>
    </v-window-item>

    <v-window-item value="summarize">
      <v-card>
        <v-card-text>
          <v-btn-toggle v-model="summaryKind" mandatory density="compact" class="mb-2">
            <v-btn value="resume">Resume</v-btn>
            <v-btn value="jd">Job description</v-btn>
            <v-btn value="generic">Other</v-btn>
          </v-btn-toggle>
          <v-textarea v-model="summaryText" label="Paste text" rows="8" auto-grow />
          <v-btn
            color="primary"
            :loading="summarizing"
            :disabled="summaryText.trim().length < 20"
            @click="summarize"
          >
            Summarize
          </v-btn>
          <v-sheet v-if="summary" color="surface-variant" rounded class="pa-3 mt-4">
            <p class="mb-2">{{ summary.summary }}</p>
            <ul class="ml-4">
              <li v-for="(h, i) in summary.highlights" :key="i">{{ h }}</li>
            </ul>
          </v-sheet>
        </v-card-text>
      </v-card>
    </v-window-item>
  </v-window>
</template>

<style scoped>
.ai-text {
  white-space: pre-wrap;
}
</style>

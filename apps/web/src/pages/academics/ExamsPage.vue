<script setup lang="ts">
import {
  EXAM_TERM_TYPES,
  type ApiListResponse,
  type ExamScheduleDto,
  type ExamTermDto,
  type GradeBand,
  type GradingScaleDto,
  type SubjectDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { PAGE_SIZE_OPTIONS, useServerList } from '@/lib/serverList';
import { useAuthStore } from '@/stores/auth';
import { useAcademicOptions } from './useAcademics';

const auth = useAuthStore();
const { institutions, sections, load: loadOptions } = useAcademicOptions();
const canManage = computed(() => auth.can('exam.manage'));
const canPublish = computed(() => auth.can('exam.publish'));
const error = ref<string | null>(null);
const info = ref<string | null>(null);
const institutionId = ref('');
const termList = useServerList<ExamTermDto>('/api/v1/exams/terms', {
  error,
  immediate: false,
  params: () => ({ institutionId: institutionId.value }),
});
const { items: terms } = termList;
const termId = ref('');
/** Last known copy of the selected term, so its card survives paging away from its row. */
const selectedTerm = ref<ExamTermDto | null>(null);
const term = computed(
  () =>
    terms.value.find((t) => t.id === termId.value) ??
    (selectedTerm.value?.id === termId.value ? selectedTerm.value : undefined),
);
watch(term, (t) => {
  if (t) selectedTerm.value = t;
});
function selectTerm(t: ExamTermDto) {
  selectedTerm.value = t;
  termId.value = t.id;
}
const onTermRow = (_e: unknown, row: { item: ExamTermDto }) => selectTerm(row.item);
// Mirrors exams.service: published terms are frozen; marks block term/paper deletion.
const published = computed(() => term.value?.status === 'PUBLISHED');
const termHasMarks = computed(() =>
  ['MARKS_ENTRY', 'RESULTS_COMPUTED', 'PUBLISHED'].includes(term.value?.status ?? ''),
);
const canEditSchedule = computed(() => canManage.value && !published.value);
const scales = ref<GradingScaleDto[]>([]);

const termDialog = ref(false);
const termForm = reactive({
  name: '',
  type: 'UNIT_TEST' as ExamTermDto['type'],
  academicYear: '2026-27',
  startDate: '',
  endDate: '',
  gradingScaleId: '' as string | null,
});

async function loadScales() {
  try {
    if (institutionId.value)
      scales.value = (
        await apiFetch<{ data: GradingScaleDto[] }>(
          `/api/v1/exams/grading-scales?institutionId=${institutionId.value}`,
        )
      ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function loadTerms() {
  await Promise.all([termList.load(), loadScales()]);
}
async function createTerm() {
  try {
    const r = await apiFetch<{ data: ExamTermDto }>('/api/v1/exams/terms', {
      method: 'POST',
      body: JSON.stringify({
        institutionId: institutionId.value,
        name: termForm.name,
        type: termForm.type,
        academicYear: termForm.academicYear,
        startDate: termForm.startDate || null,
        endDate: termForm.endDate || null,
        gradingScaleId: termForm.gradingScaleId || null,
      }),
    });
    termDialog.value = false;
    await loadTerms();
    selectTerm(r.data);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function deleteTerm() {
  if (!term.value || !confirm(`Delete ${term.value.name}?`)) return;
  try {
    await apiFetch(`/api/v1/exams/terms/${term.value.id}`, { method: 'DELETE' });
    termId.value = '';
    await loadTerms();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

/* ---- Grading scale ---- */
const scaleDialog = ref(false);
const scaleForm = reactive({
  name: 'Standard 10-point',
  isDefault: true,
  bands: [
    { grade: 'O', minPercent: 90, points: 10, isPass: true },
    { grade: 'A+', minPercent: 80, points: 9, isPass: true },
    { grade: 'A', minPercent: 70, points: 8, isPass: true },
    { grade: 'B+', minPercent: 60, points: 7, isPass: true },
    { grade: 'B', minPercent: 50, points: 6, isPass: true },
    { grade: 'C', minPercent: 40, points: 5, isPass: true },
    { grade: 'F', minPercent: 0, points: 0, isPass: false },
  ] as GradeBand[],
});
async function createScale() {
  try {
    await apiFetch('/api/v1/exams/grading-scales', {
      method: 'POST',
      body: JSON.stringify({ institutionId: institutionId.value, ...scaleForm }),
    });
    scaleDialog.value = false;
    await loadTerms();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

/* ---- Schedules per section ---- */
const sectionId = ref('');
const termSections = computed(() =>
  sections.value.filter((s) => !term.value || s.institutionId === term.value.institutionId),
);
interface Row {
  subjectId: string;
  name: string;
  include: boolean;
  examDate: string;
  startTime: string;
  endTime: string;
  room: string;
  maxMarks: number;
  passMarks: number;
  schedule?: ExamScheduleDto;
}
const rows = ref<Row[]>([]);
async function loadSchedules() {
  rows.value = [];
  if (!termId.value || !sectionId.value) return;
  try {
    const [sch, subs] = await Promise.all([
      apiFetch<{ data: ExamScheduleDto[] }>(
        `/api/v1/exams/terms/${termId.value}/schedules?classSectionId=${sectionId.value}`,
      ),
      apiFetch<ApiListResponse<SubjectDto>>(
        `/api/v1/subjects?classSectionId=${sectionId.value}&pageSize=100`,
      ),
    ]);
    rows.value = subs.data.map((s) => {
      const x = sch.data.find((d) => d.subjectId === s.id);
      return {
        subjectId: s.id,
        name: `${s.code} · ${s.name}`,
        include: !!x,
        examDate: x?.examDate ?? term.value?.startDate ?? '',
        startTime: x?.startTime ?? '10:00',
        endTime: x?.endTime ?? '11:00',
        room: x?.room ?? '',
        maxMarks: x?.maxMarks ?? s.maxMarks,
        passMarks: x?.passMarks ?? s.passMarks,
        schedule: x,
      };
    });
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function saveSchedules() {
  const selected = rows.value.filter((r) => r.include && r.examDate);
  if (!selected.length) return;
  try {
    await apiFetch(`/api/v1/exams/terms/${termId.value}/schedules`, {
      method: 'PUT',
      body: JSON.stringify({
        schedules: selected.map((r) => ({
          classSectionId: sectionId.value,
          subjectId: r.subjectId,
          examDate: r.examDate,
          startTime: r.startTime || null,
          endTime: r.endTime || null,
          room: r.room || null,
          maxMarks: Number(r.maxMarks),
          passMarks: Number(r.passMarks),
        })),
      }),
    });
    info.value = 'Exam schedule saved';
    await Promise.all([loadSchedules(), loadTerms()]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function removeSchedule(r: Row) {
  if (!r.schedule) return;
  try {
    await apiFetch(`/api/v1/exams/schedules/${r.schedule.id}`, { method: 'DELETE' });
    await loadSchedules();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function compute() {
  try {
    const r = await apiFetch<{ data: { sections: number; students: number } }>(
      `/api/v1/exams/terms/${termId.value}/compute`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    info.value = `Results computed for ${r.data.students} students in ${r.data.sections} section(s)`;
    await loadTerms();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function publish() {
  if (!confirm('Publish results and notify students & parents?')) return;
  try {
    await apiFetch(`/api/v1/exams/terms/${termId.value}/publish`, { method: 'POST' });
    info.value = 'Results published';
    await loadTerms();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const statusColor: Record<string, string> = {
  DRAFT: 'grey',
  SCHEDULED: 'info',
  MARKS_ENTRY: 'warning',
  RESULTS_COMPUTED: 'primary',
  PUBLISHED: 'success',
};
const termHeaders = [
  { title: 'Term', key: 'name' },
  { title: 'Type', key: 'type' },
  { title: 'Year', key: 'academicYear' },
  { title: 'Dates', key: 'dates' },
  { title: 'Papers', key: 'scheduleCount' },
  { title: 'Status', key: 'status' },
];
onMounted(async () => {
  await loadOptions();
  institutionId.value = institutions.value[0]?.id ?? '';
  // Department-scoped staff (teachers) list no institutions: the watcher never fires for them.
  if (!institutionId.value) await loadTerms();
});
watch(institutionId, loadScales);
watch([termId, sectionId], loadSchedules);
</script>
<template>
  <h2 class="text-h5 mb-4">Exams</h2>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-alert v-if="info" type="success" class="mb-3" closable @click:close="info = null">{{
    info
  }}</v-alert>
  <div class="d-flex ga-2 align-center mb-3">
    <v-autocomplete
      v-model="institutionId"
      :items="institutions"
      item-title="name"
      item-value="id"
      label="Institution"
      density="compact"
      hide-details
    />
    <template v-if="canManage && institutionId">
      <v-btn prepend-icon="mdi-plus" color="primary" @click="termDialog = true">Exam term</v-btn>
      <v-btn prepend-icon="mdi-scale-balance" @click="scaleDialog = true">Grading scale</v-btn>
    </template>
  </div>
  <v-chip-group v-if="scales.length" class="mb-2">
    <v-chip v-for="s in scales" :key="s.id" size="small" variant="outlined"
      >{{ s.name }}{{ s.isDefault ? ' (default)' : '' }}:
      {{ s.bands.map((b) => `${b.grade}≥${b.minPercent}`).join(' ') }}</v-chip
    >
  </v-chip-group>
  <v-data-table-server
    v-model:page="termList.page.value"
    v-model:items-per-page="termList.pageSize.value"
    :items-length="termList.total.value"
    :loading="termList.loading.value"
    :items-per-page-options="PAGE_SIZE_OPTIONS"
    :items="terms"
    :headers="termHeaders"
    :row-props="
      ({ item }) => ({
        class: ['cursor-pointer', { 'bg-blue-lighten-5': item.id === termId }],
      })
    "
    density="compact"
    class="mb-4"
    disable-sort
    @click:row="onTermRow"
  >
    <template #[`item.dates`]="{ item: t }">{{ t.startDate }} – {{ t.endDate }}</template>
    <template #[`item.status`]="{ item: t }">
      <v-chip size="small" :color="statusColor[t.status]">{{ t.status }}</v-chip>
    </template>
    <template #no-data>
      <span class="text-medium-emphasis">No exam terms.</span>
    </template>
  </v-data-table-server>

  <v-card v-if="term">
    <v-card-title class="d-flex align-center ga-2"
      >{{ term.name
      }}<v-chip size="small" :color="statusColor[term.status]">{{ term.status }}</v-chip
      ><v-spacer />
      <v-btn v-if="canManage && !published" size="small" @click="compute">Compute results</v-btn>
      <v-btn
        v-if="canPublish && !published"
        size="small"
        color="success"
        :disabled="term.status !== 'RESULTS_COMPUTED'"
        @click="publish"
        >Publish</v-btn
      >
      <v-btn
        size="small"
        variant="text"
        :to="{ path: 'results', query: { termId: term.id } }"
        append-icon="mdi-arrow-right"
        >Results</v-btn
      >
      <v-btn
        v-if="canManage && !termHasMarks"
        size="small"
        icon="mdi-delete"
        variant="text"
        color="error"
        :aria-label="`Delete ${term.name}`"
        title="Delete exam term"
        @click="deleteTerm"
    /></v-card-title>
    <v-card-text>
      <v-autocomplete
        v-model="sectionId"
        :items="termSections"
        item-title="name"
        item-value="id"
        label="Class section schedule"
        density="compact"
      />
      <v-table v-if="rows.length" density="compact">
        <thead>
          <tr>
            <th />
            <th>Subject</th>
            <th>Date</th>
            <th>Start</th>
            <th>End</th>
            <th>Room</th>
            <th>Max</th>
            <th>Pass</th>
            <th>Marks</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.subjectId">
            <td>
              <v-checkbox
                v-model="r.include"
                :disabled="!canEditSchedule || (r.schedule?.marksEntered ?? 0) > 0"
                density="compact"
                hide-details
              />
            </td>
            <td class="text-no-wrap">{{ r.name }}</td>
            <td>
              <v-text-field v-model="r.examDate" type="date" density="compact" hide-details />
            </td>
            <td>
              <v-text-field v-model="r.startTime" type="time" density="compact" hide-details />
            </td>
            <td><v-text-field v-model="r.endTime" type="time" density="compact" hide-details /></td>
            <td><v-text-field v-model="r.room" density="compact" hide-details /></td>
            <td style="width: 90px">
              <v-text-field
                v-model.number="r.maxMarks"
                type="number"
                density="compact"
                hide-details
              />
            </td>
            <td style="width: 90px">
              <v-text-field
                v-model.number="r.passMarks"
                type="number"
                density="compact"
                hide-details
              />
            </td>
            <td>
              <v-chip
                v-if="r.schedule"
                size="small"
                :color="r.schedule.marksStatus === 'LOCKED' ? 'success' : 'warning'"
                >{{ r.schedule.marksEntered ?? 0 }} · {{ r.schedule.marksStatus }}</v-chip
              >
            </td>
            <td>
              <v-btn
                v-if="canEditSchedule && r.schedule && !r.schedule.marksEntered"
                icon="mdi-delete"
                size="small"
                variant="text"
                @click="removeSchedule(r)"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-btn
        v-if="canEditSchedule && rows.length"
        class="mt-2"
        color="primary"
        @click="saveSchedules"
        >Save schedule</v-btn
      >
    </v-card-text>
  </v-card>

  <v-dialog v-model="termDialog" max-width="560"
    ><v-card
      ><v-card-title>New exam term</v-card-title
      ><v-card-text
        ><v-text-field v-model="termForm.name" label="Name" /><v-select
          v-model="termForm.type"
          :items="[...EXAM_TERM_TYPES]"
          label="Type" /><v-text-field
          v-model="termForm.academicYear"
          label="Academic year" /><v-row dense
          ><v-col
            ><v-text-field v-model="termForm.startDate" type="date" label="Start date" /></v-col
          ><v-col
            ><v-text-field v-model="termForm.endDate" type="date" label="End date" /></v-col></v-row
        ><v-select
          v-model="termForm.gradingScaleId"
          :items="scales"
          item-title="name"
          item-value="id"
          label="Grading scale (default if blank)"
          clearable /></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="termDialog = false">Cancel</v-btn
        ><v-btn color="primary" @click="createTerm">Create</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
  <v-dialog v-model="scaleDialog" max-width="560"
    ><v-card
      ><v-card-title>New grading scale</v-card-title
      ><v-card-text
        ><v-text-field v-model="scaleForm.name" label="Name" /><v-checkbox
          v-model="scaleForm.isDefault"
          label="Default for the institution"
          density="compact" />
        <v-table density="compact">
          <thead>
            <tr>
              <th>Grade</th>
              <th>Min %</th>
              <th>Points</th>
              <th>Pass</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(b, i) in scaleForm.bands" :key="i">
              <td><v-text-field v-model="b.grade" density="compact" hide-details /></td>
              <td>
                <v-text-field
                  v-model.number="b.minPercent"
                  type="number"
                  density="compact"
                  hide-details
                />
              </td>
              <td>
                <v-text-field
                  v-model.number="b.points"
                  type="number"
                  density="compact"
                  hide-details
                />
              </td>
              <td><v-checkbox v-model="b.isPass" density="compact" hide-details /></td>
            </tr>
          </tbody> </v-table></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="scaleDialog = false">Cancel</v-btn
        ><v-btn color="primary" @click="createScale">Create</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>

<script setup lang="ts">
import type { ApiListResponse, ExamResultDto, ExamTermDto } from '@erp/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiDownload, apiFetch } from '@/api/client';
import { useAcademicOptions } from './useAcademics';

const props = defineProps<{ mode?: 'results' | 'cards' }>();
const route = useRoute();
const { sections, load: loadOptions } = useAcademicOptions();
const terms = ref<ExamTermDto[]>([]);
const termId = ref((route.query.termId as string) ?? '');
const term = computed(() => terms.value.find((t) => t.id === termId.value));
const sectionId = ref('');
const results = ref<ExamResultDto[]>([]);
const error = ref<string | null>(null);
const loading = ref(false);
const downloading = ref(false);
const termSections = computed(() =>
  sections.value.filter((s) => !term.value || s.institutionId === term.value.institutionId),
);
const subjects = computed(() => results.value[0]?.subjects ?? []);

async function loadTerms() {
  try {
    terms.value = (
      await apiFetch<ApiListResponse<ExamTermDto>>('/api/v1/exams/terms?pageSize=100')
    ).data.filter((t) => ['RESULTS_COMPUTED', 'PUBLISHED'].includes(t.status));
    if (!termId.value) termId.value = terms.value[0]?.id ?? '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function load() {
  results.value = [];
  if (!termId.value || !sectionId.value) return;
  loading.value = true;
  try {
    results.value = (
      await apiFetch<{ data: ExamResultDto[] }>(
        `/api/v1/exams/terms/${termId.value}/results?classSectionId=${sectionId.value}`,
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function download(r: ExamResultDto) {
  try {
    await apiDownload(
      `/api/v1/exams/terms/${termId.value}/report-card/${r.studentId}`,
      `report-card-${r.student?.admissionNo ?? r.studentId}.pdf`,
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function downloadAll() {
  downloading.value = true;
  try {
    for (const r of results.value) await download(r);
  } finally {
    downloading.value = false;
  }
}
onMounted(async () => {
  await Promise.all([loadOptions(), loadTerms()]);
});
watch(termId, () => {
  if (!termSections.value.some((s) => s.id === sectionId.value)) sectionId.value = '';
});
watch([termId, sectionId], load);
</script>
<template>
  <h2 class="text-h5 mb-4">{{ props.mode === 'cards' ? 'Report cards' : 'Results' }}</h2>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-row dense
    ><v-col cols="12" md="5"
      ><v-select
        v-model="termId"
        :items="terms"
        :item-title="(t: ExamTermDto) => `${t.name} (${t.status})`"
        item-value="id"
        label="Exam term"
        density="compact"
        no-data-text="No computed results yet" /></v-col
    ><v-col cols="12" md="5"
      ><v-autocomplete
        v-model="sectionId"
        :items="termSections"
        item-title="name"
        item-value="id"
        label="Class section"
        density="compact" /></v-col
    ><v-col cols="12" md="2"
      ><v-btn
        v-if="props.mode === 'cards' && results.length"
        block
        :loading="downloading"
        prepend-icon="mdi-download"
        @click="downloadAll"
        >All PDFs</v-btn
      ></v-col
    ></v-row
  >
  <v-progress-linear v-if="loading" indeterminate />
  <div v-if="results.length" style="overflow-x: auto">
    <v-table density="compact">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Roll</th>
          <th>Student</th>
          <template v-if="props.mode !== 'cards'">
            <th v-for="s in subjects" :key="s.subjectId" class="text-no-wrap">{{ s.code }}</th>
          </template>
          <th>Total</th>
          <th>%</th>
          <th>Grade</th>
          <th>GPA</th>
          <th>Result</th>
          <th>Report card</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in results" :key="r.id">
          <td>{{ r.rank }}</td>
          <td>{{ r.student?.rollNo }}</td>
          <td class="text-no-wrap">{{ r.student?.displayName }}</td>
          <template v-if="props.mode !== 'cards'">
            <td v-for="s in r.subjects" :key="s.subjectId" :class="{ 'text-error': !s.passed }">
              {{ s.isAbsent ? 'AB' : s.marks }}
            </td>
          </template>
          <td>{{ r.totalMarks }}/{{ r.maxTotal }}</td>
          <td>{{ r.percentage }}</td>
          <td>{{ r.grade }}</td>
          <td>{{ r.gpa }}</td>
          <td>
            <v-chip size="small" :color="r.passed ? 'success' : 'error'">{{
              r.passed ? 'PASS' : 'FAIL'
            }}</v-chip>
          </td>
          <td>
            <v-btn icon="mdi-file-pdf-box" size="small" variant="text" @click="download(r)" />
          </td>
        </tr>
      </tbody>
    </v-table>
  </div>
  <p v-else-if="sectionId && !loading" class="text-medium-emphasis">
    No results computed for this section.
  </p>
</template>

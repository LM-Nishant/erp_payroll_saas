<script setup lang="ts">
import type {
  ApiListResponse,
  BellPeriodDto,
  SubjectAllocationDto,
  SubjectDto,
  TimetableClashDto,
  TimetableEntryDto,
  TimetableSubstitutionDto,
  TimetableViewDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ApiError, apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import TimetableGrid from './TimetableGrid.vue';
import { DAYS, teacherOptions, today, useAcademicOptions } from './useAcademics';

interface Cell {
  subjectId: string;
  teacherUserId: string | null;
  room: string | null;
}
const auth = useAuthStore();
const { institutions, sections, load: loadOptions } = useAcademicOptions();
const canManage = computed(() => auth.can('timetable.manage'));
const tab = ref(canManage.value ? 'section' : 'mine');
const error = ref<string | null>(null);
const info = ref<string | null>(null);

/* ---- Section timetable ---- */
const sectionId = ref('');
const section = computed(() => sections.value.find((s) => s.id === sectionId.value));
const view = ref<TimetableViewDto | null>(null);
const cells = ref<Record<string, Cell>>({});
const subjects = ref<SubjectDto[]>([]);
const allocations = ref<SubjectAllocationDto[]>([]);
const teachers = ref<{ id: string; title: string }[]>([]);
const editing = ref(false);
const pendingClashes = ref<TimetableClashDto[]>([]);
const cellDialog = reactive({ open: false, key: '', subjectId: '', teacherUserId: '', room: '' });
const key = (d: number, p: string) => `${d}:${p}`;

async function loadSection() {
  view.value = null;
  if (!sectionId.value) return;
  try {
    view.value = (
      await apiFetch<{ data: TimetableViewDto }>(`/api/v1/timetable/sections/${sectionId.value}`)
    ).data;
    cells.value = Object.fromEntries(
      view.value.entries.map((e) => [
        key(e.dayOfWeek, e.periodId),
        { subjectId: e.subjectId, teacherUserId: e.teacherUserId, room: e.room },
      ]),
    );
    if (canManage.value && section.value) {
      const [s, a, t] = await Promise.all([
        apiFetch<ApiListResponse<SubjectDto>>(
          `/api/v1/subjects?classSectionId=${sectionId.value}&pageSize=100`,
        ),
        apiFetch<ApiListResponse<SubjectAllocationDto>>(
          `/api/v1/subject-allocations?classSectionId=${sectionId.value}&pageSize=100`,
        ),
        teacherOptions(section.value.institutionId),
      ]);
      subjects.value = s.data;
      allocations.value = a.data;
      teachers.value = t;
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function editCell(day: number, periodId: string) {
  if (!editing.value) return;
  const k = key(day, periodId);
  const c = cells.value[k];
  Object.assign(cellDialog, {
    open: true,
    key: k,
    subjectId: c?.subjectId ?? '',
    teacherUserId: c?.teacherUserId ?? '',
    room: c?.room ?? '',
  });
}
watch(
  () => cellDialog.subjectId,
  (sid) => {
    const alloc = allocations.value.find((a) => a.subjectId === sid);
    if (alloc && cellDialog.open && !cellDialog.teacherUserId)
      cellDialog.teacherUserId = alloc.teacherUserId;
  },
);
function applyCell(clear = false) {
  const next = { ...cells.value };
  if (clear || !cellDialog.subjectId) delete next[cellDialog.key];
  else
    next[cellDialog.key] = {
      subjectId: cellDialog.subjectId,
      teacherUserId: cellDialog.teacherUserId || null,
      room: cellDialog.room || null,
    };
  cells.value = next;
  cellDialog.open = false;
}
const draftEntries = computed<TimetableEntryDto[]>(() =>
  Object.entries(cells.value).map(([k, c]) => {
    const [d, periodId] = k.split(':');
    return {
      id: k,
      classSectionId: sectionId.value,
      dayOfWeek: Number(d),
      periodId: periodId!,
      subjectId: c.subjectId,
      teacherUserId: c.teacherUserId,
      room: c.room,
      subject: subjects.value.find((s) => s.id === c.subjectId) ?? null,
      teacher: (() => {
        const t = teachers.value.find((x) => x.id === c.teacherUserId);
        return t ? { id: t.id, name: t.title.split(' (')[0]!, email: '' } : null;
      })(),
    };
  }),
);
async function saveSection(allowClashes = false) {
  error.value = null;
  try {
    const entries = Object.entries(cells.value).map(([k, c]) => {
      const [d, periodId] = k.split(':');
      return { dayOfWeek: Number(d), periodId, ...c };
    });
    const r = await apiFetch<{ data: { clashes: TimetableClashDto[] } }>(
      `/api/v1/timetable/sections/${sectionId.value}`,
      { method: 'PUT', body: JSON.stringify({ entries, allowClashes }) },
    );
    pendingClashes.value = [];
    editing.value = false;
    info.value = r.data.clashes.length
      ? `Saved with ${r.data.clashes.length} clash(es)`
      : 'Timetable saved';
    await loadSection();
  } catch (e) {
    if (e instanceof ApiError && e.code === 'TIMETABLE_CLASH') {
      pendingClashes.value = (e.details as { clashes: TimetableClashDto[] }).clashes ?? [];
    } else error.value = (e as Error).message;
  }
}

/* ---- Bell schedule ---- */
const bellInstitutionId = ref('');
const periods = ref<Omit<BellPeriodDto, 'id' | 'institutionId'>[]>([]);
async function loadPeriods() {
  if (!bellInstitutionId.value) return;
  const r = await apiFetch<{ data: BellPeriodDto[] }>(
    `/api/v1/timetable/periods?institutionId=${bellInstitutionId.value}`,
  );
  periods.value = r.data.map(({ seq, name, startTime, endTime, isBreak }) => ({
    seq,
    name,
    startTime,
    endTime,
    isBreak,
  }));
}
function addPeriod() {
  const last = periods.value[periods.value.length - 1];
  periods.value.push({
    seq: (last?.seq ?? 0) + 1,
    name: `Period ${(last?.seq ?? 0) + 1}`,
    startTime: last?.endTime ?? '09:00',
    endTime: last?.endTime ?? '09:45',
    isBreak: false,
  });
}
async function savePeriods() {
  error.value = null;
  try {
    await apiFetch('/api/v1/timetable/periods', {
      method: 'PUT',
      body: JSON.stringify({
        institutionId: bellInstitutionId.value,
        periods: periods.value.map((p) => ({ ...p, seq: Number(p.seq) })),
      }),
    });
    info.value = 'Bell schedule saved';
    await loadPeriods();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

/* ---- Substitutions & clashes ---- */
const subDate = ref(today());
const subs = ref<TimetableSubstitutionDto[]>([]);
const subDialog = reactive({
  open: false,
  sectionId: '',
  entryId: '',
  substituteUserId: '',
  reason: '',
});
const subEntries = ref<TimetableEntryDto[]>([]);
const subTeachers = ref<{ id: string; title: string }[]>([]);
const clashes = ref<TimetableClashDto[]>([]);
const clashInstitutionId = ref('');
async function loadSubs() {
  const r = await apiFetch<{ data: TimetableSubstitutionDto[] }>(
    `/api/v1/timetable/substitutions?date=${subDate.value}`,
  );
  subs.value = r.data;
}
watch(
  () => subDialog.sectionId,
  async (id) => {
    subEntries.value = [];
    if (!id) return;
    const v = await apiFetch<{ data: TimetableViewDto }>(
      `/api/v1/timetable/sections/${id}?date=${subDate.value}`,
    );
    subEntries.value = v.data.entries.map((e) => ({
      ...e,
      subject: e.subject,
      classSection: {
        id,
        name: `${v.data.periods.find((p) => p.id === e.periodId)?.name ?? ''} · ${e.subject?.name ?? ''} · ${e.teacher?.name ?? ''}`,
      },
    }));
    const inst = sections.value.find((s) => s.id === id)?.institutionId;
    if (inst) subTeachers.value = await teacherOptions(inst);
  },
);
async function createSub() {
  try {
    await apiFetch('/api/v1/timetable/substitutions', {
      method: 'POST',
      body: JSON.stringify({
        entryId: subDialog.entryId,
        date: subDate.value,
        substituteUserId: subDialog.substituteUserId,
        reason: subDialog.reason || null,
      }),
    });
    subDialog.open = false;
    await loadSubs();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function removeSub(s: TimetableSubstitutionDto) {
  await apiFetch(`/api/v1/timetable/substitutions/${s.id}`, { method: 'DELETE' });
  await loadSubs();
}
async function loadClashes() {
  if (!clashInstitutionId.value) return;
  clashes.value = (
    await apiFetch<{ data: TimetableClashDto[] }>(
      `/api/v1/timetable/clashes?institutionId=${clashInstitutionId.value}`,
    )
  ).data;
}
const sectionName = (id: string) => sections.value.find((s) => s.id === id)?.name ?? id;
const dayName = (d: number) => DAYS.find((x) => x.value === d)?.title ?? d;

/* ---- My (teacher) timetable ---- */
const mine = ref<TimetableViewDto | null>(null);
async function loadMine() {
  try {
    mine.value = (await apiFetch<{ data: TimetableViewDto }>('/api/v1/timetable/teacher')).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(async () => {
  await loadOptions();
  const first = institutions.value[0]?.id ?? '';
  bellInstitutionId.value = first;
  clashInstitutionId.value = first;
});
watch(sectionId, loadSection);
watch(bellInstitutionId, loadPeriods);
watch(clashInstitutionId, loadClashes);
watch(subDate, loadSubs);
watch(
  tab,
  (t) => {
    if (t === 'subs') void loadSubs();
    if (t === 'mine') void loadMine();
    if (t === 'clashes') void loadClashes();
  },
  { immediate: true },
);
</script>
<template>
  <h2 class="text-h5 mb-4">Timetable</h2>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-alert v-if="info" type="success" class="mb-3" closable @click:close="info = null">{{
    info
  }}</v-alert>
  <v-tabs v-model="tab" class="mb-4">
    <v-tab value="section">Section timetable</v-tab>
    <v-tab value="mine">My timetable</v-tab>
    <v-tab v-if="canManage" value="bell">Bell schedule</v-tab>
    <v-tab value="subs">Substitutions</v-tab>
    <v-tab value="clashes">Clashes</v-tab>
  </v-tabs>
  <v-window v-model="tab">
    <v-window-item value="section">
      <div class="d-flex ga-2 align-center mb-3">
        <v-autocomplete
          v-model="sectionId"
          :items="sections"
          item-title="name"
          item-value="id"
          label="Class section"
          density="compact"
          hide-details
        />
        <template v-if="canManage && view">
          <v-btn v-if="!editing" prepend-icon="mdi-pencil" @click="editing = true">Edit</v-btn>
          <template v-else>
            <v-btn color="primary" @click="saveSection(false)">Save</v-btn
            ><v-btn
              variant="text"
              @click="
                editing = false;
                loadSection();
              "
              >Cancel</v-btn
            >
          </template>
        </template>
      </div>
      <v-alert v-if="pendingClashes.length" type="warning" class="mb-3">
        <div v-for="(c, i) in pendingClashes" :key="i">
          {{ c.kind === 'TEACHER' ? 'Teacher' : 'Room' }} clash on {{ dayName(c.dayOfWeek) }}
          {{ view?.periods.find((p) => p.id === c.periodId)?.name }} with
          {{ c.classSectionIds.map(sectionName).join(', ') }}
        </div>
        <v-btn class="mt-2" size="small" @click="saveSection(true)">Save anyway</v-btn>
      </v-alert>
      <p v-if="editing" class="text-caption mb-2">Click a cell to set subject, teacher and room.</p>
      <TimetableGrid
        v-if="view"
        :periods="view.periods"
        :entries="editing ? draftEntries : view.entries"
        :clickable="editing"
        @cell="editCell"
      />
    </v-window-item>
    <v-window-item value="mine">
      <TimetableGrid v-if="mine" :periods="mine.periods" :entries="mine.entries" show-section />
    </v-window-item>
    <v-window-item value="bell">
      <v-autocomplete
        v-model="bellInstitutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Institution"
        density="compact"
        class="mb-2"
      />
      <v-table density="compact">
        <thead>
          <tr>
            <th>Seq</th>
            <th>Name</th>
            <th>Start</th>
            <th>End</th>
            <th>Break</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, i) in periods" :key="i">
            <td style="width: 90px">
              <v-text-field v-model.number="p.seq" type="number" density="compact" hide-details />
            </td>
            <td><v-text-field v-model="p.name" density="compact" hide-details /></td>
            <td>
              <v-text-field v-model="p.startTime" type="time" density="compact" hide-details />
            </td>
            <td><v-text-field v-model="p.endTime" type="time" density="compact" hide-details /></td>
            <td><v-checkbox v-model="p.isBreak" density="compact" hide-details /></td>
            <td>
              <v-btn icon="mdi-delete" size="small" variant="text" @click="periods.splice(i, 1)" />
            </td>
          </tr>
        </tbody>
      </v-table>
      <div class="d-flex ga-2 mt-2">
        <v-btn prepend-icon="mdi-plus" @click="addPeriod">Add period</v-btn
        ><v-btn color="primary" :disabled="!periods.length" @click="savePeriods">Save</v-btn>
      </div>
    </v-window-item>
    <v-window-item value="subs">
      <div class="d-flex ga-2 align-center mb-3">
        <v-text-field
          v-model="subDate"
          type="date"
          label="Date"
          density="compact"
          hide-details
          style="max-width: 220px"
        /><v-spacer /><v-btn
          v-if="canManage"
          color="primary"
          prepend-icon="mdi-plus"
          @click="subDialog.open = true"
          >Substitution</v-btn
        >
      </div>
      <v-table density="compact">
        <thead>
          <tr>
            <th>Section</th>
            <th>Day</th>
            <th>Subject</th>
            <th>Regular teacher</th>
            <th>Substitute</th>
            <th>Reason</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in subs" :key="s.id">
            <td>{{ s.entry?.classSection?.name ?? sectionName(s.entry?.classSectionId ?? '') }}</td>
            <td>{{ s.entry ? dayName(s.entry.dayOfWeek) : '' }}</td>
            <td>{{ s.entry?.subject?.name }}</td>
            <td>{{ s.entry?.teacher?.name }}</td>
            <td>{{ s.substitute?.name }}</td>
            <td>{{ s.reason }}</td>
            <td>
              <v-btn
                v-if="canManage"
                icon="mdi-delete"
                size="small"
                variant="text"
                @click="removeSub(s)"
              />
            </td>
          </tr>
          <tr v-if="!subs.length">
            <td colspan="7" class="text-medium-emphasis">No substitutions for this date.</td>
          </tr>
        </tbody>
      </v-table>
    </v-window-item>
    <v-window-item value="clashes">
      <v-autocomplete
        v-model="clashInstitutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Institution"
        density="compact"
        class="mb-2"
      />
      <v-alert v-if="!clashes.length" type="success" variant="tonal">No clashes detected.</v-alert>
      <v-table v-else density="compact">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Day</th>
            <th>Teacher / room</th>
            <th>Sections</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(c, i) in clashes" :key="i">
            <td>{{ c.kind }}</td>
            <td>{{ dayName(c.dayOfWeek) }}</td>
            <td>{{ c.key }}</td>
            <td>{{ c.classSectionIds.map(sectionName).join(', ') }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-window-item>
  </v-window>

  <v-dialog v-model="cellDialog.open" max-width="520"
    ><v-card
      ><v-card-title>Timetable cell</v-card-title
      ><v-card-text
        ><v-autocomplete
          v-model="cellDialog.subjectId"
          :items="subjects"
          item-title="name"
          item-value="id"
          label="Subject" /><v-autocomplete
          v-model="cellDialog.teacherUserId"
          :items="teachers"
          item-title="title"
          item-value="id"
          label="Teacher"
          clearable /><v-text-field v-model="cellDialog.room" label="Room" /></v-card-text
      ><v-card-actions
        ><v-btn color="error" variant="text" @click="applyCell(true)">Clear</v-btn
        ><v-spacer /><v-btn variant="text" @click="cellDialog.open = false">Cancel</v-btn
        ><v-btn color="primary" @click="applyCell()">Apply</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
  <v-dialog v-model="subDialog.open" max-width="560"
    ><v-card
      ><v-card-title>Substitution on {{ subDate }}</v-card-title
      ><v-card-text
        ><v-autocomplete
          v-model="subDialog.sectionId"
          :items="sections"
          item-title="name"
          item-value="id"
          label="Class section" /><v-select
          v-model="subDialog.entryId"
          :items="subEntries"
          item-title="classSection.name"
          item-value="id"
          label="Period"
          no-data-text="No classes on this weekday" /><v-autocomplete
          v-model="subDialog.substituteUserId"
          :items="subTeachers"
          item-title="title"
          item-value="id"
          label="Substitute teacher" /><v-text-field
          v-model="subDialog.reason"
          label="Reason" /></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="subDialog.open = false">Cancel</v-btn
        ><v-btn
          color="primary"
          :disabled="!subDialog.entryId || !subDialog.substituteUserId"
          @click="createSub"
          >Create</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>

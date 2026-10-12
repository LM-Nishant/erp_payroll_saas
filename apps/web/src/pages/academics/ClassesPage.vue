<script setup lang="ts">
import { programLevelSchema, type ApiListResponse, type ProgramLevel } from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

interface Named {
  id: string;
  name: string;
  code: string;
}
interface Program extends Named {
  institutionId: string;
  departmentId: string;
  level: ProgramLevel;
  durationMonths: number | null;
}
interface Section extends Named {
  programId: string;
  academicYear: string | null;
  capacity: number | null;
}

const auth = useAuthStore();
const can = (p: string) => auth.can(p);
const route = useRoute();
const canMessage = computed(
  () => auth.can('message.broadcast') && auth.hasFeature('communication'),
);
function messageLink(type: 'program' | 'class_section', id: string) {
  const base = route.path.startsWith('/group') ? '/group' : '/institution';
  const q = new URLSearchParams({
    institutionId: institutionId.value,
    type,
    ids: id,
    recipients: 'guardians',
  });
  return `${base}/announcements?${q}`;
}

async function all<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 50; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await apiFetch<ApiListResponse<T>>(`${path}${sep}pageSize=100&page=${page}`);
    out.push(...r.data);
    if (out.length >= r.meta.total || r.data.length === 0) break;
  }
  return out;
}

const thisYear = new Date().getFullYear();
const month = new Date().getMonth();
const start = month >= 3 ? thisYear : thisYear - 1;
const defaultYear = `${start}-${String((start + 1) % 100).padStart(2, '0')}`;

const institutions = ref<Named[]>([]);
const departments = ref<Named[]>([]);
const programs = ref<Program[]>([]);
const sections = ref<Section[]>([]);
const institutionId = ref('');
const academicYear = ref(defaultYear);
const loading = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

const LEVEL_LABEL: Record<string, string> = {
  PRE_PRIMARY: 'Pre-primary',
  PRIMARY: 'Primary',
  SECONDARY: 'Secondary',
  HIGHER_SECONDARY: 'Higher secondary',
  DIPLOMA: 'Diploma',
  UNDERGRADUATE: 'Undergraduate',
  POSTGRADUATE: 'Postgraduate',
  DOCTORAL: 'Doctoral',
  CERTIFICATE: 'Certificate',
  OTHER: 'Other',
};
const levels = programLevelSchema.options.map((value) => ({
  value,
  title: LEVEL_LABEL[value] ?? value,
}));
const deptName = (id: string) => departments.value.find((d) => d.id === id)?.name ?? '';

const rows = computed(() =>
  programs.value
    .map((p) => ({
      ...p,
      sections: sections.value
        .filter((s) => s.programId === p.id && (s.academicYear ?? '') === academicYear.value)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
);
const totals = computed(() => ({
  classes: rows.value.length,
  sections: rows.value.reduce((n, r) => n + r.sections.length, 0),
  seats: rows.value.reduce((n, r) => n + r.sections.reduce((m, s) => m + (s.capacity ?? 0), 0), 0),
}));

async function loadInstitutions() {
  institutions.value = await all<Named>('/api/v1/institutions');
  if (!institutionId.value && institutions.value.length) {
    institutionId.value = institutions.value[0]!.id;
  }
}
async function load() {
  if (!institutionId.value) return;
  loading.value = true;
  error.value = null;
  try {
    const q = `institutionId=${institutionId.value}`;
    [departments.value, programs.value, sections.value] = await Promise.all([
      all<Named>(`/api/v1/departments?${q}`),
      all<Program>(`/api/v1/programs?${q}`),
      all<Section>(`/api/v1/class-sections?${q}`),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(institutionId, load);
onMounted(async () => {
  try {
    await loadInstitutions();
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const toCode = (s: string) =>
  s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'X';
const sectionCode = (programCode: string, sec: string) =>
  `${programCode}-${toCode(sec)}`.slice(0, 32);
const splitList = (s: string) =>
  s
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

// ---- Bulk setup: many classes × many sections in one go ----
const PRESETS: Record<string, { classes: string[]; level: ProgramLevel }> = {
  'Nursery–UKG': { classes: ['Nursery', 'LKG', 'UKG'], level: 'PRE_PRIMARY' },
  'Class 1–5': { classes: [1, 2, 3, 4, 5].map((n) => `Class ${n}`), level: 'PRIMARY' },
  'Class 6–10': { classes: [6, 7, 8, 9, 10].map((n) => `Class ${n}`), level: 'SECONDARY' },
  'Class 11–12': { classes: ['Class 11', 'Class 12'], level: 'HIGHER_SECONDARY' },
};
const bulk = reactive({
  open: false,
  departmentId: '' as string,
  newDepartment: 'Academics',
  level: 'PRIMARY' as ProgramLevel,
  classes: '',
  sections: 'A, B',
  capacity: 40 as number | null,
  saving: false,
  error: null as string | null,
  progress: '',
});
function openBulk(preset?: string) {
  Object.assign(bulk, {
    open: true,
    departmentId: departments.value[0]?.id ?? '',
    level: preset ? PRESETS[preset]!.level : 'PRIMARY',
    classes: preset ? PRESETS[preset]!.classes.join('\n') : '',
    sections: 'A, B',
    capacity: 40,
    saving: false,
    error: null,
    progress: '',
  });
}
function applyPreset(name: string) {
  const p = PRESETS[name]!;
  const existing = splitList(bulk.classes);
  bulk.classes = [...existing, ...p.classes.filter((c) => !existing.includes(c))].join('\n');
  bulk.level = p.level;
}
const bulkPreview = computed(() => {
  const c = splitList(bulk.classes).length;
  const s = splitList(bulk.sections).length;
  return { classes: c, sections: c * s, seats: c * s * (bulk.capacity ?? 0) };
});

async function saveBulk() {
  bulk.error = null;
  const classNames = splitList(bulk.classes);
  const secNames = splitList(bulk.sections);
  if (!classNames.length) return void (bulk.error = 'Enter at least one class');
  if (!secNames.length) return void (bulk.error = 'Enter at least one section (e.g. A, B)');
  if (!/^\d{4}(-\d{2,4})?$/.test(academicYear.value))
    return void (bulk.error = 'Academic year must look like 2026-27');
  bulk.saving = true;
  let createdClasses = 0;
  let createdSections = 0;
  try {
    let departmentId = bulk.departmentId;
    if (!departmentId) {
      if (!bulk.newDepartment.trim()) throw new Error('Choose or name a department');
      bulk.progress = 'Creating department…';
      const d = await apiFetch<{ data: Named }>('/api/v1/departments', {
        method: 'POST',
        body: JSON.stringify({
          institutionId: institutionId.value,
          name: bulk.newDepartment.trim(),
          code: toCode(bulk.newDepartment),
        }),
      });
      departmentId = d.data.id;
      departments.value.push(d.data);
    }
    for (const name of classNames) {
      bulk.progress = `Creating ${name}…`;
      let program = programs.value.find(
        (p) => p.name.toLowerCase() === name.toLowerCase() || p.code === toCode(name),
      );
      if (!program) {
        const r = await apiFetch<{ data: Program }>('/api/v1/programs', {
          method: 'POST',
          body: JSON.stringify({ departmentId, name, code: toCode(name), level: bulk.level }),
        });
        program = r.data;
        programs.value.push(program);
        createdClasses++;
      }
      for (const sec of secNames) {
        const code = sectionCode(program.code, sec);
        const exists = sections.value.some(
          (s) =>
            s.programId === program!.id &&
            s.code === code &&
            (s.academicYear ?? '') === academicYear.value,
        );
        if (exists) continue;
        const r = await apiFetch<{ data: Section }>('/api/v1/class-sections', {
          method: 'POST',
          body: JSON.stringify({
            programId: program.id,
            name: `${program.name} ${sec}`,
            code,
            academicYear: academicYear.value,
            capacity: bulk.capacity || null,
          }),
        });
        sections.value.push(r.data);
        createdSections++;
      }
    }
    bulk.open = false;
    notice.value = `Created ${createdClasses} class(es) and ${createdSections} section(s). Existing ones were kept.`;
  } catch (e) {
    bulk.error = `${(e as Error).message} (created ${createdClasses} classes, ${createdSections} sections before this)`;
  } finally {
    bulk.saving = false;
    bulk.progress = '';
  }
}

// ---- Edit a class ----
const cls = reactive({
  open: false,
  id: '',
  name: '',
  code: '',
  level: 'PRIMARY' as ProgramLevel,
  durationMonths: null as number | null,
  saving: false,
  error: null as string | null,
});
function openClass(p: Program) {
  Object.assign(cls, {
    open: true,
    id: p.id,
    name: p.name,
    code: p.code,
    level: p.level,
    durationMonths: p.durationMonths,
    saving: false,
    error: null,
  });
}
async function saveClass() {
  cls.saving = true;
  cls.error = null;
  try {
    const r = await apiFetch<{ data: Program }>(`/api/v1/programs/${cls.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: cls.name.trim(),
        code: cls.code.trim(),
        level: cls.level,
        durationMonths: cls.durationMonths || null,
      }),
    });
    programs.value = programs.value.map((p) => (p.id === cls.id ? { ...p, ...r.data } : p));
    cls.open = false;
  } catch (e) {
    cls.error = (e as Error).message;
  } finally {
    cls.saving = false;
  }
}
async function removeClass(p: Program) {
  if (!confirm(`Delete ${p.name}? Its sections must be deleted first.`)) return;
  try {
    await apiFetch(`/api/v1/programs/${p.id}`, { method: 'DELETE' });
    programs.value = programs.value.filter((x) => x.id !== p.id);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// ---- Add / edit a section ----
const sec = reactive({
  open: false,
  id: '' as string,
  programId: '',
  programCode: '',
  name: '',
  code: '',
  capacity: 40 as number | null,
  saving: false,
  error: null as string | null,
});
function openSection(p: Program, s?: Section) {
  Object.assign(sec, {
    open: true,
    id: s?.id ?? '',
    programId: p.id,
    programCode: p.code,
    name: s?.name ?? `${p.name} `,
    code: s?.code ?? '',
    capacity: s?.capacity ?? 40,
    saving: false,
    error: null,
  });
}
async function saveSection() {
  sec.saving = true;
  sec.error = null;
  try {
    const name = sec.name.trim();
    const code = sec.code.trim() || sectionCode(sec.programCode, name.split(/\s+/).pop() ?? name);
    const body = { name, code, capacity: sec.capacity || null, academicYear: academicYear.value };
    if (sec.id) {
      const r = await apiFetch<{ data: Section }>(`/api/v1/class-sections/${sec.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      sections.value = sections.value.map((s) => (s.id === sec.id ? { ...s, ...r.data } : s));
    } else {
      const r = await apiFetch<{ data: Section }>('/api/v1/class-sections', {
        method: 'POST',
        body: JSON.stringify({ ...body, programId: sec.programId }),
      });
      sections.value.push(r.data);
    }
    sec.open = false;
  } catch (e) {
    sec.error = (e as Error).message;
  } finally {
    sec.saving = false;
  }
}
async function removeSection(s: Section) {
  if (!confirm(`Delete section ${s.name}?`)) return;
  try {
    await apiFetch(`/api/v1/class-sections/${s.id}`, { method: 'DELETE' });
    sections.value = sections.value.filter((x) => x.id !== s.id);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const headers = [
  { title: 'Class / program', key: 'name' },
  { title: 'Code', key: 'code' },
  { title: 'Level', key: 'level' },
  { title: 'Department', key: 'departmentId' },
  { title: 'Sections', key: 'sections', sortable: false },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
</script>

<template>
  <div class="d-flex align-center flex-wrap mb-4 ga-2">
    <h2 class="text-h5">Classes &amp; sections</h2>
    <v-spacer />
    <v-select
      v-if="institutions.length > 1"
      v-model="institutionId"
      :items="institutions"
      item-title="name"
      item-value="id"
      label="Institution"
      density="compact"
      hide-details
      style="max-width: 280px"
    />
    <v-text-field
      v-model="academicYear"
      label="Academic year"
      density="compact"
      hide-details
      style="max-width: 140px"
    />
    <v-btn
      v-if="can('program.create') && can('class_section.create')"
      color="primary"
      prepend-icon="mdi-plus-box-multiple"
      :disabled="!institutionId"
      @click="openBulk()"
    >
      Add classes &amp; sections
    </v-btn>
  </div>

  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-alert v-if="notice" type="success" class="mb-3" closable @click:close="notice = null">
    {{ notice }}
  </v-alert>

  <div class="d-flex ga-3 mb-3 text-body-2">
    <v-chip prepend-icon="mdi-google-classroom">{{ totals.classes }} classes</v-chip>
    <v-chip prepend-icon="mdi-view-grid-outline">
      {{ totals.sections }} sections in {{ academicYear }}
    </v-chip>
    <v-chip prepend-icon="mdi-seat">{{ totals.seats }} seats</v-chip>
  </div>

  <v-data-table :items="rows" :headers="headers" :loading="loading" items-per-page="50">
    <template #[`item.level`]="{ item }">{{ LEVEL_LABEL[item.level] ?? item.level }}</template>
    <template #[`item.departmentId`]="{ item }">{{ deptName(item.departmentId) }}</template>
    <template #[`item.sections`]="{ item }">
      <v-chip
        v-for="s in item.sections"
        :key="s.id"
        size="small"
        class="mr-1 my-1"
        :closable="can('class_section.delete')"
        @click="can('class_section.update') && openSection(item, s)"
        @click:close="removeSection(s)"
      >
        {{ s.name
        }}<span v-if="s.capacity" class="text-medium-emphasis ml-1">({{ s.capacity }})</span>
      </v-chip>
      <v-btn
        v-if="can('class_section.create')"
        size="x-small"
        variant="tonal"
        icon="mdi-plus"
        title="Add section"
        @click="openSection(item)"
      />
    </template>
    <template #[`item.actions`]="{ item }">
      <v-menu v-if="canMessage">
        <template #activator="{ props: menu }">
          <v-btn
            v-bind="menu"
            size="small"
            variant="text"
            icon="mdi-message-text-outline"
            title="Message guardians"
            :data-testid="`message-class-${item.code}`"
          />
        </template>
        <v-list density="compact">
          <v-list-subheader>Message guardians of</v-list-subheader>
          <v-list-item :to="messageLink('program', item.id)" :title="`All of ${item.name}`" />
          <v-list-item
            v-for="s in item.sections"
            :key="s.id"
            :to="messageLink('class_section', s.id)"
            :title="`Section ${s.name}`"
          />
        </v-list>
      </v-menu>
      <v-btn
        v-if="can('program.update')"
        size="small"
        variant="text"
        icon="mdi-pencil"
        @click="openClass(item)"
      />
      <v-btn
        v-if="can('program.delete')"
        size="small"
        variant="text"
        color="error"
        icon="mdi-delete-outline"
        @click="removeClass(item)"
      />
    </template>
    <template #no-data>
      <div class="pa-6 text-center">
        No classes yet. Click <b>Add classes &amp; sections</b> to set up e.g. Class 1–10 with
        sections A and B in one step.
      </div>
    </template>
  </v-data-table>

  <v-dialog v-model="bulk.open" max-width="720" scrollable>
    <v-card title="Add classes & sections">
      <v-card-text>
        <v-alert v-if="bulk.error" type="error" density="compact" class="mb-3">
          {{ bulk.error }}
        </v-alert>
        <div class="mb-2 text-body-2">Quick fill:</div>
        <div class="d-flex flex-wrap ga-2 mb-4">
          <v-btn
            v-for="(_, name) in PRESETS"
            :key="name"
            size="small"
            variant="outlined"
            @click="applyPreset(name)"
          >
            {{ name }}
          </v-btn>
        </div>
        <v-row dense>
          <v-col cols="12" md="6">
            <v-textarea
              v-model="bulk.classes"
              label="Classes (one per line)"
              rows="7"
              hint="e.g. Class 1, Class 2 … or B.Com, BBA"
              persistent-hint
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="bulk.sections"
              label="Sections in every class"
              hint="Comma separated, e.g. A, B, C"
              persistent-hint
              class="mb-3"
            />
            <v-text-field
              v-model.number="bulk.capacity"
              type="number"
              label="Seats per section"
              class="mb-1"
            />
            <v-select v-model="bulk.level" :items="levels" label="Level" class="mb-1" />
            <v-select
              v-if="departments.length"
              v-model="bulk.departmentId"
              :items="departments"
              item-title="name"
              item-value="id"
              label="Department / wing"
            />
            <v-text-field
              v-else
              v-model="bulk.newDepartment"
              label="Department / wing (will be created)"
            />
          </v-col>
        </v-row>
        <v-alert type="info" variant="tonal" density="compact" class="mt-2">
          Will set up <b>{{ bulkPreview.classes }}</b> classes ×
          {{ splitList(bulk.sections).length }} sections =
          <b>{{ bulkPreview.sections }}</b> sections ({{ bulkPreview.seats }} seats) for
          {{ academicYear }}. Existing classes and sections are reused, not duplicated.
        </v-alert>
        <div v-if="bulk.progress" class="text-caption mt-2">{{ bulk.progress }}</div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="bulk.saving" @click="bulk.open = false">Cancel</v-btn>
        <v-btn color="primary" :loading="bulk.saving" @click="saveBulk">Create</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="cls.open" max-width="480">
    <v-card title="Edit class">
      <v-card-text>
        <v-alert v-if="cls.error" type="error" density="compact" class="mb-3">
          {{ cls.error }}
        </v-alert>
        <v-text-field v-model="cls.name" label="Name" />
        <v-text-field v-model="cls.code" label="Code" />
        <v-select v-model="cls.level" :items="levels" label="Level" />
        <v-text-field
          v-model.number="cls.durationMonths"
          type="number"
          label="Duration (months, optional)"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="cls.open = false">Cancel</v-btn>
        <v-btn color="primary" :loading="cls.saving" @click="saveClass">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="sec.open" max-width="480">
    <v-card :title="sec.id ? 'Edit section' : 'Add section'">
      <v-card-text>
        <v-alert v-if="sec.error" type="error" density="compact" class="mb-3">
          {{ sec.error }}
        </v-alert>
        <v-text-field v-model="sec.name" label="Section name" hint="e.g. Class 1 C" />
        <v-text-field
          v-model="sec.code"
          label="Code (optional)"
          :placeholder="sectionCode(sec.programCode, sec.name.trim().split(/\s+/).pop() ?? '')"
        />
        <v-text-field v-model.number="sec.capacity" type="number" label="Seats" />
        <div class="text-caption">Academic year: {{ academicYear }}</div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="sec.open = false">Cancel</v-btn>
        <v-btn color="primary" :loading="sec.saving" @click="saveSection">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

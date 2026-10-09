<script setup lang="ts">
import {
  ADMISSION_TRANSITIONS,
  type AdmissionApplicationDto,
  type AdmissionStatus,
  type ApiListResponse,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
interface Option {
  id: string;
  name: string;
  code?: string;
  institutionId?: string;
}
const auth = useAuthStore();
const route = useRoute();
const studentsBase = computed(() => route.path.replace(/\/admissions.*$/, '/students'));
const notice = ref<string | null>(null);
const items = ref<AdmissionApplicationDto[]>([]);
const total = ref(0);
const page = ref(1);
const error = ref<string | null>(null);
const loading = ref(false);
const createOpen = ref(false);
const programs = ref<Option[]>([]);
const classes = ref<Option[]>([]);
const filters = reactive({ status: '', search: '' });
const form = reactive({
  institutionId: '',
  programId: '',
  classSectionId: '',
  academicYear: '2026-27',
  applicantFirstName: '',
  applicantLastName: '',
  guardianName: '',
  guardianRelation: 'FATHER',
  guardianPhone: '',
});
const headers = [
  { title: 'No', key: 'applicationNo' },
  { title: 'Applicant', key: 'applicantDisplayName' },
  { title: 'Year', key: 'academicYear' },
  { title: 'Guardian', key: 'guardianName' },
  { title: 'Status', key: 'status' },
  { title: 'Remarks', key: 'decisionComment', sortable: false },
  { title: 'Actions', key: 'actions', sortable: false },
];
function query() {
  const p = new URLSearchParams({ page: String(page.value), pageSize: '25' });
  if (filters.status) p.set('status', filters.status);
  if (filters.search) p.set('search', filters.search);
  return p;
}
async function load() {
  loading.value = true;
  try {
    const r = await apiFetch<ApiListResponse<AdmissionApplicationDto>>(
      `/api/v1/admissions?${query()}`,
    );
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function loadOptions() {
  programs.value = (await apiFetch<ApiListResponse<Option>>('/api/v1/programs?pageSize=100')).data;
  classes.value = (
    await apiFetch<ApiListResponse<Option>>('/api/v1/class-sections?pageSize=100')
  ).data;
}
async function act(fn: () => Promise<unknown>) {
  error.value = null;
  try {
    await fn();
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    return false;
  }
}
async function createAdmission() {
  const program = programs.value.find((p) => p.id === form.programId);
  const ok = await act(() =>
    apiFetch('/api/v1/admissions', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        institutionId: form.institutionId || program?.institutionId,
        classSectionId: form.classSectionId || null,
        guardianPhone: form.guardianPhone || null,
      }),
    }),
  );
  if (!ok) return;
  createOpen.value = false;
  await load();
}
type Move = Exclude<AdmissionStatus, 'DRAFT' | 'ENROLLED'>;
const STATUS_COLORS: Partial<Record<AdmissionStatus, string>> = {
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  WAITLISTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
  ENROLLED: 'primary',
};
/** Buttons offered for an application, derived from the same transition map the API enforces. */
function actionsFor(a: AdmissionApplicationDto) {
  const next = ADMISSION_TRANSITIONS[a.status];
  const out: Array<{ label: string; to: Move | 'ENROLLED'; color?: string; confirm?: boolean }> =
    [];
  if (next.includes('SUBMITTED')) out.push({ label: 'Submit', to: 'SUBMITTED' });
  if (next.includes('UNDER_REVIEW'))
    out.push(
      a.status === 'REJECTED'
        ? { label: 'Reopen', to: 'UNDER_REVIEW', color: 'primary', confirm: true }
        : { label: a.status === 'WAITLISTED' ? 'Back to review' : 'Review', to: 'UNDER_REVIEW' },
    );
  if (next.includes('WAITLISTED')) out.push({ label: 'Waitlist', to: 'WAITLISTED' });
  if (next.includes('APPROVED')) out.push({ label: 'Approve', to: 'APPROVED', color: 'success' });
  if (next.includes('ENROLLED')) out.push({ label: 'Enroll', to: 'ENROLLED', color: 'primary' });
  if (next.includes('REJECTED'))
    out.push({ label: 'Reject', to: 'REJECTED', color: 'error', confirm: true });
  return out;
}

const confirm = reactive({
  open: false,
  kind: 'REJECTED' as 'REJECTED' | 'UNDER_REVIEW' | 'DELETE',
  item: null as AdmissionApplicationDto | null,
  comment: '',
  busy: false,
});
const CONFIRM_TEXT = {
  REJECTED: {
    title: 'Reject application',
    body: 'The application can be reopened later if this was a mistake.',
    button: 'Reject',
    color: 'error',
  },
  UNDER_REVIEW: {
    title: 'Reopen application',
    body: 'Moves the application back to Under review so it can be approved and enrolled.',
    button: 'Reopen',
    color: 'primary',
  },
  DELETE: {
    title: 'Delete application',
    body: 'Removes the application from the list. Enrolled applications cannot be deleted.',
    button: 'Delete',
    color: 'error',
  },
} as const;
function ask(kind: typeof confirm.kind, item: AdmissionApplicationDto) {
  error.value = null;
  Object.assign(confirm, { open: true, kind, item, comment: '', busy: false });
}
async function runConfirm() {
  const a = confirm.item;
  if (!a) return;
  confirm.busy = true;
  const ok =
    confirm.kind === 'DELETE'
      ? await act(() => apiFetch(`/api/v1/admissions/${a.id}`, { method: 'DELETE' }))
      : await act(() => move(a, confirm.kind as Move, confirm.comment));
  confirm.busy = false;
  if (!ok) return;
  confirm.open = false;
  notice.value = `${a.applicationNo} ${
    confirm.kind === 'DELETE' ? 'deleted' : confirm.kind === 'REJECTED' ? 'rejected' : 'reopened'
  }`;
  await load();
}
function move(a: AdmissionApplicationDto, status: Move, comment?: string) {
  return apiFetch(`/api/v1/admissions/${a.id}/transition`, {
    method: 'POST',
    body: JSON.stringify({ status, ...(comment?.trim() ? { comment: comment.trim() } : {}) }),
  });
}
async function perform(a: AdmissionApplicationDto, action: ReturnType<typeof actionsFor>[number]) {
  if (action.to === 'ENROLLED') return openEnroll(a);
  if (action.confirm) return ask(action.to as 'REJECTED' | 'UNDER_REVIEW', a);
  error.value = null;
  if (await act(() => move(a, action.to as Move))) {
    notice.value = `${a.applicationNo} moved to ${action.to.replace('_', ' ').toLowerCase()}`;
    await load();
  }
}

const enrollForm = reactive({
  open: false,
  item: null as AdmissionApplicationDto | null,
  classSectionId: '',
  rollNo: '',
  busy: false,
});
const enrollClasses = computed(() =>
  classes.value.filter(
    (c) =>
      !enrollForm.item || !c.institutionId || c.institutionId === enrollForm.item.institutionId,
  ),
);
function openEnroll(a: AdmissionApplicationDto) {
  error.value = null;
  Object.assign(enrollForm, {
    open: true,
    item: a,
    classSectionId: a.classSectionId ?? '',
    rollNo: '',
    busy: false,
  });
}
async function enroll() {
  const a = enrollForm.item;
  if (!a) return;
  enrollForm.busy = true;
  const ok = await act(() =>
    apiFetch(`/api/v1/admissions/${a.id}/enroll`, {
      method: 'POST',
      body: JSON.stringify({
        classSectionId: enrollForm.classSectionId,
        ...(enrollForm.rollNo.trim() ? { rollNo: enrollForm.rollNo.trim() } : {}),
      }),
    }),
  );
  enrollForm.busy = false;
  if (!ok) return;
  enrollForm.open = false;
  notice.value = `${a.applicantDisplayName} enrolled as a student`;
  await load();
}
onMounted(async () => {
  await Promise.all([load(), loadOptions()]);
});
watch([page, () => filters.status], load);
</script>
<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Admissions</h2>
    <v-spacer /><v-btn
      v-if="auth.can('admission.manage')"
      color="primary"
      prepend-icon="mdi-plus"
      @click="((error = null), (createOpen = true))"
      >New application</v-btn
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert
  ><v-select
    v-model="filters.status"
    :items="[
      'DRAFT',
      'SUBMITTED',
      'UNDER_REVIEW',
      'APPROVED',
      'REJECTED',
      'WAITLISTED',
      'ENROLLED',
    ]"
    label="Status"
    density="compact"
    clearable
    class="mb-2"
  /><v-data-table-server
    :headers="headers"
    :items="items"
    :items-length="total"
    :page="page"
    :loading="loading"
    @update:page="page = $event"
    ><template #[`item.status`]="{ item }"
      ><v-chip size="small" :color="STATUS_COLORS[item.status]">{{
        item.status.replace('_', ' ')
      }}</v-chip></template
    ><template #[`item.decisionComment`]="{ item }"
      ><span class="text-medium-emphasis text-body-2">{{
        item.decisionComment ?? ''
      }}</span></template
    ><template #[`item.actions`]="{ item }"
      ><div class="d-flex flex-wrap ga-1 py-1">
        <template v-if="auth.can('admission.manage')"
          ><v-btn
            v-for="a in actionsFor(item)"
            :key="a.label"
            size="small"
            variant="text"
            :color="a.color"
            @click="perform(item, a)"
            >{{ a.label }}</v-btn
          ><v-btn
            v-if="item.status !== 'ENROLLED'"
            size="small"
            variant="text"
            color="error"
            icon="mdi-delete-outline"
            :aria-label="`Delete ${item.applicationNo}`"
            title="Delete"
            @click="ask('DELETE', item)"
        /></template>
        <v-btn
          v-if="item.status === 'ENROLLED' && item.studentId && auth.can('student.view')"
          size="small"
          variant="text"
          :to="`${studentsBase}/${item.studentId}`"
          >View student</v-btn
        >
      </div></template
    ></v-data-table-server
  ><v-dialog v-model="createOpen" max-width="640"
    ><v-card
      ><v-card-title>Application</v-card-title
      ><v-card-text
        ><v-alert v-if="error" type="error" density="compact" class="mb-3">{{ error }}</v-alert
        ><v-autocomplete
          v-model="form.programId"
          :items="programs"
          item-title="name"
          item-value="id"
          label="Program" /><v-autocomplete
          v-model="form.classSectionId"
          :items="classes"
          item-title="name"
          item-value="id"
          label="Desired class"
          clearable /><v-text-field
          v-model="form.academicYear"
          label="Academic year" /><v-text-field
          v-model="form.applicantFirstName"
          label="Applicant first name" /><v-text-field
          v-model="form.applicantLastName"
          label="Applicant last name" /><v-text-field
          v-model="form.guardianName"
          label="Guardian name" /><v-select
          v-model="form.guardianRelation"
          :items="['FATHER', 'MOTHER', 'GUARDIAN', 'OTHER']"
          label="Guardian relation" /><v-text-field
          v-model="form.guardianPhone"
          label="Guardian phone" /></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="createOpen = false">Cancel</v-btn
        ><v-btn color="primary" @click="createAdmission">Create</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  ><v-dialog v-model="confirm.open" max-width="480"
    ><v-card v-if="confirm.item"
      ><v-card-title>{{ CONFIRM_TEXT[confirm.kind].title }}</v-card-title
      ><v-card-text
        ><v-alert v-if="error" type="error" density="compact" class="mb-3">{{ error }}</v-alert>
        <p class="mb-3">
          <strong>{{ confirm.item.applicationNo }}</strong> ·
          {{ confirm.item.applicantDisplayName }}
        </p>
        <p class="mb-3 text-medium-emphasis">{{ CONFIRM_TEXT[confirm.kind].body }}</p>
        <v-textarea
          v-if="confirm.kind !== 'DELETE'"
          v-model="confirm.comment"
          label="Reason (optional)"
          rows="2"
          auto-grow /></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="confirm.open = false">Cancel</v-btn
        ><v-btn
          :color="CONFIRM_TEXT[confirm.kind].color"
          :loading="confirm.busy"
          @click="runConfirm"
          >{{ CONFIRM_TEXT[confirm.kind].button }}</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  ><v-dialog v-model="enrollForm.open" max-width="480"
    ><v-card v-if="enrollForm.item"
      ><v-card-title>Enroll {{ enrollForm.item.applicantDisplayName }}</v-card-title
      ><v-card-text
        ><v-alert v-if="error" type="error" density="compact" class="mb-3">{{ error }}</v-alert
        ><v-autocomplete
          v-model="enrollForm.classSectionId"
          :items="enrollClasses"
          item-title="name"
          item-value="id"
          label="Class section"
          :rules="[(v: string) => !!v || 'Pick the class to enroll into']" /><v-text-field
          v-model="enrollForm.rollNo"
          label="Roll no (optional)" /></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="enrollForm.open = false">Cancel</v-btn
        ><v-btn
          color="primary"
          :disabled="!enrollForm.classSectionId"
          :loading="enrollForm.busy"
          @click="enroll"
          >Enroll</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  ><v-snackbar :model-value="!!notice" color="success" @update:model-value="notice = null">{{
    notice
  }}</v-snackbar>
</template>

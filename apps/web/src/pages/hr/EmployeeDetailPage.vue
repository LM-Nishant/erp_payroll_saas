<script setup lang="ts">
import {
  EXIT_TYPES,
  type ApiListResponse,
  type DocumentDto,
  type EmployeeChecklistItemDto,
  type EmployeeDetailDto,
  type EmployeeHistoryDto,
  type EmployeeMovementDto,
  type EmployeeProfileChangeRequestDto,
  type EmployeeSalaryRevisionDto,
  type EmployeeSensitiveDto,
  type SignedUrlDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import EmployeeLoginCard from '@/components/EmployeeLoginCard.vue';
import DraftWithAiButton from '@/components/ai/DraftWithAiButton.vue';
import ProfilePhotoCard from '@/components/ProfilePhotoCard.vue';
import { canRegeneratePdf, regeneratePdf, REGENERATE_CONFIRM } from '@/api/pdf';
import { useAuthStore } from '@/stores/auth';
import EmployeeFormDialog from './EmployeeFormDialog.vue';
import MovementDialog from './MovementDialog.vue';
import { label, STATUS_COLORS, todayIso, type Option } from './useHrOptions';

const props = defineProps<{ id: string }>();
const auth = useAuthStore();

const employee = ref<EmployeeDetailDto | null>(null);
const tab = ref('profile');
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const history = ref<EmployeeHistoryDto | null>(null);
const movements = ref<EmployeeMovementDto[]>([]);
const salary = ref<EmployeeSalaryRevisionDto[]>([]);
const checklist = ref<EmployeeChecklistItemDto[]>([]);
const documents = ref<DocumentDto[]>([]);
const changeRequests = ref<EmployeeProfileChangeRequestDto[]>([]);
const revealed = ref<EmployeeSensitiveDto | null>(null);

const base = computed(() => `/api/v1/employees/${props.id}`);
const fail = (e: unknown) => {
  error.value = (e as Error).message;
};

async function loadEmployee() {
  try {
    employee.value = (await apiFetch<{ data: EmployeeDetailDto }>(base.value)).data;
  } catch (e) {
    fail(e);
  }
}

/** Names for historical assignment ids (old institutions / departments stay referenced). */
const names = ref(new Map<string, string>());
async function loadNames() {
  const lists = await Promise.all(
    ['/api/v1/institutions?pageSize=100', '/api/v1/departments?pageSize=100'].map((p) =>
      apiFetch<ApiListResponse<Option>>(p).then(
        (r) => r.data,
        () => [] as Option[],
      ),
    ),
  );
  names.value = new Map(lists.flat().map((o) => [o.id, o.name]));
}
const nameOf = (id: string | null) => (id ? (names.value.get(id) ?? id) : '—');

async function loadTab(name: string) {
  try {
    if (name === 'history') {
      if (!names.value.size) await loadNames();
      history.value = (await apiFetch<{ data: EmployeeHistoryDto }>(`${base.value}/history`)).data;
    } else if (name === 'movements') {
      movements.value = (
        await apiFetch<{ data: EmployeeMovementDto[] }>(`${base.value}/movements`)
      ).data;
    } else if (name === 'salary') {
      salary.value = (
        await apiFetch<{ data: EmployeeSalaryRevisionDto[] }>(`${base.value}/salary`)
      ).data;
    } else if (name === 'checklist') {
      checklist.value = (
        await apiFetch<{ data: EmployeeChecklistItemDto[] }>(`${base.value}/checklist`)
      ).data;
    } else if (name === 'documents') {
      documents.value = (
        await apiFetch<ApiListResponse<DocumentDto>>(
          `/api/v1/documents?ownerType=employee&ownerId=${props.id}&pageSize=100`,
        )
      ).data;
    } else if (name === 'requests') {
      changeRequests.value = (
        await apiFetch<{ data: EmployeeProfileChangeRequestDto[] }>(`${base.value}/change-requests`)
      ).data;
    }
  } catch (e) {
    fail(e);
  }
}

async function refresh() {
  await loadEmployee();
  await loadTab(tab.value);
}
onMounted(refresh);
watch(tab, (t) => void loadTab(t));
watch(
  () => props.id,
  () => {
    revealed.value = null;
    void refresh();
  },
);

/* ---- sensitive reveal (audited server-side) ---- */
async function reveal() {
  try {
    revealed.value = (
      await apiFetch<{ data: EmployeeSensitiveDto }>(`${base.value}/sensitive/reveal`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Viewed from employee profile' }),
      })
    ).data;
  } catch (e) {
    fail(e);
  }
}
const sensitive = computed(() => revealed.value ?? employee.value?.profile.sensitive ?? null);
const sensitiveRows = computed(() => {
  const s = sensitive.value;
  if (!s) return [];
  return [
    ['PAN', s.pan],
    ['Aadhaar', s.aadhaar],
    ['UAN', s.uan],
    ['ESIC number', s.esicNumber],
    ['PF number', s.pfNumber],
    [
      'Bank account',
      s.bankAccount
        ? `${s.bankAccount.accountNumber} · ${s.bankAccount.ifsc} · ${s.bankAccount.accountHolderName}`
        : null,
    ],
  ] as Array<[string, string | null]>;
});

/* ---- statutory / personal edit ---- */
const profileOpen = ref(false);
const profileForm = reactive({
  dateOfBirth: '',
  gender: null as string | null,
  personalEmail: '',
  personalPhone: '',
  pan: '',
  aadhaar: '',
  uan: '',
  esicNumber: '',
  pfNumber: '',
  accountHolderName: '',
  accountNumber: '',
  ifsc: '',
  bankName: '',
});
function openProfile() {
  const p = employee.value?.profile.personal;
  Object.assign(profileForm, {
    dateOfBirth: p?.dateOfBirth ?? '',
    gender: p?.gender ?? null,
    personalEmail: p?.personalEmail ?? '',
    personalPhone: p?.personalPhone ?? '',
    pan: '',
    aadhaar: '',
    uan: '',
    esicNumber: '',
    pfNumber: '',
    accountHolderName: '',
    accountNumber: '',
    ifsc: '',
    bankName: '',
  });
  profileOpen.value = true;
}
async function saveProfile() {
  const f = profileForm;
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);
  // Blank sensitive inputs keep the stored (encrypted) value.
  const sensitiveInput = Object.fromEntries(
    (['pan', 'aadhaar', 'uan', 'esicNumber', 'pfNumber'] as const)
      .map((k) => [k, opt(f[k])])
      .filter(([, v]) => v !== undefined),
  );
  if (f.accountNumber.trim()) {
    sensitiveInput.bankAccount = {
      accountHolderName: f.accountHolderName.trim(),
      accountNumber: f.accountNumber.trim(),
      ifsc: f.ifsc.trim(),
      bankName: opt(f.bankName) ?? null,
    };
  }
  try {
    await apiFetch(`${base.value}/profile`, {
      method: 'PUT',
      body: JSON.stringify({
        personal: {
          dateOfBirth: opt(f.dateOfBirth) ?? null,
          gender: f.gender,
          personalEmail: opt(f.personalEmail) ?? null,
          personalPhone: opt(f.personalPhone) ?? null,
        },
        ...(Object.keys(sensitiveInput).length ? { sensitive: sensitiveInput } : {}),
      }),
    });
    profileOpen.value = false;
    revealed.value = null;
    await loadEmployee();
  } catch (e) {
    fail(e);
  }
}

/* ---- lifecycle ---- */
type LifecycleAction =
  'onboard' | 'activate' | 'confirm' | 'resign' | 'withdraw-resignation' | 'exit' | 'rehire';
const lifecycle = reactive({
  open: false,
  action: 'activate' as LifecycleAction,
  date: todayIso(),
  lastWorkingDate: todayIso(),
  exitType: 'RESIGNATION' as (typeof EXIT_TYPES)[number],
  reason: '',
  force: false,
});
const actions = computed<Array<{ action: LifecycleAction; title: string }>>(() => {
  const s = employee.value?.status;
  const list: Array<{ action: LifecycleAction; title: string }> = [];
  if (s === 'DRAFT') list.push({ action: 'onboard', title: 'Start onboarding' });
  if (s === 'DRAFT' || s === 'ONBOARDING') list.push({ action: 'activate', title: 'Activate' });
  if (s === 'ACTIVE' && !employee.value?.confirmationDate)
    list.push({ action: 'confirm', title: 'Confirm (probation)' });
  if (s === 'ACTIVE' || s === 'ONBOARDING')
    list.push({ action: 'resign', title: 'Record resignation' });
  if (s === 'ON_NOTICE')
    list.push({ action: 'withdraw-resignation', title: 'Withdraw resignation' });
  if (s && s !== 'EXITED' && s !== 'DRAFT') list.push({ action: 'exit', title: 'Exit' });
  if (s === 'EXITED') list.push({ action: 'rehire', title: 'Rehire' });
  return list;
});
function openLifecycle(action: LifecycleAction) {
  Object.assign(lifecycle, {
    open: true,
    action,
    date: todayIso(),
    lastWorkingDate: employee.value?.lastWorkingDate ?? todayIso(),
    exitType: 'RESIGNATION',
    reason: '',
    force: false,
  });
}
async function runLifecycle() {
  const l = lifecycle;
  const reason = l.reason.trim() || undefined;
  const bodies: Record<LifecycleAction, Record<string, unknown>> = {
    onboard: { dateOfJoining: l.date },
    activate: { dateOfJoining: l.date },
    confirm: { confirmationDate: l.date },
    resign: { resignationDate: l.date, lastWorkingDate: l.lastWorkingDate, reason: l.reason },
    'withdraw-resignation': { reason },
    exit: { exitDate: l.date, exitType: l.exitType, reason, force: l.force },
    rehire: { dateOfJoining: l.date, reason },
  };
  try {
    employee.value = (
      await apiFetch<{ data: EmployeeDetailDto }>(`${base.value}/${l.action}`, {
        method: 'POST',
        body: JSON.stringify(bodies[l.action]),
      })
    ).data;
    lifecycle.open = false;
    await loadTab(tab.value);
  } catch (e) {
    fail(e);
  }
}
const dateLabel = computed(
  () =>
    ({
      onboard: 'Date of joining',
      activate: 'Date of joining',
      confirm: 'Confirmation date',
      resign: 'Resignation date',
      'withdraw-resignation': '',
      exit: 'Exit date',
      rehire: 'Date of joining',
    })[lifecycle.action],
);

async function setChecklist(item: EmployeeChecklistItemDto, status: 'DONE' | 'WAIVED' | 'PENDING') {
  try {
    await apiFetch(`${base.value}/checklist/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await loadTab('checklist');
  } catch (e) {
    fail(e);
  }
}

/* ---- movements ---- */
const movementOpen = ref(false);
async function onMovement(m: EmployeeMovementDto) {
  notice.value =
    m.status === 'PENDING_APPROVAL'
      ? 'Movement submitted for approval.'
      : m.status === 'SCHEDULED'
        ? `Movement scheduled for ${m.effectiveDate}.`
        : 'Movement applied.';
  tab.value = 'movements';
  await refresh();
}
async function cancelMovement(m: EmployeeMovementDto) {
  try {
    await apiFetch(`${base.value}/movements/${m.id}/cancel`, { method: 'POST', body: '{}' });
    await loadTab('movements');
  } catch (e) {
    fail(e);
  }
}

/* ---- salary history (immutable revisions) ---- */
const salaryOpen = ref(false);
const salaryForm = reactive({
  effectiveFrom: todayIso(),
  annualCtc: 0,
  amounts: '{"basic": 0}',
  revisionReason: '',
});
async function saveSalary() {
  try {
    await apiFetch(`${base.value}/salary`, {
      method: 'POST',
      body: JSON.stringify({
        effectiveFrom: salaryForm.effectiveFrom,
        annualCtc: Number(salaryForm.annualCtc),
        amounts: JSON.parse(salaryForm.amounts || '{}'),
        revisionReason: salaryForm.revisionReason,
      }),
    });
    salaryOpen.value = false;
    await loadTab('salary');
  } catch (e) {
    fail(e);
  }
}

/* ---- letters (stored as employee documents) ---- */
const letter = reactive({ open: false, type: 'offer' as 'offer' | 'experience' | 'relieving' });
const aiLetter = ref<{ subject: string; body: string } | null>(null);
const aiLetterVars = computed((): Record<string, string> => {
  const e = employee.value;
  if (!e) return {};
  return {
    employeeName: e.displayName,
    employeeCode: e.employeeCode,
    designation: e.designation?.name ?? '',
    department: e.department?.name ?? '',
    institution: e.institution?.name ?? '',
    dateOfJoining: e.dateOfJoining ?? '',
  };
});
async function copyAiLetter() {
  if (aiLetter.value)
    await navigator.clipboard.writeText(`${aiLetter.value.subject}\n\n${aiLetter.value.body}`);
}
async function generateLetter() {
  try {
    const doc = (
      await apiFetch<{ data: DocumentDto }>(`${base.value}/letters`, {
        method: 'POST',
        body: JSON.stringify({ type: letter.type }),
      })
    ).data;
    letter.open = false;
    notice.value = `${label(letter.type)} letter generated.`;
    tab.value = 'documents';
    await loadTab('documents');
    await download(doc);
  } catch (e) {
    fail(e);
  }
}
async function regenerate(doc: DocumentDto) {
  if (!confirm(REGENERATE_CONFIRM)) return;
  try {
    const res = await regeneratePdf(doc);
    notice.value = `"${doc.title}" regenerated with the current branding (version ${res.version.versionNumber}).`;
    await loadTab('documents');
  } catch (e) {
    fail(e);
  }
}
async function download(doc: DocumentDto) {
  try {
    const res = await apiFetch<{ data: SignedUrlDto }>(`/api/v1/documents/${doc.id}/download-url`, {
      method: 'POST',
      body: '{}',
    });
    window.open(res.data.url, '_blank', 'noopener');
  } catch (e) {
    fail(e);
  }
}

const editOpen = ref(false);
const exitTypes = EXIT_TYPES.map((value) => ({ value, title: label(value) }));
const personalRows = computed(() => {
  const p = employee.value?.profile.personal;
  if (!p) return [];
  return [
    ['Date of birth', p.dateOfBirth],
    ['Gender', p.gender ? label(p.gender) : null],
    ['Marital status', p.maritalStatus ? label(p.maritalStatus) : null],
    ['Blood group', p.bloodGroup],
    ['Personal email', p.personalEmail],
    ['Personal phone', p.personalPhone],
    ['Emergency contacts', p.emergencyContacts?.map((c) => `${c.name} (${c.phone})`).join(', ')],
    ['Qualifications', p.qualifications?.map((q) => q.degree).join(', ')],
  ] as Array<[string, string | null | undefined]>;
});
</script>

<template>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-alert v-if="notice" type="success" closable class="mb-4" @click:close="notice = null">
    {{ notice }}
  </v-alert>
  <template v-if="employee">
    <div class="d-flex align-center flex-wrap ga-2 mb-2">
      <v-btn icon="mdi-arrow-left" variant="text" :to="{ name: 'hr-employees' }" />
      <ProfilePhotoCard
        :key="employee.id"
        :base-path="`/api/v1/employees/${employee.id}`"
        :editable="auth.can('employee.update')"
        :size="64"
      />
      <div>
        <h2 class="text-h5">{{ employee.displayName }}</h2>
        <div class="text-medium-emphasis">
          {{ employee.employeeCode }} · {{ employee.designation?.name ?? 'No designation' }} ·
          {{ employee.institution?.name }}
          <span v-if="employee.department"> / {{ employee.department.name }}</span>
        </div>
      </div>
      <v-chip class="ml-2" :color="STATUS_COLORS[employee.status]">{{
        label(employee.status)
      }}</v-chip>
      <v-spacer />
      <v-btn v-if="auth.can('employee.update')" variant="tonal" @click="editOpen = true">
        Edit
      </v-btn>
      <v-btn
        v-if="auth.can('employee.transfer') && employee.status !== 'EXITED'"
        variant="tonal"
        prepend-icon="mdi-swap-horizontal"
        @click="movementOpen = true"
      >
        Transfer / move
      </v-btn>
      <v-btn variant="tonal" prepend-icon="mdi-file-document" @click="letter.open = true">
        Letters
      </v-btn>
      <v-menu v-if="auth.can('employee.lifecycle') && actions.length">
        <template #activator="{ props: menuProps }">
          <v-btn v-bind="menuProps" color="primary" append-icon="mdi-menu-down">Lifecycle</v-btn>
        </template>
        <v-list density="compact">
          <v-list-item
            v-for="a in actions"
            :key="a.action"
            :title="a.title"
            @click="openLifecycle(a.action)"
          />
        </v-list>
      </v-menu>
    </div>

    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="profile">Profile</v-tab>
      <v-tab value="history">Positions & history</v-tab>
      <v-tab value="movements">Movements</v-tab>
      <v-tab v-if="auth.can('salary.view')" value="salary">Salary history</v-tab>
      <v-tab value="checklist">Checklist</v-tab>
      <v-tab value="documents">Documents</v-tab>
      <v-tab value="requests">Change requests</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="profile">
        <v-row>
          <v-col cols="12" md="6">
            <v-card title="Employment">
              <v-table density="compact">
                <tbody>
                  <tr>
                    <td>Employment type</td>
                    <td>{{ label(employee.employmentType) }}</td>
                  </tr>
                  <tr>
                    <td>Date of joining</td>
                    <td>{{ employee.dateOfJoining ?? '—' }}</td>
                  </tr>
                  <tr>
                    <td>Probation ends</td>
                    <td>{{ employee.probationEndDate ?? '—' }}</td>
                  </tr>
                  <tr>
                    <td>Confirmed on</td>
                    <td>{{ employee.confirmationDate ?? '—' }}</td>
                  </tr>
                  <tr>
                    <td>Reporting manager</td>
                    <td>{{ employee.reportingManager?.displayName ?? '—' }}</td>
                  </tr>
                  <tr>
                    <td>Secondary departments</td>
                    <td>
                      {{ employee.secondaryDepartments.map((d) => d.name).join(', ') || '—' }}
                    </td>
                  </tr>
                  <tr>
                    <td>Work email / phone</td>
                    <td>{{ employee.workEmail ?? '—' }} / {{ employee.workPhone ?? '—' }}</td>
                  </tr>
                  <tr v-if="employee.lastWorkingDate">
                    <td>Last working date</td>
                    <td>{{ employee.lastWorkingDate }}</td>
                  </tr>
                  <tr v-if="employee.exitDate">
                    <td>Exit</td>
                    <td>{{ employee.exitDate }} ({{ label(employee.exitType ?? 'OTHER') }})</td>
                  </tr>
                </tbody>
              </v-table>
            </v-card>
          </v-col>
          <v-col cols="12" md="6">
            <v-card title="Personal">
              <template #append>
                <v-btn
                  v-if="auth.can('employee.update')"
                  size="small"
                  variant="text"
                  @click="openProfile"
                >
                  Edit
                </v-btn>
              </template>
              <v-table density="compact">
                <tbody>
                  <tr v-for="[k, v] in personalRows" :key="k">
                    <td>{{ k }}</td>
                    <td>{{ v || '—' }}</td>
                  </tr>
                </tbody>
              </v-table>
            </v-card>
            <v-card title="Statutory & bank (protected)" class="mt-4">
              <template #append>
                <v-btn
                  v-if="auth.can('employee.view_sensitive') && !revealed"
                  size="small"
                  variant="text"
                  prepend-icon="mdi-eye"
                  @click="reveal"
                >
                  Reveal
                </v-btn>
                <v-btn v-else-if="revealed" size="small" variant="text" @click="revealed = null">
                  Hide
                </v-btn>
              </template>
              <v-card-subtitle v-if="!revealed"> Masked. Revealing is audited. </v-card-subtitle>
              <v-table density="compact">
                <tbody>
                  <tr v-for="[k, v] in sensitiveRows" :key="k">
                    <td>{{ k }}</td>
                    <td class="font-weight-medium">{{ v ?? '—' }}</td>
                  </tr>
                </tbody>
              </v-table>
            </v-card>
          </v-col>
          <v-col cols="12" md="6">
            <EmployeeLoginCard :employee="employee" @changed="loadEmployee" />
          </v-col>
        </v-row>
      </v-window-item>

      <v-window-item value="history">
        <template v-if="history">
          <h3 class="text-subtitle-1 mb-2">Positions</h3>
          <v-table density="compact" class="mb-6">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Designation</th>
                <th>Type</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in history.positions" :key="p.id">
                <td>{{ p.effectiveFrom }}</td>
                <td>{{ p.effectiveTo ?? 'current' }}</td>
                <td>{{ p.designationName ?? '—' }}</td>
                <td>{{ label(p.employmentType) }}</td>
                <td>{{ p.reason ?? '' }}</td>
              </tr>
            </tbody>
          </v-table>
          <h3 class="text-subtitle-1 mb-2">Institution / department assignments</h3>
          <v-table density="compact" class="mb-6">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Institution</th>
                <th>Department</th>
                <th>Primary</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in history.departments" :key="d.id">
                <td>{{ d.effectiveFrom }}</td>
                <td>{{ d.effectiveTo ?? 'current' }}</td>
                <td>{{ nameOf(d.institutionId) }}</td>
                <td>{{ nameOf(d.departmentId) }}</td>
                <td>{{ d.isPrimary ? 'Yes' : 'Secondary' }}</td>
              </tr>
            </tbody>
          </v-table>
          <h3 class="text-subtitle-1 mb-2">Reporting managers</h3>
          <v-table density="compact">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Manager</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in history.reportingLines" :key="r.id">
                <td>{{ r.effectiveFrom }}</td>
                <td>{{ r.effectiveTo ?? 'current' }}</td>
                <td>{{ r.manager?.displayName ?? r.managerId }}</td>
              </tr>
            </tbody>
          </v-table>
        </template>
      </v-window-item>

      <v-window-item value="movements">
        <v-table density="compact">
          <thead>
            <tr>
              <th>Effective</th>
              <th>Type</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Decision</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in movements" :key="m.id">
              <td>{{ m.effectiveDate }}</td>
              <td>{{ label(m.type) }}</td>
              <td>
                <v-chip size="small">{{ label(m.status) }}</v-chip>
              </td>
              <td>{{ m.reason }}</td>
              <td>{{ m.decidedComment ?? '' }}</td>
              <td class="text-right">
                <v-btn
                  v-if="
                    auth.can('employee.transfer') &&
                    (m.status === 'SCHEDULED' || m.status === 'PENDING_APPROVAL')
                  "
                  size="small"
                  variant="text"
                  color="error"
                  @click="cancelMovement(m)"
                >
                  Cancel
                </v-btn>
              </td>
            </tr>
            <tr v-if="!movements.length">
              <td colspan="6" class="text-medium-emphasis">No movements yet.</td>
            </tr>
          </tbody>
        </v-table>
      </v-window-item>

      <v-window-item value="salary">
        <div class="d-flex mb-2">
          <v-spacer />
          <v-btn
            v-if="auth.can('salary.update')"
            size="small"
            color="primary"
            prepend-icon="mdi-plus"
            @click="salaryOpen = true"
          >
            New revision
          </v-btn>
        </div>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Effective from</th>
              <th>Annual CTC</th>
              <th>Monthly components</th>
              <th>Reason</th>
              <th>Structure</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in salary" :key="s.id">
              <td>{{ s.effectiveFrom }}</td>
              <td>{{ s.currency }} {{ s.annualCtc.toLocaleString() }}</td>
              <td>
                {{
                  Object.entries(s.amounts)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(', ')
                }}
              </td>
              <td>{{ s.revisionReason }}</td>
              <td>{{ s.salaryStructureId ?? '—' }}</td>
            </tr>
            <tr v-if="!salary.length">
              <td colspan="5" class="text-medium-emphasis">No salary revisions recorded.</td>
            </tr>
          </tbody>
        </v-table>
      </v-window-item>

      <v-window-item value="checklist">
        <v-table density="compact">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Task</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in checklist" :key="c.id">
              <td>{{ label(c.kind) }}</td>
              <td>{{ c.title }}</td>
              <td>
                <v-chip size="small" :color="c.status === 'PENDING' ? 'warning' : 'success'">
                  {{ label(c.status) }}
                </v-chip>
              </td>
              <td class="text-right">
                <template v-if="auth.can('employee.lifecycle')">
                  <v-btn
                    v-if="c.status === 'PENDING'"
                    size="small"
                    variant="text"
                    @click="setChecklist(c, 'DONE')"
                  >
                    Done
                  </v-btn>
                  <v-btn
                    v-if="c.status === 'PENDING'"
                    size="small"
                    variant="text"
                    @click="setChecklist(c, 'WAIVED')"
                  >
                    Waive
                  </v-btn>
                  <v-btn v-else size="small" variant="text" @click="setChecklist(c, 'PENDING')">
                    Reopen
                  </v-btn>
                </template>
              </td>
            </tr>
            <tr v-if="!checklist.length">
              <td colspan="4" class="text-medium-emphasis">No checklist items.</td>
            </tr>
          </tbody>
        </v-table>
      </v-window-item>

      <v-window-item value="documents">
        <v-table density="compact">
          <thead>
            <tr>
              <th>Title</th>
              <th>Category</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in documents" :key="d.id">
              <td>{{ d.title }}</td>
              <td>{{ d.category }}</td>
              <td>{{ d.createdAt.slice(0, 10) }}</td>
              <td class="text-right">
                <v-btn size="small" variant="text" icon="mdi-download" @click="download(d)" />
                <v-btn
                  v-if="canRegeneratePdf(d, auth.can)"
                  size="small"
                  variant="text"
                  icon="mdi-refresh"
                  title="Regenerate PDF with the current branding"
                  @click="regenerate(d)"
                />
              </td>
            </tr>
            <tr v-if="!documents.length">
              <td colspan="4" class="text-medium-emphasis">No documents.</td>
            </tr>
          </tbody>
        </v-table>
      </v-window-item>

      <v-window-item value="requests">
        <v-table density="compact">
          <thead>
            <tr>
              <th>Requested</th>
              <th>Changes</th>
              <th>Status</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in changeRequests" :key="r.id">
              <td>{{ r.createdAt.slice(0, 10) }}</td>
              <td>{{ Object.keys(r.changes).join(', ') }}</td>
              <td>{{ label(r.status) }}</td>
              <td>{{ r.decidedComment ?? '' }}</td>
            </tr>
            <tr v-if="!changeRequests.length">
              <td colspan="4" class="text-medium-emphasis">No self-service change requests.</td>
            </tr>
          </tbody>
        </v-table>
      </v-window-item>
    </v-window>

    <EmployeeFormDialog v-model="editOpen" :employee="employee" @saved="refresh" />
    <MovementDialog v-model="movementOpen" :employee="employee" @saved="onMovement" />

    <v-dialog v-model="lifecycle.open" max-width="520">
      <v-card :title="actions.find((a) => a.action === lifecycle.action)?.title ?? 'Lifecycle'">
        <v-card-text>
          <v-text-field v-if="dateLabel" v-model="lifecycle.date" type="date" :label="dateLabel" />
          <v-text-field
            v-if="lifecycle.action === 'resign'"
            v-model="lifecycle.lastWorkingDate"
            type="date"
            label="Last working date"
          />
          <v-select
            v-if="lifecycle.action === 'exit'"
            v-model="lifecycle.exitType"
            :items="exitTypes"
            label="Exit type"
          />
          <v-textarea v-model="lifecycle.reason" label="Reason" rows="2" auto-grow />
          <v-checkbox
            v-if="lifecycle.action === 'exit'"
            v-model="lifecycle.force"
            label="Exit even if exit-checklist items are pending"
            hide-details
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="lifecycle.open = false">Cancel</v-btn>
          <v-btn color="primary" @click="runLifecycle">Confirm</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="salaryOpen" max-width="520">
      <v-card title="New salary revision">
        <v-card-text>
          <p class="text-body-2 mb-2">Revisions are immutable; record a new one to correct.</p>
          <v-text-field v-model="salaryForm.effectiveFrom" type="date" label="Effective from" />
          <v-text-field v-model.number="salaryForm.annualCtc" type="number" label="Annual CTC" />
          <v-textarea
            v-model="salaryForm.amounts"
            label="Monthly components (JSON)"
            rows="2"
            auto-grow
          />
          <v-text-field v-model="salaryForm.revisionReason" label="Revision reason *" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="salaryOpen = false">Cancel</v-btn>
          <v-btn color="primary" :disabled="!salaryForm.revisionReason" @click="saveSalary">
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="letter.open" max-width="560">
      <v-card title="Generate letter">
        <v-card-text>
          <v-radio-group v-model="letter.type">
            <v-radio value="offer" label="Offer letter" />
            <v-radio value="experience" label="Experience letter" />
            <v-radio value="relieving" label="Relieving letter" />
          </v-radio-group>
          <p class="text-caption">
            Generated with the institution branding and stored in the employee's documents.
          </p>
          <DraftWithAiButton
            :kind="`${letter.type}_letter`"
            :variables="aiLetterVars"
            label="Or draft a custom letter with AI"
            @drafted="aiLetter = $event"
          />
          <template v-if="aiLetter">
            <v-text-field v-model="aiLetter.subject" label="Subject" class="mt-3" />
            <v-textarea v-model="aiLetter.body" label="Draft" rows="8" auto-grow />
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-content-copy"
              @click="copyAiLetter"
            >
              Copy
            </v-btn>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="letter.open = false">Cancel</v-btn>
          <v-btn color="primary" @click="generateLetter">Generate</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="profileOpen" max-width="680" scrollable>
      <v-card title="Edit personal & statutory details">
        <v-card-text>
          <v-row dense>
            <v-col cols="6">
              <v-text-field v-model="profileForm.dateOfBirth" type="date" label="Date of birth" />
            </v-col>
            <v-col cols="6">
              <v-select
                v-model="profileForm.gender"
                :items="['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']"
                label="Gender"
                clearable
              />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="profileForm.personalEmail" label="Personal email" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="profileForm.personalPhone" label="Personal phone" />
            </v-col>
          </v-row>
          <p class="text-body-2 my-2">
            Statutory ids are encrypted at rest. Leave blank to keep the stored value.
          </p>
          <v-row dense>
            <v-col cols="6"><v-text-field v-model="profileForm.pan" label="PAN" /></v-col>
            <v-col cols="6"><v-text-field v-model="profileForm.aadhaar" label="Aadhaar" /></v-col>
            <v-col cols="4"><v-text-field v-model="profileForm.uan" label="UAN" /></v-col>
            <v-col cols="4">
              <v-text-field v-model="profileForm.esicNumber" label="ESIC number" />
            </v-col>
            <v-col cols="4"
              ><v-text-field v-model="profileForm.pfNumber" label="PF number"
            /></v-col>
            <v-col cols="6">
              <v-text-field v-model="profileForm.accountHolderName" label="Account holder" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="profileForm.accountNumber" label="Account number" />
            </v-col>
            <v-col cols="6"><v-text-field v-model="profileForm.ifsc" label="IFSC" /></v-col>
            <v-col cols="6"><v-text-field v-model="profileForm.bankName" label="Bank" /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="profileOpen = false">Cancel</v-btn>
          <v-btn color="primary" @click="saveProfile">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </template>
  <v-progress-linear v-else-if="!error" indeterminate />
</template>

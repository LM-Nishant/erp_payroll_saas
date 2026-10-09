<script setup lang="ts">
/** Workspace landing page: shortcuts to every page of the layout the user may open. */
import type { EmployeeDetailDto, LeaveBalanceDto, MyAttendanceDto } from '@erp/shared';
import HighlightsPanel from '@/components/HighlightsPanel.vue';
import { computed, onMounted, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { MENUS, visibleMenu, type LayoutKey } from '@/navigation/menus';
import { useTerms } from '@/lib/terms';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ layout: Exclude<LayoutKey, 'platform'> }>();
const auth = useAuthStore();
const terms = useTerms();

const shortcuts = computed(() =>
  visibleMenu(MENUS[props.layout], auth.can, auth.hasFeature, auth.me?.organization?.kind).filter(
    (i) => i.to !== `/${props.layout}`,
  ),
);
const title = computed(() => {
  if (props.layout === 'employee') return `Welcome, ${auth.me?.user.name ?? ''}`;
  if (props.layout === 'hr') return 'HR dashboard';
  return props.layout === 'group' ? terms.value.group : terms.value.institution;
});

const self = ref<EmployeeDetailDto | null>(null);
const notLinked = ref(false);
const today = ref<MyAttendanceDto | null>(null);
const balances = ref<LeaveBalanceDto[]>([]);
const showHighlights = computed(
  () =>
    auth.hasFeature('hr') &&
    (props.layout === 'employee' ? Boolean(self.value) : auth.can('employee.view')),
);
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const firstIn = computed(() => today.value?.punches.find((p) => p.direction === 'IN'));
const lastOut = computed(() =>
  [...(today.value?.punches ?? [])].reverse().find((p) => p.direction === 'OUT'),
);
const punchedIn = computed(() => {
  const last = today.value?.punches.at(-1);
  return last?.direction === 'IN';
});

onMounted(async () => {
  if (props.layout !== 'employee') return;
  if (!auth.can('employee.view_own') || !auth.hasFeature('hr')) {
    notLinked.value = true;
    return;
  }
  try {
    self.value = (await apiFetch<{ data: EmployeeDetailDto }>('/api/v1/employees/me')).data;
  } catch {
    notLinked.value = true;
    return;
  }
  const d = localDate();
  await Promise.all([
    auth.can('attendance.view_own')
      ? apiFetch<{ data: MyAttendanceDto }>(`/api/v1/attendance/me?from=${d}&to=${d}`)
          .then((r) => (today.value = r.data))
          .catch(() => undefined)
      : undefined,
    auth.can('leave.view_own')
      ? apiFetch<{ data: LeaveBalanceDto[] }>('/api/v1/leave/me/balances')
          .then((r) => (balances.value = r.data))
          .catch(() => undefined)
      : undefined,
  ]);
});
</script>

<template>
  <h2 class="text-h5 mb-1">{{ title }}</h2>
  <p v-if="self" class="text-medium-emphasis mb-4">
    {{ self.employeeCode }} · {{ self.designation?.name ?? 'No designation' }} ·
    {{ self.institution?.name }}<span v-if="self.department"> / {{ self.department.name }}</span>
  </p>
  <p v-else class="text-medium-emphasis mb-4">{{ auth.me?.organization?.name }}</p>
  <v-alert v-if="notLinked" type="info" variant="tonal" class="mb-4">
    Your login is not linked to an employee record, so attendance, leave and payslips are not
    available here. HR can link it from HR → Employees → (employee) → Login access.
  </v-alert>
  <v-row v-if="self" class="mb-2">
    <v-col v-if="auth.can('attendance.view_own')" cols="12" md="5">
      <v-card height="100%">
        <v-card-title class="d-flex align-center">
          <v-icon color="primary" class="mr-2">mdi-clock-check-outline</v-icon>Today
          <v-spacer />
          <v-chip :color="punchedIn ? 'success' : 'grey'" size="small" variant="tonal">
            {{ punchedIn ? 'Checked in' : firstIn ? 'Checked out' : 'Not checked in' }}
          </v-chip>
        </v-card-title>
        <v-card-text>
          <div class="d-flex ga-6 mb-3">
            <div>
              <div class="text-caption text-medium-emphasis">Check-in</div>
              <div class="text-h6">{{ firstIn ? time(firstIn.punchedAt) : '--:--' }}</div>
            </div>
            <div>
              <div class="text-caption text-medium-emphasis">Check-out</div>
              <div class="text-h6">{{ lastOut ? time(lastOut.punchedAt) : '--:--' }}</div>
            </div>
          </div>
          <div v-if="today?.faceMatchRequired" class="text-caption text-medium-emphasis mb-2">
            <v-icon size="small">mdi-face-recognition</v-icon> A selfie matched to your profile
            photo is required to punch.
          </div>
          <v-btn color="primary" to="/employee/attendance" prepend-icon="mdi-camera">
            {{ punchedIn ? 'Check out' : 'Check in' }}
          </v-btn>
          <v-btn variant="text" to="/employee/attendance">Regularize / history</v-btn>
        </v-card-text>
      </v-card>
    </v-col>
    <v-col v-if="balances.length" cols="12" md="7">
      <v-card height="100%">
        <v-card-title class="d-flex align-center">
          <v-icon color="teal" class="mr-2">mdi-calendar-account</v-icon>Leave balance
          <v-spacer />
          <v-btn size="small" variant="tonal" color="teal" to="/employee/leave">Apply leave</v-btn>
        </v-card-title>
        <v-card-text class="d-flex flex-wrap ga-3">
          <v-sheet
            v-for="b in balances"
            :key="b.leaveTypeId"
            border
            rounded
            class="pa-3 text-center"
            min-width="110"
          >
            <div class="text-h5">{{ b.available }}</div>
            <div class="text-caption">{{ b.name }}</div>
            <div v-if="b.pending" class="text-caption text-warning">{{ b.pending }} pending</div>
          </v-sheet>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
  <HighlightsPanel v-if="showHighlights" />
  <h3 v-if="shortcuts.length" class="text-subtitle-1 mb-2">Quick links</h3>
  <v-row>
    <v-col v-for="s in shortcuts" :key="s.to" cols="12" sm="6" md="4" lg="3">
      <v-card :to="s.to" :prepend-icon="s.icon" :title="s.title" variant="tonal" />
    </v-col>
  </v-row>
</template>

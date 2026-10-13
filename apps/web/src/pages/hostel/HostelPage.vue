<script setup lang="ts">
import type {
  HostelDashboardDto,
  HostelDto,
  HostelReportDto,
  HostelRoomDto,
  RollCallSheetDto,
} from '@erp/shared';
import {
  HOSTEL_COMPLAINT_CATEGORIES,
  HOSTEL_COMPLAINT_PRIORITIES,
  HOSTEL_ROOM_TYPES,
  HOSTEL_TYPES,
  OUTPASS_STATUSES,
  OUTPASS_TYPES,
  ROLL_CALL_SESSIONS,
} from '@erp/shared';
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
import ResourceTable, { type ResourceField } from '@/components/ResourceTable.vue';
import { useAuthStore } from '@/stores/auth';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TABS = [
  { key: 'dashboard', title: 'Dashboard' },
  { key: 'hostels', title: 'Hostels / rooms' },
  { key: 'allocations', title: 'Allocations' },
  { key: 'outpasses', title: 'Out-passes' },
  { key: 'visitors', title: 'Visitors' },
  { key: 'complaints', title: 'Complaints' },
  { key: 'rollcall', title: 'Roll call' },
  { key: 'reports', title: 'Reports' },
] as const;

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const tab = computed({
  get: () => (route.params.tab as string) || 'dashboard',
  set: (t: string) => void router.replace({ params: { tab: t } }),
});
const API = '/api/v1/hostel';
const error = ref<string | null>(null);
const canManage = computed(() => auth.can('hostel.manage'));
const canAllocate = computed(() => auth.can('hostel.allocate'));
const canApprove = computed(() => auth.can('hostel.outpass_approve'));
const today = new Date().toISOString().slice(0, 10);

async function act(fn: () => Promise<unknown>, reload?: () => unknown) {
  error.value = null;
  try {
    await fn();
    await reload?.();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const post = (path: string, body: unknown = {}) =>
  apiFetch(`${API}${path}`, { method: 'POST', body: JSON.stringify(body) });
const patch = (path: string, body: unknown) =>
  apiFetch(`${API}${path}`, { method: 'PATCH', body: JSON.stringify(body) });
const get = async <T,>(path: string) => (await apiFetch<{ data: T }>(`${API}${path}`)).data;

const hostels = ref<HostelDto[]>([]);
const hostelItems = computed(() =>
  hostels.value.map((h) => ({ value: h.id, title: `${h.code} · ${h.name}` })),
);
const selectedHostel = ref<string>('');
async function loadHostels() {
  const r = await apiFetch<{ data: HostelDto[] }>(`${API}?pageSize=100`);
  hostels.value = r.data;
  if (!selectedHostel.value && r.data[0]) selectedHostel.value = r.data[0].id;
}
const hostelRef: ResourceField = {
  key: 'hostelId',
  label: 'Hostel',
  type: 'ref',
  refEndpoint: API,
  refTitle: (r) => `${r.code} · ${r.name}`,
  required: true,
};
const studentRef = (label = 'Student'): ResourceField => ({
  key: 'studentId',
  label,
  type: 'ref',
  refEndpoint: `${API}/allocations?status=ACTIVE&occupantType=STUDENT`,
  refTitle: (r) => `${r.occupantName} · ${r.room?.roomNo ?? ''}`,
});
// Allocation rows carry studentId; map the option value to it.
const residentRef = (label = 'Resident student'): ResourceField => ({
  ...studentRef(label),
  refEndpoint: `/api/v1/students`,
  refTitle: (r) => `${r.displayName} (${r.admissionNo})`,
});

// ---- Dashboard / reports -------------------------------------------------------------------
const dashboard = ref<HostelDashboardDto | null>(null);
const report = ref<HostelReportDto | null>(null);
const cards = computed(() => {
  const d = dashboard.value;
  if (!d) return [];
  return [
    { label: 'Hostels', value: d.hostels, icon: 'mdi-office-building' },
    { label: 'Rooms', value: d.rooms, icon: 'mdi-door' },
    { label: 'Beds (occupied/total)', value: `${d.occupied}/${d.beds}`, icon: 'mdi-bed' },
    { label: 'Occupancy', value: `${d.occupancyPercent}%`, icon: 'mdi-chart-donut' },
    { label: 'Pending out-passes', value: d.pendingOutpasses, icon: 'mdi-exit-run' },
    { label: 'Students out', value: d.studentsOut, icon: 'mdi-walk' },
    { label: 'Open complaints', value: d.openComplaints, icon: 'mdi-tools' },
    { label: 'Visitors today', value: d.visitorsToday, icon: 'mdi-account-clock' },
  ];
});

// ---- Hostels / rooms -----------------------------------------------------------------------
const rooms = ref<HostelRoomDto[]>([]);
const roomForm = reactive({
  open: false,
  roomNo: '',
  floor: 0,
  roomType: 'DOUBLE',
  capacity: 2,
  monthlyRent: 0,
  amenities: [] as string[],
});
async function loadRooms() {
  if (!selectedHostel.value) return;
  await act(async () => {
    rooms.value = (
      await apiFetch<{ data: HostelRoomDto[] }>(
        `${API}/rooms?hostelId=${selectedHostel.value}&pageSize=100`,
      )
    ).data;
  });
}
async function saveRoom() {
  await act(
    () =>
      post(`/${selectedHostel.value}/rooms`, {
        roomNo: roomForm.roomNo,
        floor: Number(roomForm.floor),
        roomType: roomForm.roomType,
        capacity: Number(roomForm.capacity),
        monthlyRent: Number(roomForm.monthlyRent),
        amenities: roomForm.amenities,
      }),
    loadRooms,
  );
  if (!error.value) roomForm.open = false;
}
async function toggleBed(bedId: string, status: string) {
  await act(
    () => patch(`/beds/${bedId}`, { status: status === 'BLOCKED' ? 'AVAILABLE' : 'BLOCKED' }),
    loadRooms,
  );
}

// ---- Allocations ---------------------------------------------------------------------------
const allocTable = ref<{ reload: () => Promise<void> } | null>(null);
const allocate = reactive({
  open: false,
  studentId: null as string | null,
  roomId: '',
  messPlanId: null as string | null,
  fromDate: today,
});
const students = ref<{ value: string; title: string }[]>([]);
const freeRooms = ref<{ value: string; title: string }[]>([]);
const messPlans = ref<{ value: string; title: string }[]>([]);
async function searchStudents(search = '') {
  const r = await apiFetch<{ data: Row[] }>(
    `/api/v1/students?pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ''}`,
  );
  students.value = r.data.map((s) => ({
    value: s.id,
    title: `${s.displayName} (${s.admissionNo}) ${s.gender ?? ''}`,
  }));
}
async function openAllocate() {
  allocate.open = true;
  await act(async () => {
    await searchStudents();
    await loadAllocOptions();
  });
}
async function loadAllocOptions() {
  if (!selectedHostel.value) return;
  const [r, m] = await Promise.all([
    apiFetch<{ data: HostelRoomDto[] }>(
      `${API}/rooms?hostelId=${selectedHostel.value}&pageSize=100`,
    ),
    get<Row[]>(`/${selectedHostel.value}/mess-plans`),
  ]);
  freeRooms.value = r.data
    .filter((x) => x.occupied < x.capacity && x.status === 'ACTIVE')
    .map((x) => ({
      value: x.id,
      title: `${x.roomNo} · ${x.roomType} · ${x.capacity - x.occupied} free · ₹${x.monthlyRent}`,
    }));
  messPlans.value = m.map((p) => ({ value: p.id, title: `${p.name} · ₹${p.monthlyFee}` }));
}
watch(selectedHostel, () => {
  if (allocate.open) void loadAllocOptions();
  if (tab.value === 'hostels') void loadRooms();
  if (tab.value === 'rollcall') void loadRoll();
});
async function saveAllocation() {
  await act(
    () =>
      post('/allocations', {
        occupantType: 'STUDENT',
        studentId: allocate.studentId,
        roomId: allocate.roomId,
        messPlanId: allocate.messPlanId,
        fromDate: allocate.fromDate,
      }),
    () => allocTable.value?.reload(),
  );
  if (!error.value) allocate.open = false;
}
const chargePeriod = ref(today.slice(0, 7));

// ---- Out-passes ----------------------------------------------------------------------------
const outpassTable = ref<{ reload: () => Promise<void> } | null>(null);
async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
  await act(
    () => post(`/outpasses/${id}/decide`, { decision }),
    () => outpassTable.value?.reload(),
  );
}
// Mirrors outpassService.decide: PENDING only, not workflow-managed, never your own request.
function canDecideOutpass(o: Row) {
  return (
    canApprove.value &&
    o.status === 'PENDING' &&
    !o.workflowInstanceId &&
    o.requestedByUserId !== auth.me?.user.id
  );
}
/**
 * Cancel withdraws the pass (PENDING/APPROVED, before the student leaves). On a pending pass the
 * approver should Reject instead, so Cancel is only offered there when the user cannot decide it.
 */
function canCancelOutpass(o: Row) {
  if (!canManage.value) return false;
  if (o.status === 'APPROVED') return true;
  return o.status === 'PENDING' && !canDecideOutpass(o);
}
const cancelOutpass = reactive({ open: false, item: null as Row | null });
function openCancelOutpass(o: Row) {
  error.value = null;
  Object.assign(cancelOutpass, { open: true, item: o });
}
async function confirmCancelOutpass() {
  const o = cancelOutpass.item;
  if (!o) return;
  await act(
    () => post(`/outpasses/${o.id}/cancel`),
    () => outpassTable.value?.reload(),
  );
  if (!error.value) cancelOutpass.open = false;
}

// ---- Roll call -----------------------------------------------------------------------------
const roll = reactive({ date: today, session: 'NIGHT', sheet: null as RollCallSheetDto | null });
async function loadRoll() {
  if (!selectedHostel.value) return;
  await act(async () => {
    roll.sheet = await get<RollCallSheetDto>(
      `/roll-call?hostelId=${selectedHostel.value}&date=${roll.date}&session=${roll.session}`,
    );
    for (const e of roll.sheet.entries)
      e.status = e.status ?? (e.onOutpass ? 'ON_LEAVE' : 'PRESENT');
  });
}
async function saveRoll() {
  if (!roll.sheet?.entries.length) return;
  await act(
    () =>
      apiFetch(`${API}/roll-call`, {
        method: 'PUT',
        body: JSON.stringify({
          hostelId: selectedHostel.value,
          date: roll.date,
          session: roll.session,
          entries: roll.sheet!.entries.map((e) => ({ studentId: e.studentId, status: e.status })),
        }),
      }),
    loadRoll,
  );
}
watch(
  () => [roll.date, roll.session],
  () => void loadRoll(),
);

watch(
  tab,
  async (t) => {
    await act(async () => {
      if (!hostels.value.length) await loadHostels();
      if (t === 'dashboard') dashboard.value = await get<HostelDashboardDto>('/dashboard');
      if (t === 'reports') report.value = await get<HostelReportDto>('/reports');
    });
    if (t === 'hostels') await loadRooms();
    if (t === 'rollcall') await loadRoll();
  },
  { immediate: true },
);
</script>

<template>
  <h2 class="text-h5 mb-2">Hostel</h2>
  <v-tabs v-model="tab" class="mb-4" show-arrows>
    <v-tab v-for="t in TABS" :key="t.key" :value="t.key">{{ t.title }}</v-tab>
  </v-tabs>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>

  <!-- Dashboard -->
  <template v-if="tab === 'dashboard'">
    <v-row>
      <v-col v-for="c in cards" :key="c.label" cols="12" sm="6" md="3">
        <v-card>
          <v-card-text class="d-flex align-center ga-3">
            <v-icon :icon="c.icon" size="32" color="primary" />
            <div>
              <div class="text-h6">{{ c.value }}</div>
              <div class="text-caption">{{ c.label }}</div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
    <v-card v-if="dashboard" title="Occupancy by hostel" class="mt-4">
      <v-table density="compact">
        <tbody>
          <tr v-for="h in dashboard.byHostel" :key="h.hostelId">
            <td>{{ h.code }} · {{ h.name }}</td>
            <td>{{ h.hostelType }}</td>
            <td style="width: 40%">
              <v-progress-linear
                :model-value="h.beds ? (100 * h.occupied) / h.beds : 0"
                height="18"
                color="primary"
                >{{ h.occupied }}/{{ h.beds }}</v-progress-linear
              >
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </template>

  <!-- Hostels / rooms -->
  <template v-else-if="tab === 'hostels'">
    <ResourceTable
      :endpoint="API"
      :create-endpoint="API"
      create-label="New hostel"
      create-permission="hostel.manage"
      :headers="[
        { title: 'Code', key: 'code' },
        { title: 'Name', key: 'name' },
        { title: 'Type', key: 'hostelType' },
        { title: 'Warden', key: 'wardenName' },
        { title: 'Rooms', key: 'rooms' },
        { title: 'Beds', key: 'beds' },
        { title: 'Occupied', key: 'occupied' },
        { title: 'Status', key: 'status' },
      ]"
      :fields="[
        {
          key: 'institutionId',
          label: 'Institution',
          type: 'ref',
          refEndpoint: '/api/v1/institutions',
          required: true,
        },
        { key: 'code', label: 'Code', required: true },
        { key: 'name', label: 'Name', required: true },
        {
          key: 'hostelType',
          label: 'Type',
          type: 'select',
          options: HOSTEL_TYPES,
          default: 'BOYS',
        },
        {
          key: 'wardenEmployeeId',
          label: 'Warden (employee)',
          type: 'ref',
          refEndpoint: '/api/v1/employees',
          refTitle: (r) => `${r.displayName ?? r.firstName} (${r.employeeCode})`,
        },
        { key: 'phone', label: 'Phone' },
      ]"
      @created="loadHostels"
    />
    <v-card class="mt-6">
      <v-card-title class="d-flex align-center ga-3">
        Rooms &amp; beds
        <v-select
          v-model="selectedHostel"
          :items="hostelItems"
          density="compact"
          hide-details
          style="max-width: 320px"
        />
        <v-spacer />
        <v-btn
          v-if="canManage && selectedHostel"
          color="primary"
          prepend-icon="mdi-plus"
          @click="roomForm.open = true"
          >New room</v-btn
        >
      </v-card-title>
      <v-card-text>
        <v-row dense>
          <v-col v-for="r in rooms" :key="r.id" cols="12" sm="6" md="4" lg="3">
            <v-card variant="outlined">
              <v-card-title class="text-subtitle-1">
                {{ r.blockName ? `${r.blockName} · ` : '' }}Room {{ r.roomNo }}
                <v-chip size="x-small" class="ml-1">{{ r.roomType }}</v-chip>
              </v-card-title>
              <v-card-subtitle
                >Floor {{ r.floor }} · {{ r.occupied }}/{{ r.capacity }} · ₹{{
                  r.monthlyRent
                }}/mo</v-card-subtitle
              >
              <v-card-text>
                <div v-for="b in r.beds" :key="b.id" class="d-flex align-center">
                  <v-icon
                    size="small"
                    :color="
                      b.status === 'OCCUPIED'
                        ? 'primary'
                        : b.status === 'BLOCKED'
                          ? 'grey'
                          : 'success'
                    "
                    icon="mdi-bed"
                    class="mr-1"
                  />
                  {{ b.bedNo }}: {{ b.occupant?.name ?? b.status }}
                  <v-spacer />
                  <v-btn
                    v-if="canManage && b.status !== 'OCCUPIED'"
                    size="x-small"
                    variant="text"
                    @click="toggleBed(b.id, b.status)"
                    >{{ b.status === 'BLOCKED' ? 'Unblock' : 'Block' }}</v-btn
                  >
                </div>
                <div v-if="r.amenities.length" class="text-caption mt-1">
                  {{ r.amenities.join(', ') }}
                </div>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col v-if="!rooms.length" cols="12">No rooms yet.</v-col>
        </v-row>
      </v-card-text>
    </v-card>
    <ResourceTable
      v-if="selectedHostel"
      :key="`mess-${selectedHostel}`"
      class="mt-6"
      title="Mess plans"
      :searchable="false"
      :endpoint="`${API}/${selectedHostel}/mess-plans`"
      :create-endpoint="`${API}/${selectedHostel}/mess-plans`"
      create-label="New mess plan"
      create-permission="hostel.manage"
      :headers="[
        { title: 'Name', key: 'name' },
        { title: 'Description', key: 'description' },
        { title: 'Monthly fee', key: 'monthlyFee' },
      ]"
      :fields="[
        { key: 'name', label: 'Name', required: true },
        { key: 'monthlyFee', label: 'Monthly fee', type: 'number', required: true },
        { key: 'description', label: 'Description', cols: 12 },
      ]"
    />
    <v-dialog v-model="roomForm.open" max-width="560">
      <v-card title="New room">
        <v-card-text>
          <v-row dense>
            <v-col cols="6"
              ><v-text-field v-model="roomForm.roomNo" label="Room no" density="compact"
            /></v-col>
            <v-col cols="6"
              ><v-text-field v-model="roomForm.floor" label="Floor" type="number" density="compact"
            /></v-col>
            <v-col cols="6"
              ><v-select
                v-model="roomForm.roomType"
                :items="[...HOSTEL_ROOM_TYPES] as string[]"
                label="Type"
                density="compact"
            /></v-col>
            <v-col cols="6"
              ><v-text-field
                v-model="roomForm.capacity"
                label="Beds"
                type="number"
                density="compact"
            /></v-col>
            <v-col cols="6"
              ><v-text-field
                v-model="roomForm.monthlyRent"
                label="Monthly rent"
                type="number"
                density="compact"
            /></v-col>
            <v-col cols="12"
              ><v-combobox
                v-model="roomForm.amenities"
                label="Amenities"
                multiple
                chips
                density="compact"
            /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="roomForm.open = false">Cancel</v-btn>
          <v-btn color="primary" @click="saveRoom">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </template>

  <!-- Allocations -->
  <template v-else-if="tab === 'allocations'">
    <ResourceTable
      ref="allocTable"
      :endpoint="`${API}/allocations`"
      :status-options="['ACTIVE', 'VACATED', 'TRANSFERRED']"
      :headers="[
        { title: 'Occupant', key: 'occupantName' },
        { title: 'Code', key: 'occupantCode' },
        { title: 'Hostel', key: 'hostel' },
        { title: 'Room / bed', key: 'room' },
        { title: 'Mess', key: 'messPlan' },
        { title: 'From', key: 'fromDate' },
        { title: 'Rent', key: 'monthlyRent' },
        { title: 'Status', key: 'status' },
        { title: '', key: 'actions', sortable: false },
      ]"
    >
      <template #toolbar>
        <v-btn v-if="canAllocate" color="primary" prepend-icon="mdi-plus" @click="openAllocate"
          >Allocate room</v-btn
        >
      </template>
      <template #[`item.hostel`]="{ item }">{{ (item as Row).hostel.code }}</template>
      <template #[`item.room`]="{ item }"
        >{{ (item as Row).room.roomNo }} / {{ (item as Row).bed.bedNo }}</template
      >
      <template #[`item.messPlan`]="{ item }">{{ (item as Row).messPlan?.name ?? '—' }}</template>
      <template #[`item.actions`]="{ item, reload }">
        <v-btn
          v-if="canAllocate && (item as Row).status === 'ACTIVE'"
          size="small"
          variant="text"
          @click="
            act(() => post(`/allocations/${(item as Row).id}/vacate`, { toDate: today }), reload)
          "
          >Vacate</v-btn
        >
      </template>
    </ResourceTable>
    <ResourceTable
      class="mt-6"
      title="Hostel charges"
      :searchable="false"
      :endpoint="`${API}/charges`"
      :query="{ period: chargePeriod }"
      :status-options="['PENDING', 'POSTED', 'WAIVED']"
      :headers="[
        { title: 'Occupant', key: 'occupantName' },
        { title: 'Period', key: 'period' },
        { title: 'Rent', key: 'rentAmount' },
        { title: 'Mess', key: 'messAmount' },
        { title: 'Total', key: 'amount' },
        { title: 'Status', key: 'status' },
      ]"
    >
      <template #filters>
        <v-text-field
          v-model="chargePeriod"
          label="Period (YYYY-MM)"
          density="compact"
          hide-details
          style="max-width: 160px"
        />
      </template>
      <template #toolbar="{ reload }">
        <v-btn
          v-if="canAllocate"
          variant="tonal"
          @click="act(() => post('/charges/generate', { period: chargePeriod }), reload)"
          >Generate charges</v-btn
        >
      </template>
    </ResourceTable>
    <v-dialog v-model="allocate.open" max-width="640">
      <v-card title="Allocate a room">
        <v-card-text>
          <v-select
            v-model="selectedHostel"
            :items="hostelItems"
            label="Hostel"
            density="compact"
          />
          <v-autocomplete
            v-model="allocate.studentId"
            :items="students"
            label="Student"
            no-filter
            density="compact"
            @update:search="(s: string) => searchStudents(s)"
          />
          <v-select v-model="allocate.roomId" :items="freeRooms" label="Room" density="compact" />
          <v-select
            v-model="allocate.messPlanId"
            :items="messPlans"
            label="Mess plan (optional)"
            clearable
            density="compact"
          />
          <v-text-field v-model="allocate.fromDate" type="date" label="From" density="compact" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="allocate.open = false">Cancel</v-btn>
          <v-btn color="primary" @click="saveAllocation">Allocate</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </template>

  <!-- Out-passes -->
  <ResourceTable
    v-else-if="tab === 'outpasses'"
    ref="outpassTable"
    :endpoint="`${API}/outpasses`"
    :create-endpoint="`${API}/outpasses`"
    create-label="New out-pass"
    create-permission="hostel.manage"
    :status-options="OUTPASS_STATUSES"
    :headers="[
      { title: 'Student', key: 'studentName' },
      { title: 'Hostel', key: 'hostelName' },
      { title: 'Type', key: 'passType' },
      { title: 'From', key: 'fromAt' },
      { title: 'To', key: 'toAt' },
      { title: 'Reason', key: 'reason' },
      { title: 'Status', key: 'status' },
      { title: '', key: 'actions', sortable: false },
    ]"
    :fields="[
      { ...residentRef(), required: true },
      { key: 'passType', label: 'Type', type: 'select', options: OUTPASS_TYPES, default: 'OUTING' },
      { key: 'fromAt', label: 'From', type: 'datetime', required: true },
      { key: 'toAt', label: 'To', type: 'datetime', required: true },
      { key: 'destination', label: 'Destination' },
      { key: 'reason', label: 'Reason', required: true, cols: 12 },
    ]"
  >
    <template #[`item.fromAt`]="{ item }">{{
      new Date((item as Row).fromAt).toLocaleString()
    }}</template>
    <template #[`item.toAt`]="{ item }">{{
      new Date((item as Row).toAt).toLocaleString()
    }}</template>
    <template #[`item.actions`]="{ item, reload }">
      <template v-if="canDecideOutpass(item as Row)">
        <v-btn
          size="small"
          variant="text"
          color="success"
          @click="decide((item as Row).id, 'APPROVE')"
          >Approve</v-btn
        >
        <v-btn size="small" variant="text" color="error" @click="decide((item as Row).id, 'REJECT')"
          >Reject</v-btn
        >
      </template>
      <v-chip
        v-else-if="(item as Row).status === 'PENDING' && (item as Row).workflowInstanceId"
        size="small"
        variant="tonal"
        prepend-icon="mdi-source-branch"
        title="Decided in the Approvals inbox"
        >In approvals</v-chip
      >
      <v-btn
        v-if="canCancelOutpass(item as Row)"
        size="small"
        variant="text"
        color="warning"
        title="Withdraw this out-pass (not a rejection)"
        @click="openCancelOutpass(item as Row)"
        >Cancel out-pass</v-btn
      >
      <v-btn
        v-if="(item as Row).status === 'APPROVED' && canManage"
        size="small"
        variant="text"
        @click="act(() => post(`/outpasses/${(item as Row).id}/checkout`), reload)"
        >Check out</v-btn
      >
      <v-btn
        v-if="(item as Row).status === 'OUT' && canManage"
        size="small"
        variant="text"
        @click="act(() => post(`/outpasses/${(item as Row).id}/return`), reload)"
        >Mark returned</v-btn
      >
    </template>
  </ResourceTable>

  <!-- Visitors -->
  <template v-else-if="tab === 'visitors'">
    <ResourceTable
      :endpoint="`${API}/visitors`"
      :create-endpoint="`${API}/visitors`"
      create-label="Check in visitor"
      create-permission="hostel.manage"
      :headers="[
        { title: 'Visitor', key: 'visitorName' },
        { title: 'Relation', key: 'relation' },
        { title: 'Student', key: 'studentName' },
        { title: 'Hostel', key: 'hostelName' },
        { title: 'In', key: 'checkInAt' },
        { title: 'Out', key: 'checkOutAt' },
        { title: '', key: 'actions', sortable: false },
      ]"
      :fields="[
        hostelRef,
        residentRef('Visiting student'),
        { key: 'visitorName', label: 'Visitor name', required: true },
        { key: 'relation', label: 'Relation' },
        { key: 'phone', label: 'Phone' },
        { key: 'idProof', label: 'ID proof' },
        { key: 'purpose', label: 'Purpose', cols: 12 },
      ]"
    >
      <template #[`item.checkInAt`]="{ item }">{{
        new Date((item as Row).checkInAt).toLocaleString()
      }}</template>
      <template #[`item.checkOutAt`]="{ item }">{{
        (item as Row).checkOutAt ? new Date((item as Row).checkOutAt).toLocaleString() : '—'
      }}</template>
      <template #[`item.actions`]="{ item, reload }">
        <v-btn
          v-if="canManage && !(item as Row).checkOutAt"
          size="small"
          variant="text"
          @click="act(() => post(`/visitors/${(item as Row).id}/checkout`), reload)"
          >Check out</v-btn
        >
      </template>
    </ResourceTable>
    <ResourceTable
      class="mt-6"
      title="In / out register"
      :searchable="false"
      :endpoint="`${API}/movements`"
      :create-endpoint="`${API}/movements`"
      create-label="Log movement"
      create-permission="hostel.manage"
      :headers="[
        { title: 'Student', key: 'studentName' },
        { title: 'Direction', key: 'direction' },
        { title: 'At', key: 'at' },
        { title: 'Notes', key: 'notes' },
      ]"
      :fields="[
        hostelRef,
        { ...residentRef(), required: true },
        {
          key: 'direction',
          label: 'Direction',
          type: 'select',
          options: ['OUT', 'IN'],
          default: 'OUT',
        },
        { key: 'notes', label: 'Notes', cols: 12 },
      ]"
    >
      <template #[`item.at`]="{ item }">{{ new Date((item as Row).at).toLocaleString() }}</template>
    </ResourceTable>
  </template>

  <!-- Complaints -->
  <ResourceTable
    v-else-if="tab === 'complaints'"
    :endpoint="`${API}/complaints`"
    :create-endpoint="`${API}/complaints`"
    create-label="New ticket"
    create-permission="hostel.manage"
    :status-options="['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']"
    :headers="[
      { title: 'Title', key: 'title' },
      { title: 'Category', key: 'category' },
      { title: 'Hostel', key: 'hostelName' },
      { title: 'Room', key: 'roomNo' },
      { title: 'Raised by', key: 'studentName' },
      { title: 'Priority', key: 'priority' },
      { title: 'Status', key: 'status' },
      { title: '', key: 'actions', sortable: false },
    ]"
    :fields="[
      hostelRef,
      {
        key: 'category',
        label: 'Category',
        type: 'select',
        options: HOSTEL_COMPLAINT_CATEGORIES,
        default: 'MAINTENANCE',
      },
      {
        key: 'priority',
        label: 'Priority',
        type: 'select',
        options: HOSTEL_COMPLAINT_PRIORITIES,
        default: 'MEDIUM',
      },
      { key: 'title', label: 'Title', required: true },
      { key: 'description', label: 'Description', type: 'textarea', cols: 12 },
    ]"
  >
    <template #[`item.actions`]="{ item, reload }">
      <template v-if="canManage">
        <v-btn
          v-if="(item as Row).status === 'OPEN'"
          size="small"
          variant="text"
          @click="
            act(() => patch(`/complaints/${(item as Row).id}`, { status: 'IN_PROGRESS' }), reload)
          "
          >Start</v-btn
        >
        <v-btn
          v-if="['OPEN', 'IN_PROGRESS'].includes((item as Row).status)"
          size="small"
          variant="text"
          @click="
            act(
              () =>
                patch(`/complaints/${(item as Row).id}`, {
                  status: 'RESOLVED',
                  resolution: 'Resolved by hostel office',
                }),
              reload,
            )
          "
          >Resolve</v-btn
        >
        <v-btn
          v-if="(item as Row).status === 'RESOLVED'"
          size="small"
          variant="text"
          @click="act(() => patch(`/complaints/${(item as Row).id}`, { status: 'CLOSED' }), reload)"
          >Close ticket</v-btn
        >
      </template>
    </template>
  </ResourceTable>

  <!-- Roll call -->
  <template v-else-if="tab === 'rollcall'">
    <div class="d-flex flex-wrap ga-3 mb-3">
      <v-select
        v-model="selectedHostel"
        :items="hostelItems"
        label="Hostel"
        density="compact"
        hide-details
        style="max-width: 300px"
      />
      <v-text-field
        v-model="roll.date"
        type="date"
        label="Date"
        density="compact"
        hide-details
        style="max-width: 180px"
      />
      <v-select
        v-model="roll.session"
        :items="[...ROLL_CALL_SESSIONS] as string[]"
        label="Session"
        density="compact"
        hide-details
        style="max-width: 160px"
      />
      <v-spacer />
      <v-btn
        v-if="canManage"
        color="primary"
        :disabled="roll.date > today || !roll.sheet?.entries.length"
        :title="roll.date > today ? 'Roll call cannot be taken for a future date' : undefined"
        @click="saveRoll"
        >Save roll call</v-btn
      >
    </div>
    <v-table v-if="roll.sheet" density="compact">
      <thead>
        <tr>
          <th>Student</th>
          <th>Room / bed</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in roll.sheet.entries" :key="e.studentId">
          <td>
            {{ e.studentName }}
            <v-chip v-if="e.onOutpass" size="x-small" color="warning">on out-pass</v-chip>
          </td>
          <td>{{ e.roomNo }} / {{ e.bedNo }}</td>
          <td>
            <v-btn-toggle
              v-model="e.status"
              density="compact"
              mandatory
              :disabled="!canManage || roll.date > today"
            >
              <v-btn value="PRESENT" color="success">Present</v-btn>
              <v-btn value="ABSENT" color="error">Absent</v-btn>
              <v-btn value="ON_LEAVE" color="warning">Leave</v-btn>
            </v-btn-toggle>
          </td>
        </tr>
        <tr v-if="!roll.sheet.entries.length">
          <td colspan="3">No residents.</td>
        </tr>
      </tbody>
    </v-table>
  </template>

  <!-- Reports -->
  <template v-else-if="tab === 'reports' && report">
    <v-card title="Occupancy" class="mb-4">
      <v-table density="compact">
        <thead>
          <tr>
            <th>Hostel</th>
            <th>Rooms</th>
            <th>Beds</th>
            <th>Occupied</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in report.occupancy" :key="o.hostelId">
            <td>{{ o.name }}</td>
            <td>{{ o.rooms }}</td>
            <td>{{ o.beds }}</td>
            <td>{{ o.occupied }}</td>
            <td>{{ o.occupancyPercent }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
    <v-row>
      <v-col cols="12" md="6">
        <v-card title="Complaints">
          <v-table density="compact">
            <tbody>
              <tr v-for="c in report.complaints" :key="c.category + c.status">
                <td>{{ c.category }}</td>
                <td>{{ c.status }}</td>
                <td>{{ c.count }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-col>
      <v-col cols="12" md="6">
        <v-card title="Out-passes">
          <v-table density="compact">
            <tbody>
              <tr v-for="o in report.outpasses" :key="o.status">
                <td>{{ o.status }}</td>
                <td>{{ o.count }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
        <v-card title="Charges" class="mt-4">
          <v-table density="compact">
            <tbody>
              <tr v-for="c in report.charges" :key="c.period + c.status">
                <td>{{ c.period }}</td>
                <td>{{ c.status }}</td>
                <td>{{ c.count }}</td>
                <td>{{ c.amount }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-col>
    </v-row>
  </template>

  <v-dialog v-model="cancelOutpass.open" max-width="480">
    <v-card v-if="cancelOutpass.item" title="Cancel out-pass">
      <v-card-text>
        <p class="mb-2">
          <strong>{{ cancelOutpass.item.studentName }}</strong> ·
          {{ new Date(cancelOutpass.item.fromAt).toLocaleString() }} →
          {{ new Date(cancelOutpass.item.toAt).toLocaleString() }}
        </p>
        <p class="text-medium-emphasis">
          Cancelling withdraws the out-pass (e.g. plans changed). It is not a rejection — use Reject
          to refuse a pending request.
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="cancelOutpass.open = false">Keep</v-btn>
        <v-btn color="warning" @click="confirmCancelOutpass">Cancel out-pass</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

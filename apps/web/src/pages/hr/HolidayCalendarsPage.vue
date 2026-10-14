<script setup lang="ts">
import {
  HOLIDAY_CALENDAR_SCOPES,
  HOLIDAY_TYPES,
  type ApiListResponse,
  type HolidayCalendarDetailDto,
  type HolidayCalendarDto,
  type HolidayCalendarScope,
  type HolidayType,
  type ResolvedDayDto,
  type WeeklyOffRule,
} from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { PAGE_SIZE_OPTIONS, useServerList } from '@/lib/serverList';
import EmployeePicker from '@/components/EmployeePicker.vue';
import { useAuthStore } from '@/stores/auth';
import WeeklyOffsPicker from '@/components/WeeklyOffsPicker.vue';
import { weeklyOffsText } from './timeOffice';
import { label, useHrOptions, type Option } from './useHrOptions';

/**
 * Holiday calendars: organization → group → institution → campus inheritance. Each level adds,
 * overrides (same date) or removes (`removed`) holidays and may override the weekly-off pattern.
 */
const auth = useAuthStore();
const { institutions, loadBase } = useHrOptions();
const groups = ref<Option[]>([]);
const year = ref(new Date().getFullYear());
const canManage = computed(() => auth.can('holiday.manage'));
// Year is read when loading (not a reactive param) so typing a year reloads only on change.
const { items, total, page, pageSize, loading, error, load, reset } =
  useServerList<HolidayCalendarDto>(() => `/api/v1/holidays/calendars?year=${year.value}`, {
    immediate: false,
  });
onMounted(async () => {
  await Promise.all([load(), loadBase()]);
  if (auth.can('group.view')) {
    groups.value = await apiFetch<ApiListResponse<Option>>('/api/v1/groups?pageSize=100')
      .then((r) => r.data)
      .catch(() => []);
  }
});

const targetName = (c: HolidayCalendarDto) =>
  c.institutionId
    ? (institutions.value.find((i) => i.id === c.institutionId)?.name ?? c.institutionId)
    : c.groupId
      ? (groups.value.find((g) => g.id === c.groupId)?.name ?? c.groupId)
      : 'Organization';

// Create / edit calendar
const dialog = reactive({
  open: false,
  id: null as string | null,
  scope: 'INSTITUTION' as HolidayCalendarScope,
  targetId: null as string | null,
  name: '',
  inheritWeeklyOffs: true,
  weeklyOffs: [] as WeeklyOffRule[],
});
function openDialog(c?: HolidayCalendarDto) {
  Object.assign(dialog, {
    open: true,
    id: c?.id ?? null,
    scope: c?.scope ?? 'INSTITUTION',
    targetId: null,
    name: c?.name ?? '',
    inheritWeeklyOffs: !c || c.weeklyOffs === null,
    weeklyOffs: (c?.weeklyOffs ?? [{ weekday: 0 }]).map((r) => ({ ...r })),
  });
}
const targets = computed(() => (dialog.scope === 'GROUP' ? groups.value : institutions.value));
async function save() {
  const weeklyOffs = dialog.inheritWeeklyOffs ? null : dialog.weeklyOffs;
  try {
    await apiFetch(
      dialog.id ? `/api/v1/holidays/calendars/${dialog.id}` : '/api/v1/holidays/calendars',
      {
        method: dialog.id ? 'PATCH' : 'POST',
        body: JSON.stringify(
          dialog.id
            ? { name: dialog.name.trim(), weeklyOffs }
            : {
                scope: dialog.scope,
                targetId: dialog.scope === 'ORGANIZATION' ? null : dialog.targetId,
                year: Number(year.value),
                name: dialog.name.trim(),
                weeklyOffs,
              },
        ),
      },
    );
    dialog.open = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function remove(c: HolidayCalendarDto) {
  if (!confirm(`Delete calendar "${c.name}"?`)) return;
  try {
    await apiFetch(`/api/v1/holidays/calendars/${c.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// Holidays of one calendar
const detail = ref<HolidayCalendarDetailDto | null>(null);
const holiday = reactive({ date: '', name: '', type: 'PUBLIC' as HolidayType, removed: false });
async function openDetail(c: HolidayCalendarDto) {
  try {
    detail.value = (
      await apiFetch<{ data: HolidayCalendarDetailDto }>(`/api/v1/holidays/calendars/${c.id}`)
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function addHoliday() {
  if (!detail.value) return;
  try {
    await apiFetch(`/api/v1/holidays/calendars/${detail.value.id}/holidays`, {
      method: 'POST',
      body: JSON.stringify({ ...holiday, name: holiday.name.trim() }),
    });
    Object.assign(holiday, { date: '', name: '', type: 'PUBLIC', removed: false });
    await openDetail(detail.value);
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function deleteHoliday(id: string) {
  if (!detail.value) return;
  try {
    await apiFetch(`/api/v1/holidays/calendars/${detail.value.id}/holidays/${id}`, {
      method: 'DELETE',
    });
    await openDetail(detail.value);
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// Effective calendar preview for an employee
const preview = reactive({
  employeeId: null as string | null,
  from: '',
  to: '',
  days: [] as ResolvedDayDto[],
});
async function resolve() {
  try {
    preview.days = (
      await apiFetch<{ data: ResolvedDayDto[] }>(
        `/api/v1/holidays/resolve?employeeId=${preview.employeeId}&from=${preview.from}&to=${preview.to}`,
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const headers = [
  { title: 'Name', key: 'name' },
  { title: 'Scope', key: 'scope' },
  { title: 'Applies to', key: 'target', sortable: false },
  { title: 'Weekly offs', key: 'weeklyOffs', sortable: false },
  { title: 'Holidays', key: 'holidayCount' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
const scopes = HOLIDAY_CALENDAR_SCOPES.filter((s) => s !== 'CAMPUS').map((value) => ({
  value,
  title: label(value),
}));
const types = HOLIDAY_TYPES.map((value) => ({ value, title: label(value) }));
</script>

<template>
  <div class="d-flex align-center mb-4 ga-2">
    <h2 class="text-h5">Holiday calendars</h2>
    <v-spacer />
    <v-text-field
      v-model.number="year"
      type="number"
      label="Year"
      density="compact"
      hide-details
      style="max-width: 120px"
      @change="reset"
    />
    <v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" @click="openDialog()">
      New calendar
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-data-table-server
    v-model:page="page"
    v-model:items-per-page="pageSize"
    :items="items"
    :headers="headers"
    :loading="loading"
    :items-length="total"
    :items-per-page-options="PAGE_SIZE_OPTIONS"
    disable-sort
  >
    <template #[`item.scope`]="{ item }">{{ label(item.scope) }}</template>
    <template #[`item.target`]="{ item }">{{ targetName(item) }}</template>
    <template #[`item.weeklyOffs`]="{ item }">{{ weeklyOffsText(item.weeklyOffs) }}</template>
    <template #[`item.actions`]="{ item }">
      <v-btn size="small" variant="text" icon="mdi-calendar-star" @click="openDetail(item)" />
      <template v-if="canManage">
        <v-btn size="small" variant="text" icon="mdi-pencil" @click="openDialog(item)" />
        <v-btn size="small" variant="text" icon="mdi-delete" @click="remove(item)" />
      </template>
    </template>
  </v-data-table-server>

  <h3 class="text-h6 mt-8 mb-2">Effective calendar for an employee</h3>
  <div class="d-flex ga-2 align-center">
    <EmployeePicker
      v-model="preview.employeeId"
      density="compact"
      hide-details
      style="min-width: 280px"
    />
    <v-text-field v-model="preview.from" type="date" label="From" density="compact" hide-details />
    <v-text-field v-model="preview.to" type="date" label="To" density="compact" hide-details />
    <v-btn
      :disabled="!preview.employeeId || !preview.from || !preview.to"
      variant="tonal"
      @click="resolve"
    >
      Resolve
    </v-btn>
  </div>
  <v-table v-if="preview.days.length" density="compact" class="mt-2">
    <tbody>
      <tr v-for="d in preview.days" :key="d.date + d.kind">
        <td>{{ d.date }}</td>
        <td>{{ label(d.kind) }}</td>
        <td>{{ d.name }}</td>
      </tr>
    </tbody>
  </v-table>

  <v-dialog v-model="dialog.open" max-width="540">
    <v-card :title="dialog.id ? 'Edit calendar' : `New calendar (${year})`">
      <v-card-text>
        <template v-if="!dialog.id">
          <v-select v-model="dialog.scope" :items="scopes" label="Scope *" />
          <v-autocomplete
            v-if="dialog.scope !== 'ORGANIZATION'"
            v-model="dialog.targetId"
            :items="targets"
            item-title="name"
            item-value="id"
            :label="dialog.scope === 'GROUP' ? 'Group *' : 'Institution *'"
          />
        </template>
        <v-text-field v-model="dialog.name" label="Name *" />
        <v-checkbox v-model="dialog.inheritWeeklyOffs" label="Inherit weekly offs" hide-details />
        <WeeklyOffsPicker
          v-if="!dialog.inheritWeeklyOffs"
          v-model="dialog.weeklyOffs"
          class="mt-2"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog.open = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="!dialog.name" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog :model-value="!!detail" max-width="720" @update:model-value="detail = null">
    <v-card v-if="detail" :title="`${detail.name} — holidays`">
      <v-card-text>
        <v-table density="compact">
          <tbody>
            <tr v-for="h in detail.holidays" :key="h.id">
              <td>{{ h.date }}</td>
              <td :class="{ 'text-decoration-line-through': h.removed }">{{ h.name }}</td>
              <td>{{ h.removed ? 'Removed (inherited)' : label(h.type) }}</td>
              <td class="text-right">
                <v-btn
                  v-if="canManage"
                  size="small"
                  variant="text"
                  icon="mdi-delete"
                  @click="deleteHoliday(h.id)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
        <div v-if="canManage" class="d-flex ga-2 mt-4 align-center">
          <v-text-field v-model="holiday.date" type="date" label="Date" hide-details />
          <v-text-field v-model="holiday.name" label="Name" hide-details />
          <v-select v-model="holiday.type" :items="types" label="Type" hide-details />
          <v-checkbox v-model="holiday.removed" label="Remove" hide-details />
          <v-btn :disabled="!holiday.date || !holiday.name" color="primary" @click="addHoliday">
            Add
          </v-btn>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

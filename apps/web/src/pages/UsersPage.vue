<script setup lang="ts">
import type { ApiListResponse, ScopeSummary, ScopeType } from '@erp/shared';
import { computed, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { PAGE_SIZE_OPTIONS, useServerList } from '@/lib/serverList';
import { useTerms } from '@/lib/terms';
import { useAuthStore } from '@/stores/auth';

interface UserRow {
  id: string;
  email: string;
  name: string;
  membershipStatus: string;
  roles: Array<{ id: string; key: string; name: string; scopes: ScopeSummary[] }>;
}
interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
}
interface Named {
  id: string;
  name: string;
  institutionId?: string | null;
}
type AssignableScope = ScopeType;
interface AssignmentRow {
  roleId: string | null;
  scopeType: AssignableScope;
  scopeIds: string[];
}

const auth = useAuthStore();
const terms = useTerms();
const canCreate = computed(() => auth.can('user.create'));
const canAssign = computed(() => auth.can('user.role.assign'));
const canDeactivate = computed(() => auth.can('user.deactivate'));
const canResetPassword = computed(() => auth.can('user.reset_password'));
const notice = ref<string | null>(null);

const error = ref<string | null>(null);
// The server returns only users within the caller's scopes.
const { items, total, page, pageSize, search, loading, load } = useServerList<UserRow>(
  '/api/v1/users',
  { error },
);

const roles = ref<RoleRow[]>([]);
const groups = ref<Named[]>([]);
const institutions = ref<Named[]>([]);
const campuses = ref<Named[]>([]);
const departments = ref<Named[]>([]);
let optionsLoaded = false;
async function loadOptions() {
  if (optionsLoaded) return;
  const list = <T,>(path: string) =>
    apiFetch<ApiListResponse<T>>(`/api/v1/${path}?pageSize=100`)
      .then((r) => r.data)
      .catch(() => [] as T[]);
  [roles.value, groups.value, institutions.value, campuses.value, departments.value] =
    await Promise.all([
      list<RoleRow>('roles'),
      list<Named>('groups'),
      list<Named>('institutions'),
      list<Named>('campuses'),
      list<Named>('departments'),
    ]);
  optionsLoaded = true;
}

const scopeLabel = (s: ScopeSummary) =>
  s.type === 'ORGANIZATION'
    ? 'Organization'
    : `${scopeTypeTitle(s.type).toLowerCase()}: ${s.name ?? s.id}`;

function scopeTypeTitle(t: ScopeType): string {
  if (t === 'GROUP') return terms.value.group;
  if (t === 'INSTITUTION') return terms.value.institution;
  if (t === 'CAMPUS') return 'Campus';
  if (t === 'DEPARTMENT') return 'Department';
  return 'Whole organization';
}
const scopeTypes = computed(() =>
  (['ORGANIZATION', 'GROUP', 'INSTITUTION', 'CAMPUS', 'DEPARTMENT'] as AssignableScope[])
    .filter((t) => t !== 'CAMPUS' || campuses.value.length > 0)
    .map((value) => ({ value, title: scopeTypeTitle(value) })),
);
const instName = (id?: string | null) => institutions.value.find((i) => i.id === id)?.name;
function scopeOptions(t: AssignableScope) {
  if (t === 'GROUP') return groups.value.map((g) => ({ value: g.id, title: g.name }));
  if (t === 'INSTITUTION') return institutions.value.map((i) => ({ value: i.id, title: i.name }));
  if (t === 'CAMPUS') return campuses.value.map((c) => ({ value: c.id, title: c.name }));
  if (t === 'DEPARTMENT')
    return departments.value.map((d) => ({
      value: d.id,
      title: instName(d.institutionId) ? `${d.name} — ${instName(d.institutionId)}` : d.name,
    }));
  return [];
}
const roleItems = computed(() =>
  roles.value.map((r) => ({ value: r.id, title: r.name, subtitle: r.description ?? '' })),
);

const dialog = reactive({
  open: false,
  mode: 'create' as 'create' | 'roles',
  userId: null as string | null,
  email: '',
  name: '',
  password: '',
  rows: [] as AssignmentRow[],
  saving: false,
  error: null as string | null,
});
const newRow = (): AssignmentRow => ({
  roleId: null,
  scopeType: institutions.value.length === 1 ? 'INSTITUTION' : 'ORGANIZATION',
  scopeIds: institutions.value.length === 1 ? [institutions.value[0]!.id] : [],
});

async function openCreate() {
  await loadOptions();
  Object.assign(dialog, {
    open: true,
    mode: 'create',
    userId: null,
    email: '',
    name: '',
    password: '',
    rows: [newRow()],
    saving: false,
    error: null,
  });
}
async function openRoles(u: UserRow) {
  await loadOptions();
  // Group the existing assignment's scopes per role and scope type (one row each).
  const rows: AssignmentRow[] = [];
  for (const r of u.roles) {
    const byType = new Map<ScopeType, string[]>();
    for (const s of r.scopes)
      byType.set(s.type, [...(byType.get(s.type) ?? []), ...(s.id ? [s.id] : [])]);
    for (const [scopeType, scopeIds] of byType) rows.push({ roleId: r.id, scopeType, scopeIds });
  }
  Object.assign(dialog, {
    open: true,
    mode: 'roles',
    userId: u.id,
    email: u.email,
    name: u.name,
    password: '',
    rows,
    saving: false,
    error: null,
  });
}

function buildAssignments() {
  const byRole = new Map<string, Array<{ type: ScopeType; id?: string }>>();
  for (const [i, r] of dialog.rows.entries()) {
    if (!r.roleId) throw new Error(`Row ${i + 1}: choose a role`);
    if (r.scopeType !== 'ORGANIZATION' && r.scopeIds.length === 0)
      throw new Error(
        `Row ${i + 1}: choose at least one ${scopeTypeTitle(r.scopeType).toLowerCase()}`,
      );
    const scopes =
      r.scopeType === 'ORGANIZATION'
        ? [{ type: 'ORGANIZATION' as const }]
        : r.scopeIds.map((id) => ({ type: r.scopeType, id }));
    byRole.set(r.roleId, [...(byRole.get(r.roleId) ?? []), ...scopes]);
  }
  return [...byRole].map(([roleId, scopes]) => ({ roleId, scopes }));
}

async function save() {
  dialog.error = null;
  let assignments;
  try {
    if (dialog.mode === 'create') {
      if (!dialog.name.trim()) throw new Error('Name is required');
      if (!/^\S+@\S+\.\S+$/.test(dialog.email.trim())) throw new Error('Enter a valid email');
    }
    assignments = buildAssignments();
  } catch (e) {
    dialog.error = (e as Error).message;
    return;
  }
  dialog.saving = true;
  try {
    if (dialog.mode === 'create') {
      await apiFetch('/api/v1/users', {
        method: 'POST',
        body: JSON.stringify({
          email: dialog.email.trim(),
          name: dialog.name.trim(),
          ...(dialog.password ? { password: dialog.password } : {}),
          roles: assignments,
        }),
      });
    } else {
      await apiFetch(`/api/v1/users/${dialog.userId}/roles`, {
        method: 'PUT',
        body: JSON.stringify({ roles: assignments }),
      });
    }
    dialog.open = false;
    await load();
  } catch (e) {
    dialog.error = (e as Error).message;
  } finally {
    dialog.saving = false;
  }
}

async function setActive(u: UserRow, active: boolean) {
  if (!active && !confirm(`Deactivate ${u.name}? They will be signed out and unable to log in.`))
    return;
  try {
    await apiFetch(`/api/v1/users/${u.id}/${active ? 'reactivate' : 'deactivate'}`, {
      method: 'POST',
    });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function sendPasswordReset(u: UserRow) {
  if (!confirm(`Send a password reset link to ${u.email}?`)) return;
  try {
    const res = await apiFetch<{ data: { expiresAt: string; deliveryStatus: string } }>(
      `/api/v1/users/${u.id}/password-reset`,
      { method: 'POST' },
    );
    notice.value =
      res.data.deliveryStatus === 'FAILED'
        ? `Reset link for ${u.email} could not be delivered. Check e-mail settings.`
        : `Password reset link sent to ${u.email} (valid until ${new Date(res.data.expiresAt).toLocaleString()}).`;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const headers = [
  { title: 'Name', key: 'name' },
  { title: 'Email', key: 'email' },
  { title: 'Status', key: 'membershipStatus' },
  { title: 'Roles', key: 'roles', sortable: false },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
</script>

<template>
  <div class="d-flex align-center mb-4 ga-2">
    <h2 class="text-h5">Users</h2>
    <v-spacer />
    <v-text-field
      v-model="search"
      density="compact"
      prepend-inner-icon="mdi-magnify"
      label="Search"
      hide-details
      style="max-width: 280px"
    />
    <v-btn v-if="canCreate" color="primary" prepend-icon="mdi-account-plus" @click="openCreate">
      Add user
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-alert v-if="notice" type="success" class="mb-4" closable @click:close="notice = null">
    {{ notice }}
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
    <template #[`item.roles`]="{ item }">
      <v-chip v-for="role in item.roles" :key="role.id" size="small" class="mr-1 my-1">
        {{ role.name }}
        <span class="text-medium-emphasis ml-1"
          >({{ role.scopes.map(scopeLabel).join(', ') }})</span
        >
      </v-chip>
    </template>
    <template #[`item.membershipStatus`]="{ item }">
      <v-chip size="small" :color="item.membershipStatus === 'ACTIVE' ? 'success' : 'default'">
        {{ item.membershipStatus }}
      </v-chip>
    </template>
    <template #[`item.actions`]="{ item }">
      <v-btn
        v-if="canAssign"
        size="small"
        variant="text"
        prepend-icon="mdi-shield-account"
        @click="openRoles(item)"
      >
        Roles
      </v-btn>
      <v-btn
        v-if="
          canResetPassword && item.membershipStatus === 'ACTIVE' && item.id !== auth.me?.user?.id
        "
        size="small"
        variant="text"
        prepend-icon="mdi-lock-reset"
        @click="sendPasswordReset(item)"
      >
        Reset password
      </v-btn>
      <v-btn
        v-if="canDeactivate && item.id !== auth.me?.user?.id"
        size="small"
        variant="text"
        :color="item.membershipStatus === 'DISABLED' ? 'success' : 'error'"
        @click="setActive(item, item.membershipStatus === 'DISABLED')"
      >
        {{ item.membershipStatus === 'DISABLED' ? 'Reactivate' : 'Deactivate' }}
      </v-btn>
    </template>
  </v-data-table-server>

  <v-dialog v-model="dialog.open" max-width="820" scrollable>
    <v-card :title="dialog.mode === 'create' ? 'Add user' : `Roles — ${dialog.name}`">
      <v-card-subtitle v-if="dialog.mode === 'roles'">{{ dialog.email }}</v-card-subtitle>
      <v-card-text>
        <v-alert
          v-if="dialog.error"
          type="error"
          density="compact"
          class="mb-3"
          closable
          @click:close="dialog.error = null"
        >
          {{ dialog.error }}
        </v-alert>
        <v-row v-if="dialog.mode === 'create'" dense>
          <v-col cols="12" md="6"><v-text-field v-model="dialog.name" label="Full name" /></v-col>
          <v-col cols="12" md="6">
            <v-text-field v-model="dialog.email" label="Email (login)" type="email" />
          </v-col>
          <v-col cols="12">
            <v-text-field
              v-model="dialog.password"
              label="Initial password (optional)"
              type="password"
              hint="Leave empty to send an invite email instead"
              persistent-hint
              autocomplete="new-password"
            />
          </v-col>
        </v-row>

        <div class="text-subtitle-1 mt-3">Roles</div>
        <div class="text-caption text-medium-emphasis mb-2">
          A role grants its permissions only within the chosen scope — e.g. "HR Manager" for one
          {{ terms.institution.toLowerCase() }}, or for the whole organization.
        </div>
        <v-row v-for="(r, i) in dialog.rows" :key="i" dense align="center">
          <v-col cols="12" md="4">
            <v-autocomplete
              v-model="r.roleId"
              :items="roleItems"
              label="Role"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="3">
            <v-select
              v-model="r.scopeType"
              :items="scopeTypes"
              label="Applies to"
              density="compact"
              hide-details
              @update:model-value="r.scopeIds = []"
            />
          </v-col>
          <v-col cols="10" md="4">
            <v-autocomplete
              v-if="r.scopeType !== 'ORGANIZATION'"
              v-model="r.scopeIds"
              :items="scopeOptions(r.scopeType)"
              :label="scopeTypeTitle(r.scopeType)"
              multiple
              chips
              closable-chips
              density="compact"
              hide-details
            />
            <span v-else class="text-body-2 text-medium-emphasis">Everything</span>
          </v-col>
          <v-col cols="2" md="1" class="text-right">
            <v-btn
              icon="mdi-delete-outline"
              size="small"
              variant="text"
              @click="dialog.rows.splice(i, 1)"
            />
          </v-col>
        </v-row>
        <v-btn
          class="mt-2"
          size="small"
          variant="tonal"
          prepend-icon="mdi-plus"
          @click="dialog.rows.push(newRow())"
        >
          Add role
        </v-btn>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="dialog.open = false">Cancel</v-btn>
        <v-btn color="primary" :loading="dialog.saving" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/**
 * Lets HR give an employee a login: create a user with the "Employee" self-service role scoped to
 * the employee's institution (or link an existing user), then link it via `employee.userId`.
 */
import {
  passwordPolicyViolations,
  type ApiListResponse,
  type EmployeeDetailDto,
} from '@erp/shared';
import { computed, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

interface UserRow {
  id: string;
  email: string;
  name: string;
  membershipStatus: string;
}
interface RoleRow {
  id: string;
  key: string;
}

const props = defineProps<{ employee: EmployeeDetailDto }>();
const emit = defineEmits<{ changed: [] }>();
const auth = useAuthStore();

const linked = ref<UserRow | null>(null);
const users = ref<UserRow[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);
const dialog = ref(false);
const mode = ref<'create' | 'link'>('create');
const form = reactive({ email: '', name: '', password: '', userId: null as string | null });

const passwordProblems = computed(() =>
  form.password ? passwordPolicyViolations(form.password, form.email) : [],
);
const canManage = computed(() => auth.can('employee.update') && auth.can('user.create'));

async function loadLinked() {
  linked.value = null;
  if (!props.employee.userId || !auth.can('user.view')) return;
  try {
    linked.value = (
      await apiFetch<{ data: UserRow }>(`/api/v1/users/${props.employee.userId}`)
    ).data;
  } catch {
    linked.value = null;
  }
}
watch(() => props.employee.userId, loadLinked, { immediate: true });

async function open() {
  error.value = null;
  form.email = props.employee.workEmail ?? '';
  form.name = props.employee.displayName;
  form.password = '';
  form.userId = null;
  mode.value = 'create';
  dialog.value = true;
  if (auth.can('user.view')) {
    users.value = (await apiFetch<ApiListResponse<UserRow>>('/api/v1/users?pageSize=100')).data;
  }
}

async function linkUser(userId: string | null) {
  await apiFetch(`/api/v1/employees/${props.employee.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ userId }),
  });
}

async function save() {
  busy.value = true;
  error.value = null;
  try {
    let userId = form.userId;
    if (mode.value === 'create') {
      const roles = (await apiFetch<ApiListResponse<RoleRow>>('/api/v1/roles?pageSize=100')).data;
      const role = roles.find((r) => r.key === 'employee');
      if (!role) throw new Error('The "Employee" role is missing for this organization');
      const created = await apiFetch<{ data: { id: string } }>('/api/v1/users', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email.trim(),
          name: form.name.trim(),
          ...(form.password ? { password: form.password } : {}),
          roles: [
            {
              roleId: role.id,
              scopes: [{ type: 'INSTITUTION', id: props.employee.institutionId }],
            },
          ],
        }),
      });
      userId = created.data.id;
    }
    if (!userId) throw new Error('Choose a user');
    await linkUser(userId);
    dialog.value = false;
    emit('changed');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function unlink() {
  if (!confirm('Remove login access link for this employee? The user account is kept.')) return;
  try {
    await linkUser(null);
    emit('changed');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <v-card title="Login access">
    <v-card-text>
      <v-alert v-if="error && !dialog" type="error" density="compact" class="mb-2">
        {{ error }}
      </v-alert>
      <template v-if="employee.userId">
        <div class="d-flex align-center ga-2">
          <v-icon color="success">mdi-account-check</v-icon>
          <div>
            <div>{{ linked?.name ?? 'Linked user' }}</div>
            <div class="text-medium-emphasis text-body-2">
              {{ linked?.email ?? employee.userId }}
              <span v-if="linked?.membershipStatus === 'INVITED'"> · invite pending</span>
            </div>
          </div>
          <v-spacer />
          <v-btn v-if="canManage" size="small" variant="text" color="error" @click="unlink">
            Unlink
          </v-btn>
        </div>
        <div class="text-body-2 text-medium-emphasis mt-2">
          The employee signs in with this email and uses the Employee workspace (attendance, leave,
          payslips, approvals).
        </div>
      </template>
      <template v-else>
        <div class="text-medium-emphasis mb-2">
          No login yet. Without one the employee cannot punch attendance, apply for leave or see
          payslips.
        </div>
        <v-btn v-if="canManage" color="primary" prepend-icon="mdi-account-plus" @click="open">
          Create login
        </v-btn>
        <div v-else class="text-body-2">Ask an administrator with user management rights.</div>
      </template>
    </v-card-text>

    <v-dialog v-model="dialog" max-width="520">
      <v-card title="Give login access">
        <v-card-text>
          <v-alert v-if="error" type="error" density="compact" class="mb-3">{{ error }}</v-alert>
          <v-btn-toggle v-model="mode" mandatory density="compact" class="mb-4" color="primary">
            <v-btn value="create">New login</v-btn>
            <v-btn value="link" :disabled="!users.length">Existing user</v-btn>
          </v-btn-toggle>
          <template v-if="mode === 'create'">
            <v-text-field v-model="form.email" label="Email (login id) *" type="email" />
            <v-text-field v-model="form.name" label="Name *" />
            <v-text-field
              v-model="form.password"
              label="Initial password"
              type="password"
              hint="12+ characters with 3 of: lowercase, uppercase, digit, symbol. Leave empty to email an invite link instead."
              persistent-hint
              :error-messages="passwordProblems"
            />
            <div class="text-body-2 text-medium-emphasis mt-3">
              Gets the "Employee" self-service role for {{ employee.institution?.name }}.
            </div>
          </template>
          <v-autocomplete
            v-else
            v-model="form.userId"
            :items="users"
            item-value="id"
            :item-title="(u: UserRow) => `${u.name} (${u.email})`"
            label="User *"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="dialog = false">Cancel</v-btn>
          <v-btn
            color="primary"
            :loading="busy"
            :disabled="mode === 'create' && passwordProblems.length > 0"
            @click="save"
          >
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
import { passwordPolicyViolations } from '@erp/shared';
import { computed, ref, watch } from 'vue';
import { ApiError, apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const open = defineModel<boolean>({ default: false });
const auth = useAuthStore();

const current = ref('');
const next = ref('');
const confirm = ref('');
const saving = ref(false);
const error = ref<string | null>(null);
const success = ref(false);

watch(open, (v) => {
  if (!v) return;
  current.value = next.value = confirm.value = '';
  error.value = null;
  success.value = false;
});

const problems = computed(() =>
  next.value ? passwordPolicyViolations(next.value, auth.me?.user.email) : [],
);
const mismatch = computed(() => !!confirm.value && confirm.value !== next.value);
const canSave = computed(
  () => !!current.value && !!next.value && !problems.value.length && confirm.value === next.value,
);

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  error.value = null;
  try {
    await apiFetch('/api/v1/auth/password/change', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: current.value, newPassword: next.value }),
    });
    success.value = true;
  } catch (err) {
    error.value =
      err instanceof ApiError && err.code === 'INVALID_CREDENTIALS'
        ? 'Current password is incorrect'
        : err instanceof Error
          ? err.message
          : 'Could not change password';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="460">
    <v-card title="Change password">
      <v-card-text>
        <v-alert v-if="success" type="success" variant="tonal">
          Password changed. Your other devices have been signed out.
        </v-alert>
        <v-form v-else id="change-password-form" @submit.prevent="save">
          <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">
            {{ error }}
          </v-alert>
          <v-text-field
            v-model="current"
            label="Current password"
            type="password"
            autocomplete="current-password"
          />
          <v-text-field
            v-model="next"
            label="New password"
            type="password"
            autocomplete="new-password"
            :error-messages="problems"
            hint="At least 12 characters with 3 of: lowercase, uppercase, digit, symbol"
          />
          <v-text-field
            v-model="confirm"
            label="Confirm new password"
            type="password"
            autocomplete="new-password"
            :error-messages="mismatch ? ['Passwords do not match'] : []"
          />
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">{{ success ? 'Close' : 'Cancel' }}</v-btn>
        <v-btn
          v-if="!success"
          color="primary"
          type="submit"
          form="change-password-form"
          :loading="saving"
          :disabled="!canSave"
        >
          Change password
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

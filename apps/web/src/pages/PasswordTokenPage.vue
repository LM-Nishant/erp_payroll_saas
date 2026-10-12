<script setup lang="ts">
import { passwordPolicyViolations } from '@erp/shared';
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ApiError, rawFetch } from '@/api/client';

/**
 * Public, token-based password pages:
 * - `forgot`: request a reset link by e-mail (always "sent", never reveals if the account exists)
 * - `reset`: set a new password from an e-mailed `?token=`
 * - `invite`: accept an invitation (`?token=`) by choosing a password
 */
const props = defineProps<{ mode: 'forgot' | 'reset' | 'invite' }>();
const route = useRoute();

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''));
const email = ref(typeof route.query.email === 'string' ? route.query.email : '');
const name = ref('');
const password = ref('');
const confirm = ref('');
const loading = ref(false);
const error = ref<string | null>(null);
const done = ref(false);

const title = computed(
  () =>
    ({ forgot: 'Forgot password', reset: 'Set a new password', invite: 'Accept invitation' })[
      props.mode
    ],
);
const problems = computed(() =>
  password.value ? passwordPolicyViolations(password.value, email.value || undefined) : [],
);
const mismatch = computed(() => !!confirm.value && confirm.value !== password.value);
const canSubmit = computed(() =>
  props.mode === 'forgot'
    ? !!email.value.trim()
    : !!token.value &&
      !!password.value &&
      !problems.value.length &&
      confirm.value === password.value,
);

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'INVALID_TOKEN')
      return 'This link is invalid or has expired. Request a new one.';
    if (err.code === 'RATE_LIMITED') return 'Too many requests. Please wait a moment.';
    return err.message;
  }
  return 'Something went wrong';
}

async function submit() {
  if (!canSubmit.value) return;
  loading.value = true;
  error.value = null;
  try {
    if (props.mode === 'forgot') {
      await rawFetch('/api/v1/auth/password/forgot', {
        method: 'POST',
        body: JSON.stringify({ email: email.value.trim() }),
      });
    } else if (props.mode === 'reset') {
      await rawFetch('/api/v1/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({ token: token.value, newPassword: password.value }),
      });
    } else {
      await rawFetch('/api/v1/auth/accept-invite', {
        method: 'POST',
        body: JSON.stringify({
          token: token.value,
          password: password.value,
          ...(name.value.trim() ? { name: name.value.trim() } : {}),
        }),
      });
    }
    done.value = true;
  } catch (err) {
    error.value = messageFor(err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <v-main>
    <v-container class="fill-height d-flex justify-center" max-width="440">
      <v-card class="pa-6 w-100" elevation="2">
        <v-card-title class="text-h5 px-0">{{ title }}</v-card-title>

        <template v-if="done">
          <v-alert type="success" variant="tonal" class="mb-4">
            <template v-if="mode === 'forgot'">
              If an account exists for <strong>{{ email }}</strong
              >, a password reset link has been sent. Check your inbox.
            </template>
            <template v-else-if="mode === 'reset'">
              Your password has been changed. You have been signed out of all devices.
            </template>
            <template v-else>Your account is ready.</template>
          </v-alert>
          <v-btn color="primary" block to="/login">Go to sign in</v-btn>
        </template>

        <template v-else>
          <v-alert v-if="error" type="error" variant="tonal" class="mb-4" density="compact">
            {{ error }}
          </v-alert>
          <v-alert
            v-if="mode !== 'forgot' && !token"
            type="warning"
            variant="tonal"
            class="mb-4"
            density="compact"
          >
            This link is missing its token. Open the link from your e-mail again.
          </v-alert>

          <v-form @submit.prevent="submit">
            <template v-if="mode === 'forgot'">
              <p class="text-body-2 mb-4">
                Enter your account e-mail and we will send you a link to reset your password.
              </p>
              <v-text-field
                v-model="email"
                label="Email"
                type="email"
                autocomplete="username"
                required
              />
            </template>
            <template v-else>
              <v-text-field
                v-if="mode === 'invite'"
                v-model="name"
                label="Your name (optional)"
                autocomplete="name"
              />
              <v-text-field
                v-model="password"
                label="New password"
                type="password"
                autocomplete="new-password"
                :error-messages="problems"
                required
              />
              <v-text-field
                v-model="confirm"
                label="Confirm password"
                type="password"
                autocomplete="new-password"
                :error-messages="mismatch ? ['Passwords do not match'] : []"
                required
              />
            </template>
            <v-btn type="submit" color="primary" block :loading="loading" :disabled="!canSubmit">
              {{
                mode === 'forgot'
                  ? 'Send reset link'
                  : mode === 'reset'
                    ? 'Reset password'
                    : 'Activate account'
              }}
            </v-btn>
            <v-btn variant="text" block class="mt-2" to="/login">Back to sign in</v-btn>
          </v-form>
        </template>
      </v-card>
    </v-container>
  </v-main>
</template>

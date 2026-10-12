<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const step = ref<'credentials' | 'organization' | 'mfa'>('credentials');
const email = ref('');
const password = ref('');
const organization = ref<string | undefined>();
const organizations = ref<Array<{ slug: string; name: string }>>([]);
const code = ref('');
const useRecovery = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'ACCOUNT_LOCKED') return 'Too many failed attempts. Try again later.';
    if (err.code === 'RATE_LIMITED') return 'Too many requests. Please wait a moment.';
    return err.message;
  }
  return 'Unable to sign in';
}

async function done() {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
  await router.replace(redirect.startsWith('/') ? redirect : '/');
}

async function submitCredentials() {
  loading.value = true;
  error.value = null;
  try {
    const outcome = await auth.login(email.value, password.value, organization.value);
    if (outcome.status === 'ok') await done();
    else if (outcome.status === 'mfa') step.value = 'mfa';
    else {
      organizations.value = outcome.organizations;
      organization.value = outcome.organizations[0]?.slug;
      step.value = 'organization';
    }
  } catch (err) {
    error.value = messageFor(err);
  } finally {
    loading.value = false;
  }
}

async function submitMfa() {
  loading.value = true;
  error.value = null;
  try {
    await auth.verifyMfa(useRecovery.value ? { recoveryCode: code.value } : { code: code.value });
    await done();
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
        <v-card-title class="text-h5 px-0">Sign in</v-card-title>
        <v-alert v-if="error" type="error" variant="tonal" class="mb-4" density="compact">
          {{ error }}
        </v-alert>

        <v-form v-if="step !== 'mfa'" @submit.prevent="submitCredentials">
          <v-text-field
            v-model="email"
            label="Email"
            type="email"
            autocomplete="username"
            :disabled="step === 'organization'"
            required
          />
          <v-text-field
            v-model="password"
            label="Password"
            type="password"
            autocomplete="current-password"
            :disabled="step === 'organization'"
            required
          />
          <v-select
            v-if="step === 'organization'"
            v-model="organization"
            :items="organizations"
            item-title="name"
            item-value="slug"
            label="Organization"
          />
          <v-btn type="submit" color="primary" block :loading="loading">Continue</v-btn>
          <v-btn
            variant="text"
            block
            class="mt-2"
            :to="{ name: 'forgot-password', query: email ? { email } : {} }"
          >
            Forgot password?
          </v-btn>
        </v-form>

        <v-form v-else @submit.prevent="submitMfa">
          <p class="text-body-2 mb-4">
            {{
              useRecovery
                ? 'Enter one of your recovery codes.'
                : 'Enter the 6-digit code from your authenticator app.'
            }}
          </p>
          <v-text-field
            v-model="code"
            :label="useRecovery ? 'Recovery code' : 'Authentication code'"
            autocomplete="one-time-code"
            :inputmode="useRecovery ? 'text' : 'numeric'"
            autofocus
            required
          />
          <v-btn type="submit" color="primary" block :loading="loading">Verify</v-btn>
          <v-btn variant="text" block class="mt-2" @click="useRecovery = !useRecovery">
            {{ useRecovery ? 'Use authenticator code' : 'Use a recovery code' }}
          </v-btn>
        </v-form>
      </v-card>
    </v-container>
  </v-main>
</template>

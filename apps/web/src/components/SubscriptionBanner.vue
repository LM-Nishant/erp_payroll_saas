<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';

/** Tenant-wide notice for non-active subscriptions (trial, past due, cancelled / lapsed). */
const auth = useAuthStore();
const date = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : null);
const banner = computed(() => {
  const s = auth.me?.subscription;
  if (!s) return null;
  if (s.status === 'CANCELLED' || !s.active) {
    return {
      type: 'error' as const,
      title: s.status === 'TRIAL' ? 'Trial expired' : 'Subscription cancelled',
      text: `Your ${s.planName} subscription is not active, so licensed modules are switched off. Contact your provider to reactivate it.`,
    };
  }
  if (s.status === 'PAST_DUE') {
    return {
      type: 'warning' as const,
      title: 'Payment overdue',
      text: `Your ${s.planName} subscription has an unpaid invoice. Modules stay available for now — please settle the outstanding invoice to avoid interruption.`,
    };
  }
  if (s.status === 'TRIAL') {
    const ends = date(s.trialEndsAt);
    return {
      type: 'info' as const,
      title: 'Trial',
      text: `You are on a ${s.planName} trial${ends ? ` until ${ends}` : ''}.`,
    };
  }
  return null;
});
</script>

<template>
  <v-alert
    v-if="banner"
    :type="banner.type"
    :title="banner.title"
    variant="tonal"
    density="compact"
    class="mb-4"
    data-testid="subscription-banner"
    :data-status="auth.me?.subscription?.status"
  >
    {{ banner.text }}
  </v-alert>
</template>

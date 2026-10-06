import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

/**
 * Session store. Layer 1 has no authentication: the developer picks an organization slug,
 * which is sent via the dev-only X-Dev-Organization header. Layer 2 replaces this with the
 * authenticated principal (JWT); the server — never the client — decides the tenant.
 */
export const useSessionStore = defineStore('session', () => {
  const devOrganization = ref<string>(localStorage.getItem('devOrganization') ?? 'abbs');
  /** Permission codes granted to the user (populated by the auth layer). '*' = all. */
  const permissions = ref<string[]>(['*']);

  function setDevOrganization(slug: string) {
    devOrganization.value = slug;
    localStorage.setItem('devOrganization', slug);
  }

  const can = computed(
    () => (permission?: string) =>
      !permission || permissions.value.includes('*') || permissions.value.includes(permission),
  );

  return { devOrganization, permissions, setDevOrganization, can };
});

import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';

/** Wording that differs between education and company organizations. */
export function useTerms() {
  const auth = useAuthStore();
  const isCompany = computed(() => auth.me?.organization?.kind === 'COMPANY');
  return computed(() => ({
    isCompany: isCompany.value,
    appName: isCompany.value ? 'HRMS & Payroll' : 'Education ERP',
    institution: isCompany.value ? 'Company' : 'Institution',
    institutions: isCompany.value ? 'Companies' : 'Institutions',
    group: isCompany.value ? 'Head office' : 'Group',
  }));
}

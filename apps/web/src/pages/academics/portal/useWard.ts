import type { StudentDto } from '@erp/shared';
import { ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

/** Parents pick one of their wards; students always see themselves (no studentId). */
export function useWard() {
  const auth = useAuthStore();
  const wards = ref<StudentDto[]>([]);
  const studentId = ref<string | undefined>(undefined);
  async function loadWards() {
    if (auth.can('student.view_own') || !auth.can('ward.view')) return;
    wards.value = (await apiFetch<{ data: StudentDto[] }>('/api/v1/students/my-wards')).data;
    studentId.value = wards.value[0]?.id;
  }
  const withStudent = (path: string, params: Record<string, string | undefined> = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ studentId: studentId.value, ...params }))
      if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `${path}?${qs}` : path;
  };
  return { wards, studentId, loadWards, withStudent };
}

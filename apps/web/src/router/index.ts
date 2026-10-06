import { createRouter, createWebHistory, type Router, type RouteRecordRaw } from 'vue-router';
import { guardDecision } from '@/navigation/guard';
import { useAuthStore } from '@/stores/auth';

const placeholder = (title: string) => ({
  component: () => import('@/pages/PlaceholderPage.vue'),
  props: { title },
});

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    meta: { public: true },
    component: () => import('@/pages/LoginPage.vue'),
  },
  { path: '/', name: 'home', component: () => import('@/pages/HomePage.vue') },
  {
    path: '/forbidden',
    name: 'forbidden',
    ...placeholder('You do not have access to this page'),
  },
  {
    path: '/platform',
    component: () => import('@/layouts/PlatformLayout.vue'),
    meta: { permission: 'platform.organization.view' },
    children: [{ path: '', name: 'platform-dashboard', ...placeholder('Platform dashboard') }],
  },
  {
    path: '/group',
    component: () => import('@/layouts/GroupLayout.vue'),
    meta: { permission: 'group.view' },
    children: [
      { path: '', name: 'group-dashboard', ...placeholder('Group dashboard') },
      {
        path: 'institutions',
        name: 'group-institutions',
        meta: { permission: 'institution.view' },
        component: () => import('@/pages/group/InstitutionsPage.vue'),
      },
      {
        path: 'users',
        name: 'group-users',
        meta: { permission: 'user.view' },
        component: () => import('@/pages/UsersPage.vue'),
      },
    ],
  },
  {
    path: '/institution',
    component: () => import('@/layouts/InstitutionLayout.vue'),
    meta: { permission: 'institution.view' },
    children: [
      { path: '', name: 'institution-dashboard', ...placeholder('Institution dashboard') },
      {
        path: 'departments',
        name: 'institution-departments',
        meta: { permission: 'department.view' },
        ...placeholder('Departments'),
      },
      {
        path: 'users',
        name: 'institution-users',
        meta: { permission: 'user.view' },
        component: () => import('@/pages/UsersPage.vue'),
      },
    ],
  },
  {
    path: '/employee',
    component: () => import('@/layouts/EmployeeLayout.vue'),
    children: [{ path: '', name: 'employee-home', ...placeholder('Employee home') }],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({ history: createWebHistory(), routes });

export function installGuards(r: Router) {
  r.beforeEach(async (to) => {
    const auth = useAuthStore();
    await auth.init();
    return guardDecision(to, { isAuthenticated: auth.isAuthenticated, can: auth.can });
  });
}

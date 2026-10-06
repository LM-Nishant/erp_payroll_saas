import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const placeholder = (title: string) => ({
  component: () => import('@/pages/PlaceholderPage.vue'),
  props: { title },
});

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('@/pages/HomePage.vue') },
  {
    path: '/platform',
    component: () => import('@/layouts/PlatformLayout.vue'),
    children: [{ path: '', name: 'platform-dashboard', ...placeholder('Platform dashboard') }],
  },
  {
    path: '/group',
    component: () => import('@/layouts/GroupLayout.vue'),
    children: [
      { path: '', name: 'group-dashboard', ...placeholder('Group dashboard') },
      {
        path: 'institutions',
        name: 'group-institutions',
        component: () => import('@/pages/group/InstitutionsPage.vue'),
      },
    ],
  },
  {
    path: '/institution',
    component: () => import('@/layouts/InstitutionLayout.vue'),
    children: [
      { path: '', name: 'institution-dashboard', ...placeholder('Institution dashboard') },
      { path: 'departments', name: 'institution-departments', ...placeholder('Departments') },
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

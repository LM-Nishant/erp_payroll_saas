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
    path: '/module-disabled',
    name: 'module-disabled',
    ...placeholder('This module is not enabled for your organization'),
  },
  {
    path: '/platform',
    component: () => import('@/layouts/PlatformLayout.vue'),
    meta: { permission: 'platform.organization.view' },
    children: [
      { path: '', name: 'platform-dashboard', ...placeholder('Platform dashboard') },
      {
        path: 'notifications',
        name: 'platform-notifications',
        component: () => import('@/pages/NotificationsPage.vue'),
      },
    ],
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
      {
        path: 'documents',
        name: 'group-documents',
        meta: { permission: 'document.view', feature: 'documents' },
        component: () => import('@/pages/DocumentsPage.vue'),
      },
      {
        path: 'subscription',
        name: 'group-subscription',
        meta: { permission: 'subscription.view' },
        component: () => import('@/pages/settings/SubscriptionPage.vue'),
      },
      {
        path: 'modules',
        name: 'group-modules',
        meta: { permission: 'feature.view' },
        component: () => import('@/pages/settings/FeaturesPage.vue'),
      },
      {
        path: 'branding',
        name: 'group-branding',
        meta: { permission: 'branding.view' },
        component: () => import('@/pages/settings/BrandingPage.vue'),
      },
      {
        path: 'notifications',
        name: 'group-notifications',
        component: () => import('@/pages/NotificationsPage.vue'),
      },
      {
        path: 'approvals',
        name: 'group-approvals',
        component: () => import('@/pages/ApprovalsPage.vue'),
      },
      {
        path: 'communication',
        name: 'group-communication',
        meta: { permission: 'communication.view', feature: 'communication' },
        component: () => import('@/pages/settings/CommunicationPage.vue'),
      },
      {
        path: 'integrations',
        name: 'group-integrations',
        meta: { permission: 'integration.view' },
        component: () => import('@/pages/settings/IntegrationsPage.vue'),
      },
      {
        path: 'secrets',
        name: 'group-secrets',
        meta: { permission: 'secret.view' },
        component: () => import('@/pages/settings/SecretsPage.vue'),
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
      {
        path: 'documents',
        name: 'institution-documents',
        meta: { permission: 'document.view', feature: 'documents' },
        component: () => import('@/pages/DocumentsPage.vue'),
      },
      {
        path: 'notifications',
        name: 'institution-notifications',
        component: () => import('@/pages/NotificationsPage.vue'),
      },
      {
        path: 'approvals',
        name: 'institution-approvals',
        component: () => import('@/pages/ApprovalsPage.vue'),
      },
      {
        path: 'communication',
        name: 'institution-communication',
        meta: { permission: 'communication.view', feature: 'communication' },
        component: () => import('@/pages/settings/CommunicationPage.vue'),
      },
      {
        path: 'branding',
        name: 'institution-branding',
        meta: { permission: 'branding.view' },
        component: () => import('@/pages/settings/BrandingPage.vue'),
      },
    ],
  },
  {
    path: '/hr',
    component: () => import('@/layouts/HrLayout.vue'),
    meta: { permission: 'employee.view', feature: 'hr' },
    children: [
      { path: '', redirect: { name: 'hr-employees' } },
      {
        path: 'employees',
        name: 'hr-employees',
        component: () => import('@/pages/hr/EmployeesPage.vue'),
      },
      {
        path: 'employees/:id',
        name: 'hr-employee',
        props: true,
        component: () => import('@/pages/hr/EmployeeDetailPage.vue'),
      },
      {
        path: 'designations',
        name: 'hr-designations',
        meta: { permission: 'designation.view' },
        component: () => import('@/pages/hr/DesignationsPage.vue'),
      },
      {
        path: 'attendance',
        name: 'hr-attendance',
        meta: { permission: 'attendance.view' },
        component: () => import('@/pages/hr/AttendancePage.vue'),
      },
      {
        path: 'leave',
        name: 'hr-leave',
        meta: { permission: 'leave.view' },
        component: () => import('@/pages/hr/LeaveRequestsPage.vue'),
      },
      {
        path: 'leave-setup',
        name: 'hr-leave-setup',
        meta: { permission: 'leave.view' },
        component: () => import('@/pages/hr/LeaveSetupPage.vue'),
      },
      {
        path: 'shifts',
        name: 'hr-shifts',
        meta: { permission: 'shift.view' },
        component: () => import('@/pages/hr/ShiftsPage.vue'),
      },
      {
        path: 'holidays',
        name: 'hr-holidays',
        meta: { permission: 'holiday.view' },
        component: () => import('@/pages/hr/HolidayCalendarsPage.vue'),
      },
      {
        path: 'documents',
        name: 'hr-documents',
        meta: { permission: 'document.view', feature: 'documents' },
        component: () => import('@/pages/DocumentsPage.vue'),
      },
      {
        path: 'notifications',
        name: 'hr-notifications',
        component: () => import('@/pages/NotificationsPage.vue'),
      },
      {
        path: 'approvals',
        name: 'hr-approvals',
        component: () => import('@/pages/ApprovalsPage.vue'),
      },
    ],
  },
  {
    path: '/employee',
    component: () => import('@/layouts/EmployeeLayout.vue'),
    children: [
      { path: '', name: 'employee-home', ...placeholder('Employee home') },
      {
        path: 'profile',
        name: 'employee-profile',
        meta: { permission: 'employee.view_own', feature: 'hr' },
        component: () => import('@/pages/hr/MyEmployeeProfilePage.vue'),
      },
      {
        path: 'attendance',
        name: 'employee-attendance',
        meta: { permission: 'attendance.view_own', feature: 'hr' },
        component: () => import('@/pages/hr/MyAttendancePage.vue'),
      },
      {
        path: 'leave',
        name: 'employee-leave',
        meta: { permission: 'leave.view_own', feature: 'hr' },
        component: () => import('@/pages/hr/MyLeavePage.vue'),
      },
      {
        path: 'notifications',
        name: 'employee-notifications',
        component: () => import('@/pages/NotificationsPage.vue'),
      },
      {
        path: 'approvals',
        name: 'employee-approvals',
        component: () => import('@/pages/ApprovalsPage.vue'),
      },
      {
        path: 'documents',
        name: 'employee-documents',
        meta: { permission: 'document.view_own', feature: 'documents' },
        component: () => import('@/pages/DocumentsPage.vue'),
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({ history: createWebHistory(), routes });

export function installGuards(r: Router) {
  r.beforeEach(async (to) => {
    const auth = useAuthStore();
    await auth.init();
    return guardDecision(to, {
      isAuthenticated: auth.isAuthenticated,
      can: auth.can,
      hasFeature: auth.hasFeature,
    });
  });
}

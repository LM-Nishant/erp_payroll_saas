import { createRouter, createWebHistory, type Router, type RouteRecordRaw } from 'vue-router';
import { guardDecision } from '@/navigation/guard';
import { useAuthStore } from '@/stores/auth';
import { feesFinanceRoutes, portalFeesRoute } from './fees-finance-routes';

const placeholder = (title: string) => ({
  component: () => import('@/pages/PlaceholderPage.vue'),
  props: { title },
});

/** Library staff pages (group + institution layouts). */
const libraryStaffRoutes = (layout: string): RouteRecordRaw[] =>
  (
    [
      ['', 'dashboard', () => import('@/pages/library/LibraryDashboardPage.vue')],
      ['/catalogue', 'catalogue', () => import('@/pages/library/CataloguePage.vue')],
      ['/books/:id', 'book', () => import('@/pages/library/BookDetailPage.vue')],
      ['/copies', 'copies', () => import('@/pages/library/CopiesPage.vue')],
      ['/desk', 'desk', () => import('@/pages/library/DeskPage.vue')],
      ['/reservations', 'reservations', () => import('@/pages/library/ReservationsPage.vue')],
      ['/members', 'members', () => import('@/pages/library/MembersPage.vue')],
      ['/fines', 'fines', () => import('@/pages/library/FinesPage.vue')],
      ['/reports', 'reports', () => import('@/pages/library/ReportsPage.vue')],
      ['/settings', 'settings', () => import('@/pages/library/LibrarySettingsPage.vue')],
    ] as const
  ).map(([path, name, component]) => ({
    path: `library${path}`,
    name: `${layout}-library-${name}`,
    meta: { permission: 'library.view', feature: 'library' },
    component,
  }));

/** Library self-service pages (portal + employee layouts). */
const librarySelfRoutes = (layout: string): RouteRecordRaw[] => [
  {
    path: 'library',
    name: `${layout}-library`,
    meta: { permission: 'library.view_own', feature: 'library' },
    component: () => import('@/pages/library/MyLibraryPage.vue'),
  },
  {
    path: 'opac',
    name: `${layout}-opac`,
    meta: { permission: 'library.view_own', feature: 'library' },
    component: () => import('@/pages/library/OpacPage.vue'),
  },
];

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
      { path: '', name: 'platform-dashboard', redirect: { name: 'platform-organizations' } },
      {
        path: 'organizations',
        name: 'platform-organizations',
        component: () => import('@/pages/platform/OrganizationsPage.vue'),
      },
      {
        path: 'organizations/:id',
        name: 'platform-organization',
        component: () => import('@/pages/platform/OrganizationDetailPage.vue'),
      },
      {
        path: 'plans',
        name: 'platform-plans',
        meta: { permission: 'platform.plan.manage' },
        component: () => import('@/pages/platform/PlansPage.vue'),
      },
      {
        path: 'invoices',
        name: 'platform-invoices',
        meta: { permission: 'platform.subscription.manage' },
        component: () => import('@/pages/platform/InvoicesPage.vue'),
      },
      {
        path: 'billing-settings',
        name: 'platform-billing-settings',
        meta: { permission: 'platform.subscription.manage' },
        component: () => import('@/pages/platform/BillingSettingsPage.vue'),
      },
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
    meta: { permission: 'group.view', tenant: true },
    children: [
      {
        path: '',
        name: 'group-dashboard',
        component: () => import('@/pages/WorkspaceDashboard.vue'),
        props: { layout: 'group' },
      },
      {
        path: 'institutions',
        name: 'group-institutions',
        meta: { permission: 'institution.view', tenant: true },
        component: () => import('@/pages/group/InstitutionsPage.vue'),
      },
      {
        path: 'users',
        name: 'group-users',
        meta: { permission: 'user.view' },
        component: () => import('@/pages/UsersPage.vue'),
      },
      {
        path: 'students',
        name: 'group-students',
        meta: { permission: 'student.view', feature: 'education' },
        component: () => import('@/pages/students/StudentsPage.vue'),
      },
      {
        path: 'students/:id',
        name: 'group-student-detail',
        props: true,
        meta: { permission: 'student.view', feature: 'education' },
        component: () => import('@/pages/students/StudentDetailPage.vue'),
      },
      {
        path: 'admissions',
        name: 'group-admissions',
        meta: { permission: 'admission.view', feature: 'education' },
        component: () => import('@/pages/students/AdmissionsPage.vue'),
      },
      {
        path: 'classes',
        name: 'group-classes',
        meta: { permission: 'program.view', feature: 'education' },
        component: () => import('@/pages/academics/ClassesPage.vue'),
      },
      {
        path: 'subjects',
        name: 'group-subjects',
        meta: { permission: 'subject.view', feature: 'education' },
        component: () => import('@/pages/academics/SubjectsPage.vue'),
      },
      {
        path: 'subject-allocations',
        name: 'group-allocations',
        meta: { permission: 'subject.view', feature: 'education' },
        component: () => import('@/pages/academics/AllocationsPage.vue'),
      },
      {
        path: 'timetable',
        name: 'group-timetable',
        meta: { permission: 'timetable.view', feature: 'education' },
        component: () => import('@/pages/academics/TimetablePage.vue'),
      },
      {
        path: 'student-attendance',
        name: 'group-student-attendance',
        meta: { permission: 'student_attendance.view', feature: 'education' },
        component: () => import('@/pages/academics/StudentAttendancePage.vue'),
      },
      {
        path: 'exams',
        name: 'group-exams',
        meta: { permission: 'exam.view', feature: 'education' },
        component: () => import('@/pages/academics/ExamsPage.vue'),
      },
      {
        path: 'results',
        name: 'group-results',
        props: { mode: 'results' },
        meta: { permission: 'exam.view', feature: 'education' },
        component: () => import('@/pages/academics/ResultsPage.vue'),
      },
      {
        path: 'report-cards',
        name: 'group-report-cards',
        props: { mode: 'cards' },
        meta: { permission: 'exam.view', feature: 'education' },
        component: () => import('@/pages/academics/ResultsPage.vue'),
      },
      {
        path: 'transport/:tab?',
        name: 'group-transport',
        meta: { permission: 'transport.view', feature: 'transport' },
        component: () => import('@/pages/transport/TransportPage.vue'),
      },
      {
        path: 'hostel/:tab?',
        name: 'group-hostel',
        meta: { permission: 'hostel.view', feature: 'hostel' },
        component: () => import('@/pages/hostel/HostelPage.vue'),
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
        path: 'payroll',
        name: 'group-payroll',
        meta: { permission: 'payroll.report', feature: 'payroll' },
        component: () => import('@/pages/payroll/GroupPayrollReportPage.vue'),
      },
      {
        path: 'communication',
        name: 'group-communication',
        meta: { permission: 'communication.view', feature: 'communication' },
        component: () => import('@/pages/settings/CommunicationPage.vue'),
      },
      {
        path: 'announcements',
        name: 'group-announcements',
        meta: { permission: 'message.broadcast', feature: 'communication' },
        component: () => import('@/pages/communication/AnnouncementsPage.vue'),
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
      {
        path: 'ai',
        name: 'group-ai-tools',
        meta: { permission: 'ai.use', feature: 'ai' },
        component: () => import('@/pages/ai/AiToolsPage.vue'),
      },
      {
        path: 'ai/settings',
        name: 'group-ai-settings',
        meta: { permission: 'ai.manage', feature: 'ai' },
        component: () => import('@/pages/ai/AiSettingsPage.vue'),
      },
      {
        path: 'ai/usage',
        name: 'group-ai-usage',
        meta: { permission: 'ai.view_usage', feature: 'ai' },
        component: () => import('@/pages/ai/AiUsagePage.vue'),
      },
      ...feesFinanceRoutes('group'),
      ...libraryStaffRoutes('group'),
    ],
  },
  {
    path: '/institution',
    component: () => import('@/layouts/InstitutionLayout.vue'),
    meta: { permission: 'institution.view' },
    children: [
      {
        path: '',
        name: 'institution-dashboard',
        component: () => import('@/pages/WorkspaceDashboard.vue'),
        props: { layout: 'institution' },
      },
      {
        path: 'branches',
        name: 'institution-branches',
        meta: { permission: 'campus.view' },
        component: () => import('@/pages/BranchesPage.vue'),
      },
      {
        path: 'departments',
        name: 'institution-departments',
        meta: { permission: 'department.view' },
        component: () => import('@/pages/hr/DepartmentsPage.vue'),
      },
      {
        path: 'users',
        name: 'institution-users',
        meta: { permission: 'user.view' },
        component: () => import('@/pages/UsersPage.vue'),
      },
      {
        path: 'students',
        name: 'institution-students',
        meta: { permission: 'student.view', feature: 'education' },
        component: () => import('@/pages/students/StudentsPage.vue'),
      },
      {
        path: 'students/:id',
        name: 'student-detail',
        props: true,
        meta: { permission: 'student.view', feature: 'education' },
        component: () => import('@/pages/students/StudentDetailPage.vue'),
      },
      {
        path: 'admissions',
        name: 'institution-admissions',
        meta: { permission: 'admission.view', feature: 'education' },
        component: () => import('@/pages/students/AdmissionsPage.vue'),
      },
      {
        path: 'classes',
        name: 'institution-classes',
        meta: { permission: 'program.view', feature: 'education' },
        component: () => import('@/pages/academics/ClassesPage.vue'),
      },
      {
        path: 'subjects',
        name: 'institution-subjects',
        meta: { permission: 'subject.view', feature: 'education' },
        component: () => import('@/pages/academics/SubjectsPage.vue'),
      },
      {
        path: 'subject-allocations',
        name: 'institution-allocations',
        meta: { permission: 'subject.view', feature: 'education' },
        component: () => import('@/pages/academics/AllocationsPage.vue'),
      },
      {
        path: 'timetable',
        name: 'institution-timetable',
        meta: { permission: 'timetable.view', feature: 'education' },
        component: () => import('@/pages/academics/TimetablePage.vue'),
      },
      {
        path: 'student-attendance',
        name: 'institution-student-attendance',
        meta: { permission: 'student_attendance.view', feature: 'education' },
        component: () => import('@/pages/academics/StudentAttendancePage.vue'),
      },
      {
        path: 'exams',
        name: 'institution-exams',
        meta: { permission: 'exam.view', feature: 'education' },
        component: () => import('@/pages/academics/ExamsPage.vue'),
      },
      {
        path: 'marks-entry',
        name: 'institution-marks-entry',
        meta: { permission: 'exam.marks_entry', feature: 'education' },
        component: () => import('@/pages/academics/MarksEntryPage.vue'),
      },
      {
        path: 'results',
        name: 'institution-results',
        props: { mode: 'results' },
        meta: { permission: 'exam.view', feature: 'education' },
        component: () => import('@/pages/academics/ResultsPage.vue'),
      },
      {
        path: 'report-cards',
        name: 'institution-report-cards',
        props: { mode: 'cards' },
        meta: { permission: 'exam.view', feature: 'education' },
        component: () => import('@/pages/academics/ResultsPage.vue'),
      },
      {
        path: 'my-classes',
        name: 'institution-my-classes',
        meta: { permission: 'student_attendance.mark', feature: 'education' },
        component: () => import('@/pages/academics/MyClassesPage.vue'),
      },
      {
        path: 'transport/:tab?',
        name: 'institution-transport',
        meta: { permission: 'transport.view', feature: 'transport' },
        component: () => import('@/pages/transport/TransportPage.vue'),
      },
      {
        path: 'hostel/:tab?',
        name: 'institution-hostel',
        meta: { permission: 'hostel.view', feature: 'hostel' },
        component: () => import('@/pages/hostel/HostelPage.vue'),
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
        path: 'announcements',
        name: 'institution-announcements',
        meta: { permission: 'message.broadcast', feature: 'communication' },
        component: () => import('@/pages/communication/AnnouncementsPage.vue'),
      },
      {
        path: 'branding',
        name: 'institution-branding',
        meta: { permission: 'branding.view' },
        component: () => import('@/pages/settings/BrandingPage.vue'),
      },
      ...feesFinanceRoutes('institution'),
      ...libraryStaffRoutes('institution'),
    ],
  },
  {
    path: '/hr',
    component: () => import('@/layouts/HrLayout.vue'),
    meta: { permission: 'employee.view', feature: 'hr', tenant: true },
    children: [
      {
        path: '',
        name: 'hr-dashboard',
        component: () => import('@/pages/WorkspaceDashboard.vue'),
        props: { layout: 'hr' },
      },
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
        path: 'departments',
        name: 'hr-departments',
        meta: { permission: 'department.view' },
        component: () => import('@/pages/hr/DepartmentsPage.vue'),
      },
      {
        path: 'employee-types',
        name: 'hr-employee-types',
        meta: { permission: 'designation.view' },
        component: () => import('@/pages/hr/EmployeeTypesPage.vue'),
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
        path: 'payroll/runs',
        name: 'hr-payroll-runs',
        meta: { permission: 'payroll.view', feature: 'payroll' },
        component: () => import('@/pages/payroll/PayrollRunsPage.vue'),
      },
      {
        path: 'payroll/runs/:id',
        name: 'hr-payroll-run',
        props: true,
        meta: { permission: 'payroll.view', feature: 'payroll' },
        component: () => import('@/pages/payroll/PayrollRunDetailPage.vue'),
      },
      {
        path: 'payroll/components',
        name: 'hr-payroll-components',
        meta: { permission: 'payroll.view', feature: 'payroll' },
        component: () => import('@/pages/payroll/SalaryComponentsPage.vue'),
      },
      {
        path: 'payroll/structures',
        name: 'hr-payroll-structures',
        meta: { permission: 'payroll.view', feature: 'payroll' },
        component: () => import('@/pages/payroll/SalaryStructuresPage.vue'),
      },
      {
        path: 'payroll/salary',
        name: 'hr-payroll-salary',
        meta: { permission: 'salary.view', feature: 'payroll' },
        component: () => import('@/pages/payroll/EmployeeSalaryPage.vue'),
      },
      {
        path: 'payroll/payslips',
        name: 'hr-payroll-payslips',
        meta: { permission: 'payroll.view', feature: 'payroll' },
        component: () => import('@/pages/payroll/PayslipsPage.vue'),
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
      {
        path: 'ai',
        name: 'hr-ai-tools',
        meta: { permission: 'ai.use', feature: 'ai' },
        component: () => import('@/pages/ai/AiToolsPage.vue'),
      },
    ],
  },
  {
    path: '/employee',
    component: () => import('@/layouts/EmployeeLayout.vue'),
    meta: { tenant: true },
    children: [
      {
        path: '',
        name: 'employee-home',
        component: () => import('@/pages/WorkspaceDashboard.vue'),
        props: { layout: 'employee' },
      },
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
        path: 'payslips',
        name: 'employee-payslips',
        meta: { permission: 'payroll.view_own', feature: 'payroll' },
        component: () => import('@/pages/payroll/MyPayslipsPage.vue'),
      },
      {
        path: 'salary',
        name: 'employee-salary',
        meta: { permission: 'payroll.view_own', feature: 'payroll' },
        component: () => import('@/pages/payroll/MySalaryPage.vue'),
      },
      {
        path: 'documents',
        name: 'employee-documents',
        meta: { permission: 'document.view_own', feature: 'documents' },
        component: () => import('@/pages/DocumentsPage.vue'),
      },
      {
        path: 'assets',
        name: 'employee-assets',
        meta: { permission: 'asset.view_own', feature: 'assets' },
        component: () => import('@/pages/assets/MyAssetsPage.vue'),
      },
      ...librarySelfRoutes('employee'),
    ],
  },
  {
    path: '/portal',
    component: () => import('@/layouts/PortalLayout.vue'),
    meta: { tenant: true, feature: 'education' },
    children: [
      { path: '', redirect: { name: 'portal-profile' } },
      {
        path: 'profile',
        name: 'portal-profile',
        meta: { permission: 'student.view_own', feature: 'education' },
        component: () => import('@/pages/students/MyStudentProfilePage.vue'),
      },
      {
        path: 'wards',
        name: 'portal-wards',
        meta: { permission: 'ward.view', feature: 'education' },
        component: () => import('@/pages/students/MyWardsPage.vue'),
      },
      {
        path: 'certificates',
        name: 'portal-certificates',
        meta: { permission: 'certificate.view_own', feature: 'education' },
        component: () => import('@/pages/students/MyCertificatesPage.vue'),
      },
      {
        path: 'timetable',
        name: 'portal-timetable',
        meta: { permission: 'timetable.view_own', feature: 'education' },
        component: () => import('@/pages/academics/portal/MyTimetablePage.vue'),
      },
      {
        path: 'attendance',
        name: 'portal-attendance',
        meta: { permission: 'student_attendance.view_own', feature: 'education' },
        component: () => import('@/pages/academics/portal/MyAttendancePage.vue'),
      },
      {
        path: 'results',
        name: 'portal-results',
        meta: { permission: 'exam.view_own', feature: 'education' },
        component: () => import('@/pages/academics/portal/MyResultsPage.vue'),
      },
      {
        path: 'documents',
        name: 'portal-documents',
        meta: { permission: 'document.view_own', feature: 'documents' },
        component: () => import('@/pages/DocumentsPage.vue'),
      },
      portalFeesRoute,
      ...librarySelfRoutes('portal'),
      {
        path: 'transport',
        name: 'portal-transport',
        meta: { permission: 'transport.view_own', feature: 'transport' },
        component: () => import('@/pages/transport/MyTransportPage.vue'),
      },
      {
        path: 'hostel',
        name: 'portal-hostel',
        meta: { permission: 'hostel.view_own', feature: 'hostel' },
        component: () => import('@/pages/hostel/MyHostelPage.vue'),
      },
    ],
  },
  {
    path: '/assets',
    component: () => import('@/layouts/AssetsLayout.vue'),
    meta: { permission: 'asset.view', feature: 'assets', tenant: true },
    children: [
      {
        path: '',
        name: 'assets-dashboard',
        component: () => import('@/pages/assets/AssetDashboardPage.vue'),
      },
      {
        path: 'register',
        name: 'assets-register',
        component: () => import('@/pages/assets/AssetsPage.vue'),
      },
      {
        path: 'register/:id',
        name: 'assets-detail',
        props: true,
        component: () => import('@/pages/assets/AssetDetailPage.vue'),
      },
      {
        path: 'categories',
        name: 'assets-categories',
        component: () => import('@/pages/assets/AssetCategoriesPage.vue'),
      },
      {
        path: 'assignments',
        name: 'assets-assignments',
        component: () => import('@/pages/assets/AssetAssignmentsPage.vue'),
      },
      {
        path: 'maintenance',
        name: 'assets-maintenance',
        component: () => import('@/pages/assets/AssetMaintenancePage.vue'),
      },
      {
        path: 'inventory',
        name: 'assets-inventory',
        component: () => import('@/pages/assets/AssetInventoryPage.vue'),
      },
      {
        path: 'audit',
        name: 'assets-audit',
        meta: { permission: 'asset.audit' },
        component: () => import('@/pages/assets/AssetAuditPage.vue'),
      },
      {
        path: 'disposal',
        name: 'assets-disposal',
        component: () => import('@/pages/assets/AssetDisposalPage.vue'),
      },
      {
        path: 'reports',
        name: 'assets-reports',
        component: () => import('@/pages/assets/AssetReportsPage.vue'),
      },
      {
        path: 'notifications',
        name: 'assets-notifications',
        component: () => import('@/pages/NotificationsPage.vue'),
      },
      {
        path: 'approvals',
        name: 'assets-approvals',
        component: () => import('@/pages/ApprovalsPage.vue'),
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
      hasOrganization: !auth.me || Boolean(auth.me.organization),
    });
  });
}

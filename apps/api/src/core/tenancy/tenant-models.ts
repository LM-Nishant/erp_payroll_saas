/**
 * Registry of Prisma models and how the tenancy engine treats them.
 *
 * EVERY model with an `organizationId` column MUST be listed in TENANT_SCOPED_MODELS (or, for
 * the few auth/audit tables whose organizationId is nullable, CORE_MANAGED_MODELS).
 * A unit test (tenant-models.test.ts) fails the build if a model is missing.
 */

/** Models owned by a tenant: all queries are filtered by organization_id. */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'Group',
  'Institution',
  'Campus',
  'Department',
  'Program',
  'ClassSection',
  'OrganizationMembership',
  'Role',
  'RolePermission',
  'UserRole',
  'UserScope',
  // Licensing, branding, secrets (core/features, core/branding, core/secrets)
  'OrganizationSubscription',
  'Invoice',
  'FeatureOverride',
  'UsageCounter',
  'BrandingProfile',
  'TenantSecret',
  // Storage + documents (core/storage, core/documents)
  'StorageUpload',
  'Document',
  'DocumentVersion',
  'DocumentPermission',
  'DocumentExpiryReminder',
  'DocumentSignature',
  // Workflow, notification, communication & integration engines (Layer 5)
  'WorkflowDefinition',
  'WorkflowInstance',
  'WorkflowStepInstance',
  'WorkflowStepAssignee',
  'WorkflowAction',
  'Notification',
  'NotificationRule',
  'NotificationJob',
  'NotificationPreference',
  'PushDevice',
  'CommunicationProvider',
  'MessageTemplate',
  'MessageTemplateVersion',
  'MessageLog',
  'DeliveryEvent',
  'Campaign',
  'CampaignRecipient',
  'ApiClient',
  'ApiScope',
  'ApiUsage',
  'DomainEvent',
  'Webhook',
  'WebhookEvent',
  'IntegrationCredential',
  // HR employee master (Layer 6)
  'Designation',
  'EmployeeCodeSequence',
  'Employee',
  'EmployeeProfile',
  'EmployeePosition',
  'EmployeeDepartment',
  'EmployeeReportingLine',
  'EmployeeMovement',
  'EmployeeSalaryHistory',
  'EmployeeChecklistItem',
  'EmployeeProfileChangeRequest',
  'EmployeeImportJob',
  // Attendance / leave / holiday / shift (Layer 7)
  'HolidayCalendar',
  'Holiday',
  'Shift',
  'ShiftAssignment',
  'AttendancePunch',
  'AttendanceRecord',
  'AttendanceRegularization',
  'AttendancePeriodLock',
  'AttendancePolicy',
  'AttendanceImportJob',
  'LeaveType',
  'LeavePolicy',
  'LeavePolicyRule',
  'LeaveLedgerEntry',
  'LeaveRequest',
  // Payroll (modules/payroll)
  'SalaryComponent',
  'SalaryRule',
  'SalaryStructure',
  'SalaryStructureVersion',
  'PayrollSetting',
  'StatutoryRulePack',
  'EmployeeSalary',
  'SalaryRevision',
  'PayrollBatch',
  'PayrollRun',
  'PayrollRunEmployee',
  'PayrollItem',
  'PayrollAdjustment',
  'PayrollPayment',
  'Payslip',
  'Form16Record',
  'Loan',
  'LoanInstallment',
  'ReimbursementClaim',
]);

/**
 * Tables with a NULLABLE organizationId (null = platform-level row) that are written and read
 * only by core services (core/auth, core/audit) through the base client with explicit
 * organization predicates. The tenant client REJECTS them; feature modules never touch them.
 */
export const CORE_MANAGED_MODELS: ReadonlySet<string> = new Set([
  'AuthSession',
  'LoginEvent',
  'UserToken',
  'AuditLog',
]);

/** Models with a `deletedAt` column whose soft-deleted rows are hidden by default. */
export const SOFT_DELETE_MODELS: ReadonlySet<string> = new Set([
  'Organization',
  'Group',
  'Institution',
  'Campus',
  'Department',
  'Program',
  'ClassSection',
  'User',
  'OrganizationMembership',
  'Role',
  'Document',
  'Designation',
  'Employee',
]);

/** The tenant root. Through the tenant client it is read-only and limited to the current org. */
export const TENANT_ROOT_MODEL = 'Organization';

/** Models that are platform-global (not tenant data). Must be listed explicitly. */
export const GLOBAL_MODELS: ReadonlySet<string> = new Set([
  TENANT_ROOT_MODEL,
  // Platform identity & auth internals (core/auth only).
  'User',
  'PlatformRoleAssignment',
  'RefreshToken',
  'MfaRecoveryCode',
  // Permission catalog (synced from @erp/shared); readable by everyone, written by core only.
  'Permission',
  // Subscription plan catalog (platform-managed).
  'SubscriptionPlan',
  'PlatformBillingSettings',
]);

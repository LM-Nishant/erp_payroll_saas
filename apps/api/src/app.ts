import './engines';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './core/config/env';
import { authenticate } from './core/auth';
import { principalContext } from './core/authz';
import { prisma } from './core/db/prisma';
import { errorHandler, notFoundHandler } from './core/http/error-handler';
import {
  memoryRateLimitStore,
  rateLimit,
  redisRateLimitStore,
  type RateLimitStore,
} from './core/http/rate-limit';
import { apiClientUsage } from './core/integrations';
import { requestContext } from './core/http/request-context';
import { REQUEST_ID_HEADER, requestId } from './core/http/request-id';
import { requireFeature } from './core/features';
import { logger } from './core/logger';
import { LOCAL_STORAGE_ROUTE, localStorageRouter } from './core/storage';
import {
  createTenantResolver,
  prismaOrganizationLookup,
  rejectClientTenantIdentifiers,
  tenantContext,
  type OrganizationLookup,
  type TenantResolver,
} from './core/tenancy';
import { auditLogsRouter } from './modules/audit-logs/audit-logs.routes';
import { authRouter } from './modules/auth/auth.routes';
import { brandingRouter } from './modules/branding/branding.routes';
import { campusesRouter } from './modules/campuses/campuses.routes';
import {
  communicationCallbackRouter,
  communicationRouter,
} from './modules/communication/communication.routes';
import { classSectionsRouter } from './modules/class-sections/class-sections.routes';
import { documentsRouter } from './modules/documents/documents.routes';
import { attendanceRouter } from './modules/attendance/attendance.routes';
import {
  designationsRouter,
  employeesRouter,
  employeeTypesRouter,
} from './modules/employees/employees.routes';
import { holidaysRouter } from './modules/holidays/holidays.routes';
import { leaveRouter } from './modules/leave/leave.routes';
import { payrollRouter } from './modules/payroll/payroll.routes';
import { feesRouter, feesWebhookRouter } from './modules/fees/fees.routes';
import { financeRouter } from './modules/finance/finance.routes';
import { shiftsRouter } from './modules/shifts/shifts.routes';
import {
  allocationsRouter,
  studentAttendanceRouter,
  subjectsRouter,
} from './modules/academics/academics.routes';
import { examsRouter } from './modules/exams/exams.routes';
import { timetableRouter } from './modules/timetable/timetable.routes';
import { admissionsRouter, studentsRouter } from './modules/students/students.routes';
import { aiRouter } from './modules/ai/ai.routes';
import { assetsRouter } from './modules/assets/assets.routes';
import { libraryRouter } from './modules/library/library.routes';
import { transportRouter } from './modules/transport/transport.routes';
import { hostelRouter } from './modules/hostel/hostel.routes';
import { departmentsRouter } from './modules/departments/departments.routes';
import { featuresRouter } from './modules/features/features.routes';
import { groupsRouter } from './modules/groups/groups.routes';
import { healthRouter, type ReadinessCheck } from './modules/health/health.routes';
import { integrationsRouter, oauthRouter } from './modules/integrations/integrations.routes';
import { institutionsRouter } from './modules/institutions/institutions.routes';
import { meRouter } from './modules/me/me.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { organizationRouter } from './modules/organization/organization.routes';
import { pdfRouter } from './modules/pdf/pdf.routes';
import { platformRouter } from './modules/platform/platform.routes';
import { programsRouter } from './modules/programs/programs.routes';
import { permissionsRouter, rolesRouter } from './modules/roles/roles.routes';
import { secretsRouter } from './modules/secrets/secrets.routes';
import { subscriptionRouter } from './modules/subscription/subscription.routes';
import { usersRouter } from './modules/users/users.routes';
import { workflowsRouter } from './modules/workflows/workflows.routes';

export interface AppDependencies {
  organizationLookup: OrganizationLookup;
  tenantResolver: TenantResolver;
  readinessCheck: ReadinessCheck;
  /** Store for auth endpoint rate limits (RATE_LIMIT_STORE=redis shares it across instances). */
  rateLimitStore: RateLimitStore;
  authRateLimit: { windowMs: number; max: number };
}

export function defaultDependencies(): AppDependencies {
  return {
    organizationLookup: prismaOrganizationLookup,
    tenantResolver: createTenantResolver(env.TENANT_RESOLVER, prismaOrganizationLookup),
    readinessCheck: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    rateLimitStore:
      env.RATE_LIMIT_STORE === 'redis' ? redisRateLimitStore('rl:auth:') : memoryRateLimitStore(),
    authRateLimit: {
      windowMs: env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
      max: env.AUTH_RATE_LIMIT_MAX,
    },
  };
}

export function createApp(overrides: Partial<AppDependencies> = {}): Express {
  const deps = { ...defaultDependencies(), ...overrides };
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.headers[REQUEST_ID_HEADER] as string,
      customProps: (_req, res) => ({
        organizationId: (res as express.Response).locals?.organizationId,
      }),
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  // Keep the raw body for signature verification (provider delivery callbacks).
  const keepRaw = (req: express.Request, _res: express.Response, buf: Buffer) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  };
  app.use(express.json({ limit: '1mb', verify: keepRaw }));
  app.use(express.urlencoded({ extended: false, limit: '1mb', verify: keepRaw }));
  app.use(requestContext);

  app.use('/health', healthRouter(deps.readinessCheck));

  const api = Router();
  api.use(rejectClientTenantIdentifiers);

  // Identity endpoints (no tenant context required).
  const limit = (name: string) =>
    rateLimit({ ...deps.authRateLimit, store: deps.rateLimitStore, name: `auth:${name}` });
  api.use('/auth', authRouter({ limit }));
  api.use('/me', authenticate(), principalContext(), meRouter);
  api.use('/platform', authenticate(), principalContext(), platformRouter);
  // Local/memory storage drivers (dev/test): the HMAC-signed token in the URL is the credential.
  api.use(LOCAL_STORAGE_ROUTE.replace('/api/v1', ''), localStorageRouter());
  // Public machine endpoints: the signature / client secret is the credential.
  api.use('/communication/webhooks', communicationCallbackRouter);
  api.use('/fees/webhooks', feesWebhookRouter);
  api.use('/oauth', limit('oauth'), oauthRouter);

  // Everything below is tenant-scoped: the tenant comes from the authenticated session (JWT).
  // The dev-header resolver (dev/test only, refused in production) may substitute a header.
  const devHeader = deps.tenantResolver.name === 'dev-header';
  // API clients (client-credentials tokens) are accepted here, with per-client rate limits.
  api.use(authenticate({ optional: devHeader, allowApiClient: true }));
  api.use(apiClientUsage());
  api.use(tenantContext(deps.tenantResolver, deps.organizationLookup));
  api.use(principalContext({ allowDevPrincipal: devHeader }));
  api.use('/organization', organizationRouter);
  api.use('/groups', groupsRouter);
  api.use('/institutions', institutionsRouter);
  api.use('/campuses', campusesRouter);
  api.use('/departments', departmentsRouter);
  // Module-gated routes: 403 FEATURE_DISABLED when the module is not licensed / enabled.
  api.use('/programs', requireFeature('education'), programsRouter);
  api.use('/class-sections', requireFeature('education'), classSectionsRouter);
  api.use('/students', requireFeature('education'), studentsRouter);
  api.use('/admissions', requireFeature('education'), admissionsRouter);
  api.use('/library', requireFeature('library'), libraryRouter);
  api.use('/subjects', requireFeature('education'), subjectsRouter);
  api.use('/subject-allocations', requireFeature('education'), allocationsRouter);
  api.use('/student-attendance', requireFeature('education'), studentAttendanceRouter);
  api.use('/timetable', requireFeature('education'), timetableRouter);
  api.use('/exams', requireFeature('education'), examsRouter);
  api.use('/transport', requireFeature('transport'), transportRouter);
  api.use('/hostel', requireFeature('hostel'), hostelRouter);
  api.use('/employees', requireFeature('hr'), employeesRouter);
  api.use('/designations', requireFeature('hr'), designationsRouter);
  api.use('/employee-types', requireFeature('hr'), employeeTypesRouter);
  api.use('/holidays', requireFeature('hr'), holidaysRouter);
  api.use('/shifts', requireFeature('hr'), shiftsRouter);
  api.use('/attendance', requireFeature('hr'), attendanceRouter);
  api.use('/leave', requireFeature('hr'), leaveRouter);
  api.use('/payroll', requireFeature('payroll'), payrollRouter);
  api.use('/fees', requireFeature('finance'), feesRouter);
  api.use('/finance', requireFeature('finance'), financeRouter);
  api.use('/assets', requireFeature('assets'), assetsRouter);
  api.use('/users', usersRouter);
  api.use('/roles', rolesRouter);
  api.use('/permissions', permissionsRouter);
  api.use('/audit-logs', auditLogsRouter);
  api.use('/subscription', subscriptionRouter);
  api.use('/features', featuresRouter);
  api.use('/branding', brandingRouter);
  api.use('/secrets', secretsRouter);
  api.use('/documents', requireFeature('documents'), documentsRouter);
  api.use('/pdf', requireFeature('documents'), pdfRouter);
  api.use('/workflows', workflowsRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/communication', requireFeature('communication'), communicationRouter);
  api.use('/integrations', integrationsRouter);
  api.use('/ai', requireFeature('ai'), aiRouter);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

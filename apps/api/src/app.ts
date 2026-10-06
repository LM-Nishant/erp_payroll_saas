import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './core/config/env';
import { authenticate } from './core/auth';
import { principalContext } from './core/authz';
import { prisma } from './core/db/prisma';
import { errorHandler, notFoundHandler } from './core/http/error-handler';
import { memoryRateLimitStore, rateLimit, type RateLimitStore } from './core/http/rate-limit';
import { requestContext } from './core/http/request-context';
import { REQUEST_ID_HEADER, requestId } from './core/http/request-id';
import { logger } from './core/logger';
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
import { campusesRouter } from './modules/campuses/campuses.routes';
import { classSectionsRouter } from './modules/class-sections/class-sections.routes';
import { departmentsRouter } from './modules/departments/departments.routes';
import { groupsRouter } from './modules/groups/groups.routes';
import { healthRouter, type ReadinessCheck } from './modules/health/health.routes';
import { institutionsRouter } from './modules/institutions/institutions.routes';
import { meRouter } from './modules/me/me.routes';
import { organizationRouter } from './modules/organization/organization.routes';
import { platformRouter } from './modules/platform/platform.routes';
import { programsRouter } from './modules/programs/programs.routes';
import { permissionsRouter, rolesRouter } from './modules/roles/roles.routes';
import { usersRouter } from './modules/users/users.routes';

export interface AppDependencies {
  organizationLookup: OrganizationLookup;
  tenantResolver: TenantResolver;
  readinessCheck: ReadinessCheck;
  /** Store for auth endpoint rate limits (swap for Redis when running several instances). */
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
    rateLimitStore: memoryRateLimitStore(),
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
  app.use(express.json({ limit: '1mb' }));
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

  // Everything below is tenant-scoped: the tenant comes from the authenticated session (JWT).
  // The dev-header resolver (dev/test only, refused in production) may substitute a header.
  const devHeader = deps.tenantResolver.name === 'dev-header';
  api.use(authenticate({ optional: devHeader }));
  api.use(tenantContext(deps.tenantResolver, deps.organizationLookup));
  api.use(principalContext({ allowDevPrincipal: devHeader }));
  api.use('/organization', organizationRouter);
  api.use('/groups', groupsRouter);
  api.use('/institutions', institutionsRouter);
  api.use('/campuses', campusesRouter);
  api.use('/departments', departmentsRouter);
  api.use('/programs', programsRouter);
  api.use('/class-sections', classSectionsRouter);
  api.use('/users', usersRouter);
  api.use('/roles', rolesRouter);
  api.use('/permissions', permissionsRouter);
  api.use('/audit-logs', auditLogsRouter);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

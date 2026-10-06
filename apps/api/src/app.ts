import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './core/config/env';
import { prisma } from './core/db/prisma';
import { errorHandler, notFoundHandler } from './core/http/error-handler';
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
import { campusesRouter } from './modules/campuses/campuses.routes';
import { classSectionsRouter } from './modules/class-sections/class-sections.routes';
import { departmentsRouter } from './modules/departments/departments.routes';
import { groupsRouter } from './modules/groups/groups.routes';
import { healthRouter, type ReadinessCheck } from './modules/health/health.routes';
import { institutionsRouter } from './modules/institutions/institutions.routes';
import { organizationRouter } from './modules/organization/organization.routes';
import { programsRouter } from './modules/programs/programs.routes';

export interface AppDependencies {
  organizationLookup: OrganizationLookup;
  tenantResolver: TenantResolver;
  readinessCheck: ReadinessCheck;
}

export function defaultDependencies(): AppDependencies {
  return {
    organizationLookup: prismaOrganizationLookup,
    tenantResolver: createTenantResolver(env.TENANT_RESOLVER, prismaOrganizationLookup),
    readinessCheck: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
  };
}

export function createApp(overrides: Partial<AppDependencies> = {}): Express {
  const deps = { ...defaultDependencies(), ...overrides };
  const app = express();

  app.disable('x-powered-by');
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

  app.use('/health', healthRouter(deps.readinessCheck));

  // Everything under /api/v1 is tenant-scoped.
  const api = Router();
  api.use(rejectClientTenantIdentifiers);
  api.use(tenantContext(deps.tenantResolver, deps.organizationLookup));
  api.use('/organization', organizationRouter);
  api.use('/groups', groupsRouter);
  api.use('/institutions', institutionsRouter);
  api.use('/campuses', campusesRouter);
  api.use('/departments', departmentsRouter);
  api.use('/programs', programsRouter);
  api.use('/class-sections', classSectionsRouter);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

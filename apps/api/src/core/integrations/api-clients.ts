import { timingSafeEqual } from 'node:crypto';
import {
  isApiClientScopeAllowed,
  type ApiClientCreatedDto,
  type ApiClientDto,
  type ApiUsageDto,
  type ClientCredentialsTokenInput,
  type CreateApiClientInput,
  type PaginationQuery,
  type UpdateApiClientInput,
} from '@erp/shared';
import type { ApiClient, Prisma } from '@prisma/client';
import type { RequestHandler } from 'express';
import { audit } from '../audit';
import type { ApiClientAuth } from '../auth/api-client-auth';
import { signClientToken } from '../auth/tokens';
import { accessFor, authorize, can, currentPrincipal } from '../authz';
import { env } from '../config/env';
import { randomToken, sha256 } from '../crypto';
import { prisma } from '../db/prisma';
import { AppError, NotFoundError, UnauthenticatedError, ValidationError } from '../http/errors';
import { toListResponse, toPageWindow } from '../http/pagination';
import { defaultRateLimitStore, RateLimitedError } from '../http/rate-limit';
import { logger } from '../logger';
import {
  resolveSettingTarget,
  targetResource,
  whereForTargetAccess,
  type SettingTarget,
} from '../settings/target';
import { runAsSystem } from '../queue/runner';
import { tenantDb, withTenant } from '../tenancy/tenant-db';

type ClientWithScopes = ApiClient & { scopes: Array<{ scope: string }> };

function dto(row: ClientWithScopes): ApiClientDto {
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    description: row.description,
    scopes: row.scopes.map((s) => s.scope).sort(),
    scopeType: row.scopeType,
    targetId: row.targetId,
    rateLimitPerMinute: row.rateLimitPerMinute,
    status: row.status as ApiClientDto['status'],
    secretLast4: row.secretLast4,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    lastUsedIp: row.lastUsedIp,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const clientTarget = (row: ApiClient): SettingTarget => ({
  scopeType: row.scopeType,
  targetId: row.targetId,
  groupId: row.groupId,
  institutionId: row.institutionId,
});

const newSecret = () => `erpsec_${randomToken(32)}`;

/**
 * Scopes must be API-allowed catalog codes AND held by the creator over the client's target —
 * nobody can mint a machine credential more powerful than themselves.
 */
async function validateScopes(scopes: string[], target: SettingTarget) {
  const principal = currentPrincipal();
  const unique = [...new Set(scopes)];
  const forbidden = unique.filter((s) => !isApiClientScopeAllowed(s));
  if (forbidden.length) {
    throw new ValidationError(`Scopes not allowed for API clients: ${forbidden.join(', ')}`, {
      field: 'scopes',
    });
  }
  const resource = targetResource(target);
  const notHeld: string[] = [];
  for (const s of unique) if (!(await can(principal, s, resource))) notHeld.push(s);
  if (notHeld.length) {
    throw new AppError(403, 'SCOPE_DENIED', `You do not hold: ${notHeld.join(', ')}`, {
      field: 'scopes',
    });
  }
  return unique;
}

async function findClient(id: string, permission: 'integration.view' | 'integration.manage') {
  const row = await tenantDb().apiClient.findFirst({ where: { id }, include: { scopes: true } });
  if (!row) throw new NotFoundError('API client');
  try {
    await authorize(currentPrincipal(), permission, targetResource(clientTarget(row)));
  } catch (err) {
    if (permission === 'integration.view') throw new NotFoundError('API client');
    throw err;
  }
  return row;
}

export const apiClientsService = {
  async list(query: PaginationQuery) {
    const access = await accessFor(currentPrincipal(), 'integration.view');
    const scope = whereForTargetAccess(access);
    const where: Prisma.ApiClientWhereInput = {
      ...(query.search ? { name: { contains: query.search } } : {}),
      ...(scope ? { AND: [scope] } : {}),
    };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.apiClient.findMany({
        where,
        include: { scopes: true },
        orderBy: { createdAt: 'desc' },
        ...toPageWindow(query),
      }),
      db.apiClient.count({ where }),
    ]);
    return toListResponse(rows.map(dto), total, query);
  },

  async get(id: string) {
    return dto(await findClient(id, 'integration.view'));
  },

  async create(input: CreateApiClientInput): Promise<ApiClientCreatedDto> {
    const target = await resolveSettingTarget(input.scopeType, input.targetId);
    await authorize(currentPrincipal(), 'integration.manage', targetResource(target));
    const scopes = await validateScopes(input.scopes, target);
    const secret = newSecret();
    const db = tenantDb();
    const row = await db.apiClient.create({
      data: withTenant({
        clientId: `erp_${randomToken(12)}`,
        name: input.name,
        description: input.description ?? null,
        secretHash: sha256(secret),
        secretLast4: secret.slice(-4),
        scopeType: target.scopeType,
        targetId: target.targetId,
        groupId: target.groupId,
        institutionId: target.institutionId,
        rateLimitPerMinute: input.rateLimitPerMinute,
        expiresAt: input.expiresAt ?? null,
        createdById: currentPrincipal().userId,
      }),
    });
    await db.apiScope.createMany({
      data: scopes.map((scope) => withTenant({ apiClientId: row.id, scope })),
    });
    const full = await db.apiClient.findFirstOrThrow({
      where: { id: row.id },
      include: { scopes: true },
    });
    await audit.record({
      action: 'api_client.create',
      entityType: 'api_client',
      entityId: row.id,
      after: { ...dto(full) },
    });
    return { ...dto(full), clientSecret: secret };
  },

  async update(id: string, input: UpdateApiClientInput) {
    const before = await findClient(id, 'integration.manage');
    const db = tenantDb();
    if (input.scopes) {
      const scopes = await validateScopes(input.scopes, clientTarget(before));
      await db.apiScope.deleteMany({ where: { apiClientId: id } });
      await db.apiScope.createMany({
        data: scopes.map((scope) => withTenant({ apiClientId: id, scope })),
      });
    }
    await db.apiClient.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.rateLimitPerMinute !== undefined
          ? { rateLimitPerMinute: input.rateLimitPerMinute }
          : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      },
    });
    const row = await db.apiClient.findFirstOrThrow({ where: { id }, include: { scopes: true } });
    await audit.record({
      action: 'api_client.update',
      entityType: 'api_client',
      entityId: id,
      before: dto(before),
      after: dto(row),
    });
    return dto(row);
  },

  async rotateSecret(id: string): Promise<ApiClientCreatedDto> {
    const before = await findClient(id, 'integration.manage');
    if (before.status !== 'ACTIVE') throw new AppError(409, 'INVALID_STATE', 'Client is revoked');
    const secret = newSecret();
    const db = tenantDb();
    await db.apiClient.update({
      where: { id },
      data: { secretHash: sha256(secret), secretLast4: secret.slice(-4) },
    });
    const row = await db.apiClient.findFirstOrThrow({ where: { id }, include: { scopes: true } });
    await audit.record({
      action: 'api_client.rotate_secret',
      entityType: 'api_client',
      entityId: id,
    });
    return { ...dto(row), clientSecret: secret };
  },

  /** Revocation is immediate: every request re-checks the client status. */
  async revoke(id: string) {
    const before = await findClient(id, 'integration.manage');
    const db = tenantDb();
    await db.apiClient.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: before.revokedAt ?? new Date() },
    });
    const row = await db.apiClient.findFirstOrThrow({ where: { id }, include: { scopes: true } });
    await audit.record({
      action: 'api_client.revoke',
      entityType: 'api_client',
      entityId: id,
      before: { status: before.status },
      after: { status: 'REVOKED' },
    });
    return dto(row);
  },

  async usage(id: string, query: PaginationQuery) {
    await findClient(id, 'integration.view');
    const db = tenantDb();
    const where = { apiClientId: id };
    const [rows, total] = await Promise.all([
      db.apiUsage.findMany({ where, orderBy: { createdAt: 'desc' }, ...toPageWindow(query) }),
      db.apiUsage.count({ where }),
    ]);
    return toListResponse(
      rows.map((r): ApiUsageDto => ({
        id: r.id,
        method: r.method,
        path: r.path,
        statusCode: r.statusCode,
        durationMs: r.durationMs,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      query,
    );
  },
};

/* ----------------------------------------------------------- token endpoint ---- */

function parseBasic(header: string | undefined): { id: string; secret: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return null;
  return {
    id: decodeURIComponent(decoded.slice(0, i)),
    secret: decodeURIComponent(decoded.slice(i + 1)),
  };
}

const invalidClient = () =>
  new UnauthenticatedError('Invalid client credentials', 'INVALID_CLIENT');

/** OAuth2 client-credentials grant. Platform-level lookup by client id (it identifies the tenant). */
export async function issueClientToken(input: ClientCredentialsTokenInput, authorization?: string) {
  const basic = parseBasic(authorization);
  const clientId = basic?.id ?? input.client_id;
  const secret = basic?.secret ?? input.client_secret;
  if (!clientId || !secret) throw invalidClient();
  const client = await prisma.apiClient.findUnique({
    where: { clientId },
    include: { scopes: true, organization: { select: { status: true, deletedAt: true } } },
  });
  const given = Buffer.from(sha256(secret));
  const ok =
    !!client &&
    given.length === Buffer.from(client.secretHash).length &&
    timingSafeEqual(given, Buffer.from(client.secretHash));
  if (
    !client ||
    !ok ||
    client.status !== 'ACTIVE' ||
    (client.expiresAt && client.expiresAt <= new Date()) ||
    client.organization.status !== 'ACTIVE' ||
    client.organization.deletedAt
  ) {
    throw invalidClient();
  }
  const granted = client.scopes.map((s) => s.scope).filter(isApiClientScopeAllowed);
  let scopes = granted;
  if (input.scope) {
    const requested = [...new Set(input.scope.split(/\s+/).filter(Boolean))];
    const invalid = requested.filter((s) => !granted.includes(s));
    if (invalid.length) {
      throw new AppError(
        400,
        'INVALID_SCOPE',
        `Scopes not granted to this client: ${invalid.join(', ')}`,
      );
    }
    scopes = requested;
  }
  const ttl = env.API_CLIENT_TOKEN_TTL_SECONDS;
  const { token } = await signClientToken(
    { sub: client.id, org: client.organizationId, scope: scopes },
    ttl,
  );
  await runAsSystem(client.organizationId, () =>
    audit.record({
      action: 'api_client.token_issued',
      entityType: 'api_client',
      entityId: client.id,
      metadata: { scopes },
    }),
  );
  return { access_token: token, token_type: 'Bearer', expires_in: ttl, scope: scopes.join(' ') };
}

/* ------------------------------------------------- per-request usage + limits ---- */

/**
 * For API-client requests: per-client rate limit (RateLimit-* headers, 429), usage logging on
 * response finish and `lastUsedAt` / `lastUsedIp` tracking. No-op for user sessions.
 */
export function apiClientUsage(): RequestHandler {
  return async (req, res, next) => {
    const client: ApiClientAuth | undefined = req.apiClient;
    if (!client) return next();
    const store = defaultRateLimitStore();
    const { count, resetAt } = await store.hit(`api-client:${client.apiClientId}`, 60_000);
    res.setHeader('RateLimit-Limit', String(client.rateLimitPerMinute));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, client.rateLimitPerMinute - count)));
    const started = Date.now();
    const path = (req.originalUrl.split('?')[0] ?? '').slice(0, 500);
    res.on('finish', () => {
      const organizationId = client.organizationId;
      void (async () => {
        try {
          await prisma.apiUsage.create({
            data: {
              organizationId,
              apiClientId: client.apiClientId,
              method: req.method.slice(0, 8),
              path,
              statusCode: res.statusCode,
              durationMs: Date.now() - started,
              ip: req.ip?.slice(0, 64) ?? null,
            },
          });
          await prisma.apiClient.updateMany({
            where: { id: client.apiClientId, organizationId },
            data: { lastUsedAt: new Date(), lastUsedIp: req.ip?.slice(0, 64) ?? null },
          });
        } catch (err) {
          logger.warn({ err: (err as Error).message }, 'API usage logging failed');
        }
      })();
    });
    if (count > client.rateLimitPerMinute) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      throw new RateLimitedError(retryAfter);
    }
    next();
  };
}

import type {
  AiFeature,
  AiProviderKey,
  AiUsageDashboardDto,
  AiUsageLogDto,
  AiUsageQuery,
  ListAiUsageLogsQuery,
} from '@erp/shared';
import type { AiUsageLog, Prisma } from '@prisma/client';
import { assertPermission, currentPrincipal } from '../authz';
import { prisma } from '../db/prisma';
import { getLimitUsage } from '../features';
import { toListResponse, toPageWindow } from '../http/pagination';
import { tenantDb } from '../tenancy';

const DAY_MS = 86_400_000;

async function userNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

function toUsageLogDto(row: AiUsageLog, names: Map<string, string>): AiUsageLogDto {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.userId ? (names.get(row.userId) ?? null) : null,
    feature: row.feature as AiFeature,
    provider: row.provider as AiProviderKey,
    model: row.model,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    latencyMs: row.latencyMs,
    status: row.status as AiUsageLogDto['status'],
    errorCode: row.errorCode,
    promptPreview: row.promptRedacted,
    createdAt: row.createdAt.toISOString(),
  };
}

function dayStart(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Usage dashboard (needs `ai.view_usage` at any scope): tokens by feature / user / day + limit. */
export async function aiUsageDashboard(query: AiUsageQuery): Promise<AiUsageDashboardDto> {
  assertPermission(currentPrincipal(), 'ai.view_usage');
  const to = query.to ? dayStart(query.to) : dayStart(new Date().toISOString().slice(0, 10));
  const from = query.from ? dayStart(query.from) : new Date(to.getTime() - 29 * DAY_MS);
  const where: Prisma.AiUsageLogWhereInput = {
    createdAt: { gte: from, lt: new Date(to.getTime() + DAY_MS) },
    ...(query.feature ? { feature: query.feature } : {}),
  };
  const db = tenantDb();
  const [rows, tokens] = await Promise.all([
    db.aiUsageLog.findMany({
      where,
      select: {
        userId: true,
        feature: true,
        totalTokens: true,
        latencyMs: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 50_000,
    }),
    getLimitUsage('ai_tokens'),
  ]);

  const byFeature = new Map<string, { requests: number; totalTokens: number }>();
  const byUser = new Map<string | null, { requests: number; totalTokens: number }>();
  const byDay = new Map<string, { requests: number; totalTokens: number }>();
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    byDay.set(new Date(t).toISOString().slice(0, 10), { requests: 0, totalTokens: 0 });
  }
  let totalTokens = 0;
  let errors = 0;
  let latency = 0;
  const bump = <K>(map: Map<K, { requests: number; totalTokens: number }>, key: K, n: number) => {
    const cur = map.get(key) ?? { requests: 0, totalTokens: 0 };
    cur.requests += 1;
    cur.totalTokens += n;
    map.set(key, cur);
  };
  for (const r of rows) {
    totalTokens += r.totalTokens;
    latency += r.latencyMs;
    if (r.status !== 'OK') errors += 1;
    bump(byFeature, r.feature, r.totalTokens);
    bump(byUser, r.userId, r.totalTokens);
    bump(byDay, r.createdAt.toISOString().slice(0, 10), r.totalTokens);
  }
  const names = await userNames([...byUser.keys()]);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    tokens: { limit: tokens.limit, used: tokens.used },
    totals: {
      requests: rows.length,
      totalTokens,
      errors,
      avgLatencyMs: rows.length ? Math.round(latency / rows.length) : 0,
    },
    byFeature: [...byFeature.entries()]
      .map(([feature, v]) => ({ feature: feature as AiFeature, ...v }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
    byUser: [...byUser.entries()]
      .map(([userId, v]) => ({
        userId,
        userName: userId ? (names.get(userId) ?? null) : null,
        ...v,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 50),
    byDay: [...byDay.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** Paginated usage log (redacted prompt previews only). Needs `ai.view_usage`. */
export async function listAiUsageLogs(query: ListAiUsageLogsQuery) {
  assertPermission(currentPrincipal(), 'ai.view_usage');
  const where: Prisma.AiUsageLogWhereInput = {
    ...(query.feature ? { feature: query.feature } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search ? { promptRedacted: { contains: query.search } } : {}),
  };
  const db = tenantDb();
  const [rows, total] = await Promise.all([
    db.aiUsageLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...toPageWindow(query) }),
    db.aiUsageLog.count({ where }),
  ]);
  const names = await userNames(rows.map((r) => r.userId));
  return toListResponse(
    rows.map((r) => toUsageLogDto(r, names)),
    total,
    query,
  );
}

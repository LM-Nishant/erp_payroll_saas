import type {
  AiChatInput,
  AiChatResponseDto,
  AiConversationDetailDto,
  AiConversationDto,
  AiDraftDto,
  AiDraftInput,
  AiFeature,
  AiMessageDto,
  AiPayrollExplainInput,
  AiPayrollExplanationDto,
  AiPayrollOutlierDto,
  AiStatusDto,
  AiStudentInsightDto,
  AiStudentInsightInput,
  AiSummarizeInput,
  AiSummaryDto,
  AiToolCallDto,
  ListAiConversationsQuery,
  PayrollRunDto,
  PayrollRunEmployeeDto,
} from '@erp/shared';
import type { AiConversation, AiMessage, Prisma } from '@prisma/client';
import {
  aiSecretConfigured,
  assertAiFeatureEnabled,
  availableAiTools,
  loadAiSettings,
  runAi,
  runAiPrompt,
  type AiChatMessage,
} from '../../core/ai';
import { andScope, currentPrincipal, hasPermission, scopeWhere } from '../../core/authz';
import { currentFeatureContext, enabledFeaturesAnywhere, getLimitUsage } from '../../core/features';
import { ForbiddenError, NotFoundError } from '../../core/http/errors';
import { toListResponse, toPageWindow } from '../../core/http/pagination';
import { currentOrganizationId, tenantDb, withTenant } from '../../core/tenancy';
import { runService } from '../payroll/payroll.runs';
import {
  ASSISTANT_SYSTEM,
  PROMPT_ASSISTANT,
  PROMPT_DRAFT,
  PROMPT_PAYROLL_ANOMALY,
  PROMPT_STUDENT_INSIGHT,
  PROMPT_SUMMARIZE,
} from './ai.prompts';
import { collectStudentInsightSignals } from './ai.insights';
import { findPayrollOutliers, percentChange, type RunTotals } from './ai.logic';

const HISTORY_MESSAGES = 10;

function requireUserId(): string {
  const userId = currentPrincipal().userId;
  if (!userId) throw new ForbiddenError('AI conversations require a signed-in user');
  return userId;
}

function toConversationDto(row: AiConversation): AiConversationDto {
  return {
    id: row.id,
    feature: row.feature as AiFeature,
    title: row.title,
    messageCount: row.messageCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toolCallsOf(value: Prisma.JsonValue | null): AiToolCallDto[] {
  return Array.isArray(value) ? (value as unknown as AiToolCallDto[]) : [];
}

function toMessageDto(row: AiMessage): AiMessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    toolCalls: toolCallsOf(row.toolCalls),
    totalTokens: row.totalTokens,
    createdAt: row.createdAt.toISOString(),
  };
}

async function ownConversation(id: string): Promise<AiConversation> {
  const userId = requireUserId();
  const row = await tenantDb().aiConversation.findFirst({ where: { id, userId } });
  if (!row) throw new NotFoundError('Conversation');
  return row;
}

function titleFrom(message: string): string {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}…` : oneLine;
}

function parseDraft(content: string): { subject: string; body: string } {
  const match = /^\s*subject\s*:\s*(.+)$/im.exec(content.split('\n').slice(0, 3).join('\n'));
  if (!match) return { subject: '', body: content.trim() };
  const subject = match[1]!.trim().slice(0, 300);
  const rest = content.slice(content.indexOf(match[0]) + match[0].length);
  return { subject, body: rest.replace(/^\s*\n/, '').trim() };
}

function parseSummary(content: string): { summary: string; highlights: string[] } {
  const [head, tail = ''] = content.split(/\n\s*highlights\s*:\s*\n?/i);
  const highlights = tail
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 8);
  return { summary: (head ?? '').trim(), highlights };
}

async function allRunEmployees(runId: string): Promise<PayrollRunEmployeeDto[]> {
  const out: PayrollRunEmployeeDto[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await runService.employees(runId, { page, pageSize: 100 });
    out.push(...res.data);
    if (out.length >= res.meta.total || res.data.length === 0) break;
  }
  return out;
}

async function previousMonthRun(run: PayrollRunDto): Promise<PayrollRunDto | null> {
  const res = await runService.list({ page: 1, pageSize: 50, institutionId: run.institutionId });
  return (
    res.data.find(
      (r) =>
        r.periodStart < run.periodStart && !['DRAFT', 'COMPUTING', 'CANCELLED'].includes(r.status),
    ) ?? null
  );
}

const totalsOf = (r: PayrollRunDto): RunTotals => ({
  gross: r.grossTotal,
  deductions: r.deductionTotal,
  net: r.netTotal,
  employees: r.employeeCount,
});

export const aiService = {
  async status(): Promise<AiStatusDto> {
    const principal = currentPrincipal();
    const [settings, secretConfigured, tokens] = await Promise.all([
      loadAiSettings(),
      aiSecretConfigured(),
      getLimitUsage('ai_tokens'),
    ]);
    return {
      enabled: settings.enabled,
      effectiveProvider: settings.provider === 'openai' && secretConfigured ? 'openai' : 'mock',
      model: settings.defaultModel,
      enabledFeatures: settings.enabled ? settings.enabledFeatures : [],
      secretConfigured,
      tokens: { limit: tokens.limit, used: tokens.used },
      canManage: hasPermission(principal, 'ai.manage'),
      canViewUsage: hasPermission(principal, 'ai.view_usage'),
    };
  },

  /* ------------------------------------------------------------ assistant chat */

  async chat(input: AiChatInput): Promise<AiChatResponseDto> {
    const principal = currentPrincipal();
    const userId = requireUserId();
    await assertAiFeatureEnabled('assistant');
    const db = tenantDb();

    let conversation = input.conversationId ? await ownConversation(input.conversationId) : null;
    const history: AiChatMessage[] = [];
    if (conversation) {
      const recent = await db.aiMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_MESSAGES,
      });
      for (const m of recent.reverse()) {
        history.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
      }
    } else {
      conversation = await db.aiConversation.create({
        data: withTenant({ userId, feature: 'assistant', title: titleFrom(input.message) }),
      });
    }

    const features = await enabledFeaturesAnywhere(currentFeatureContext());
    const tools = availableAiTools(principal, features);
    const result = await runAi({
      feature: 'assistant',
      messages: [
        { role: 'system', content: ASSISTANT_SYSTEM },
        ...history,
        { role: 'user', content: input.message },
      ],
      tools,
      prompt: { key: PROMPT_ASSISTANT, input: { message: input.message } },
      conversationId: conversation.id,
    });

    const toolCalls: AiToolCallDto[] = result.toolExecutions.map((t) => ({
      name: t.name,
      arguments: t.arguments,
      ok: t.ok,
      summary: t.summary,
    }));
    const conversationId = conversation.id;
    const [userMsg, assistantMsg, updated] = await db.$transaction(async (tx) => {
      const u = await tx.aiMessage.create({
        data: withTenant({
          conversationId,
          role: 'user',
          content: input.message,
          totalTokens: result.usage.promptTokens,
        }),
      });
      // Distinct timestamps keep ordering stable even within the same millisecond.
      const a = await tx.aiMessage.create({
        data: withTenant({
          conversationId,
          role: 'assistant',
          content: result.content,
          toolCalls: toolCalls as unknown as Prisma.InputJsonValue,
          totalTokens: result.usage.completionTokens,
          createdAt: new Date(u.createdAt.getTime() + 1),
        }),
      });
      const c = await tx.aiConversation.update({
        where: { id: conversationId },
        data: { messageCount: { increment: 2 } },
      });
      return [u, a, c] as const;
    });
    return {
      conversation: toConversationDto(updated),
      messages: [toMessageDto(userMsg), toMessageDto(assistantMsg)],
      usage: result.usage,
    };
  },

  async listConversations(query: ListAiConversationsQuery) {
    const userId = requireUserId();
    const where: Prisma.AiConversationWhereInput = {
      userId,
      ...(query.feature ? { feature: query.feature } : {}),
      ...(query.search ? { title: { contains: query.search } } : {}),
    };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.aiConversation.findMany({ where, orderBy: { updatedAt: 'desc' }, ...toPageWindow(query) }),
      db.aiConversation.count({ where }),
    ]);
    return toListResponse(rows.map(toConversationDto), total, query);
  },

  async getConversation(id: string): Promise<AiConversationDetailDto> {
    const row = await ownConversation(id);
    const messages = await tenantDb().aiMessage.findMany({
      where: { conversationId: row.id },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return { ...toConversationDto(row), messages: messages.map(toMessageDto) };
  },

  /** Owner-only delete: messages are erased, the conversation row is soft-deleted. */
  async deleteConversation(id: string): Promise<void> {
    const row = await ownConversation(id);
    await tenantDb().$transaction(async (tx) => {
      await tx.aiMessage.deleteMany({ where: { conversationId: row.id } });
      await tx.aiConversation.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    });
  },

  /* ------------------------------------------------------------ drafting */

  async draft(input: AiDraftInput): Promise<AiDraftDto> {
    const org = await tenantDb().organization.findFirst({
      where: { id: currentOrganizationId() },
      select: { name: true },
    });
    const result = await runAiPrompt(PROMPT_DRAFT, {
      kind: input.kind,
      instructions: input.instructions,
      tone: input.tone,
      variables: input.variables ?? {},
      organizationName: org?.name ?? 'the institution',
    });
    const { subject, body } = parseDraft(result.content);
    return { kind: input.kind, subject, body, usage: result.usage };
  },

  /* ------------------------------------------------------------ payroll anomalies */

  async explainPayrollRun(input: AiPayrollExplainInput): Promise<AiPayrollExplanationDto> {
    await assertAiFeatureEnabled('payroll_anomaly');
    const run = await runService.get(input.runId); // payroll.view on the run's institution
    const previous = await previousMonthRun(run);
    const [current, prevRows] = await Promise.all([
      allRunEmployees(run.id),
      previous ? allRunEmployees(previous.id) : Promise.resolve([]),
    ]);
    const outliers: AiPayrollOutlierDto[] = findPayrollOutliers(
      current,
      previous ? prevRows : null,
    );
    const netChangePercent = previous ? percentChange(run.netTotal, previous.netTotal) : null;
    const totals = {
      current: totalsOf(run),
      previous: previous ? totalsOf(previous) : null,
      netChangePercent,
    };
    const result = await runAiPrompt(
      PROMPT_PAYROLL_ANOMALY,
      {
        runLabel: run.label,
        institution: run.institutionName,
        current: totals.current,
        previous: totals.previous,
        netChangePercent,
        outliers: outliers.slice(0, 25).map((o) => ({
          employee: `${o.employeeName} (${o.employeeCode})`,
          currentNet: o.currentNet,
          previousNet: o.previousNet,
          changePercent: o.changePercent,
          reasons: o.reasons,
        })),
      },
      { institutionId: run.institutionId },
    );
    return {
      runId: run.id,
      periodStart: run.periodStart,
      institutionName: run.institutionName,
      previousRunId: previous?.id ?? null,
      totals,
      outliers,
      narrative: result.content,
      usage: result.usage,
    };
  },

  /* ------------------------------------------------------------ student insight */

  async studentInsights(input: AiStudentInsightInput): Promise<AiStudentInsightDto> {
    await assertAiFeatureEnabled('student_insight');
    const principal = currentPrincipal();
    const scope = await scopeWhere(principal, 'student.view', 'student');
    const where = andScope<Prisma.StudentWhereInput>(
      {
        ...(input.institutionId ? { institutionId: input.institutionId } : {}),
        ...(input.classSectionId ? { classSectionId: input.classSectionId } : {}),
      },
      scope,
    );
    const facts = await collectStudentInsightSignals(where);
    const result = await runAiPrompt(
      PROMPT_STUDENT_INSIGHT,
      {
        scope: input.classSectionId
          ? 'the selected class'
          : input.institutionId
            ? 'the selected institution'
            : 'all accessible students',
        totals: { total: facts.totals.total, active: facts.totals.active },
        signals: facts.signals,
        atRiskCount: facts.atRisk.length,
        topReasons: facts.topReasons,
        dataSources: facts.dataSources,
      },
      { institutionId: input.institutionId ?? null },
    );
    return {
      totals: facts.totals,
      signals: facts.signals,
      atRisk: facts.atRisk.slice(0, 100),
      dataSources: facts.dataSources,
      narrative: result.content,
      usage: result.usage,
    };
  },

  /* ------------------------------------------------------------ summarizer */

  async summarize(input: AiSummarizeInput): Promise<AiSummaryDto> {
    const result = await runAiPrompt(PROMPT_SUMMARIZE, { kind: input.kind, text: input.text });
    return { kind: input.kind, ...parseSummary(result.content), usage: result.usage };
  },
};

export const __test = { parseDraft, parseSummary, titleFrom };

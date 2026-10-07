import type { AiDraftKind, AiFeature, AiProviderKey, AiSummaryKind } from '../schemas/ai';

export interface AiSettingsDto {
  enabled: boolean;
  provider: AiProviderKey;
  defaultModel: string;
  maxTokensPerRequest: number;
  temperature: number;
  enabledFeatures: AiFeature[];
  dataSharing: boolean;
  updatedAt: string | null;
}

/** What the caller's UI needs to decide what to show (never contains secret values). */
export interface AiStatusDto {
  enabled: boolean;
  /** Provider actually used (`mock` when no `ai.openai` secret / data sharing is off). */
  effectiveProvider: AiProviderKey;
  model: string;
  enabledFeatures: AiFeature[];
  /** An `ai.openai` secret is configured for the organization. */
  secretConfigured: boolean;
  tokens: { limit: number | null; used: number };
  canManage: boolean;
  canViewUsage: boolean;
}

export interface AiToolCallDto {
  name: string;
  arguments: Record<string, unknown>;
  /** Short status for the UI; the full tool payload is only shown to the model. */
  ok: boolean;
  summary: string;
}

export interface AiMessageDto {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: AiToolCallDto[];
  totalTokens: number;
  createdAt: string;
}

export interface AiConversationDto {
  id: string;
  feature: AiFeature;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiConversationDetailDto extends AiConversationDto {
  messages: AiMessageDto[];
}

export interface AiUsageSummaryDto {
  provider: AiProviderKey;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}

export interface AiChatResponseDto {
  conversation: AiConversationDto;
  messages: AiMessageDto[];
  usage: AiUsageSummaryDto;
}

export interface AiDraftDto {
  kind: AiDraftKind;
  subject: string;
  body: string;
  usage: AiUsageSummaryDto;
}

export interface AiPayrollOutlierDto {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  currentNet: number;
  previousNet: number | null;
  changePercent: number | null;
  lopDays: number;
  reasons: string[];
}

export interface AiPayrollExplanationDto {
  runId: string;
  periodStart: string;
  institutionName: string | null;
  previousRunId: string | null;
  totals: {
    current: { gross: number; deductions: number; net: number; employees: number };
    previous: { gross: number; deductions: number; net: number; employees: number } | null;
    netChangePercent: number | null;
  };
  outliers: AiPayrollOutlierDto[];
  narrative: string;
  usage: AiUsageSummaryDto;
}

export interface AiStudentInsightDto {
  totals: { total: number; active: number; byStatus: Record<string, number> };
  signals: { label: string; value: string }[];
  atRisk: { studentId: string; name: string; admissionNo: string; reasons: string[] }[];
  dataSources: string[];
  narrative: string;
  usage: AiUsageSummaryDto;
}

export interface AiSummaryDto {
  kind: AiSummaryKind;
  summary: string;
  highlights: string[];
  usage: AiUsageSummaryDto;
}

export interface AiUsageLogDto {
  id: string;
  userId: string | null;
  userName: string | null;
  feature: AiFeature;
  provider: AiProviderKey;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: 'OK' | 'ERROR' | 'LIMITED';
  errorCode: string | null;
  promptPreview: string | null;
  createdAt: string;
}

export interface AiUsageDashboardDto {
  from: string;
  to: string;
  tokens: { limit: number | null; used: number };
  totals: { requests: number; totalTokens: number; errors: number; avgLatencyMs: number };
  byFeature: { feature: AiFeature; requests: number; totalTokens: number }[];
  byUser: {
    userId: string | null;
    userName: string | null;
    requests: number;
    totalTokens: number;
  }[];
  byDay: { date: string; requests: number; totalTokens: number }[];
}

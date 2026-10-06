import type { SettingScopeType } from '../licensing/features';
import type { MessageChannel, MessageStatus, ProviderType } from '../schemas/communication';
import type { NotificationChannel } from '../schemas/notifications';
import type {
  WorkflowActionType,
  WorkflowDefinitionStatus,
  WorkflowInstanceStatus,
  WorkflowStepInput,
} from '../schemas/workflow';

/* --------------------------------- Workflow ---------------------------------------------- */

export interface WorkflowDefinitionDto {
  id: string;
  entityType: string;
  name: string;
  description: string | null;
  version: number;
  status: WorkflowDefinitionStatus;
  scopeType: SettingScopeType;
  targetId: string;
  allowSelfApproval: boolean;
  steps: WorkflowStepInput[];
  createdAt: string;
  updatedAt: string;
}

export type WorkflowStepStatus =
  'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED' | 'SENT_BACK' | 'CANCELLED';

export interface WorkflowAssigneeDto {
  userId: string;
  name: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DELEGATED' | 'SUPERSEDED';
  delegatedFromUserId: string | null;
  escalated: boolean;
  actedAt: string | null;
}

export interface WorkflowStepInstanceDto {
  id: string;
  stepKey: string;
  name: string;
  order: number;
  mode: 'any' | 'all';
  status: WorkflowStepStatus;
  dueAt: string | null;
  escalatedAt: string | null;
  activatedAt: string | null;
  completedAt: string | null;
  assignees: WorkflowAssigneeDto[];
}

export interface WorkflowActionDto {
  id: string;
  action: WorkflowActionType | 'submit' | 'resubmit' | 'cancel' | 'escalate' | 'skip';
  stepKey: string | null;
  actor: { id: string; name: string } | null;
  comment: string | null;
  delegateToUserId: string | null;
  createdAt: string;
}

export interface WorkflowInstanceDto {
  id: string;
  definitionId: string;
  definitionVersion: number;
  entityType: string;
  entityId: string;
  title: string;
  status: WorkflowInstanceStatus;
  requester: { id: string; name: string } | null;
  institutionId: string | null;
  groupId: string | null;
  departmentId: string | null;
  context: Record<string, unknown>;
  currentStepKey: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface WorkflowInstanceDetailDto extends WorkflowInstanceDto {
  steps: WorkflowStepInstanceDto[];
  actions: WorkflowActionDto[];
  /** Actions the caller may perform now. */
  allowedActions: Array<WorkflowActionType | 'cancel' | 'resubmit'>;
}

export interface WorkflowInboxItemDto extends WorkflowInstanceDto {
  stepInstanceId: string;
  stepName: string;
  dueAt: string | null;
  overdue: boolean;
}

export interface WorkflowEntityTypeDto {
  entityType: string;
  label: string;
}

/* ------------------------------- Notifications ------------------------------------------- */

export interface NotificationDto {
  id: string;
  eventKey: string;
  title: string;
  body: string | null;
  link: string | null;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreferenceDto {
  eventKey: string;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface NotificationEventDto {
  key: string;
  label: string;
  defaultChannels: NotificationChannel[];
  mandatory: boolean;
}

export interface NotificationRuleDto {
  id: string;
  eventKey: string;
  name: string;
  channels: NotificationChannel[];
  recipients: {
    includeDefault: boolean;
    userIds: string[];
    roleKeys: string[];
    permissions: string[];
  };
  templateKey: string | null;
  institutionId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------- Communication ------------------------------------------- */

export interface CommunicationProviderDto {
  id: string;
  scopeType: SettingScopeType;
  targetId: string;
  channel: MessageChannel;
  providerType: ProviderType;
  name: string;
  priority: number;
  config: Record<string, string | number | boolean>;
  hasCredentials: boolean;
  rateLimitPerMinute: number | null;
  costPerMessage: number | null;
  isActive: boolean;
  /** Delivery callback URL (POST, HMAC signed). */
  webhookUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommunicationProviderCreatedDto extends CommunicationProviderDto {
  /** Returned ONCE: secret used to sign delivery callbacks (`X-Erp-Signature`). */
  webhookSigningSecret: string;
}

export interface MessageTemplateVersionDto {
  id: string;
  version: number;
  subject: string | null;
  body: string;
  htmlBody: string | null;
  variables: string[];
  createdAt: string;
}

export interface MessageTemplateDto {
  id: string;
  scopeType: SettingScopeType;
  targetId: string;
  key: string;
  channel: MessageChannel;
  name: string;
  description: string | null;
  useBrandedLayout: boolean;
  isActive: boolean;
  currentVersion: MessageTemplateVersionDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface RenderedMessageDto {
  channel: MessageChannel;
  subject: string | null;
  text: string;
  html: string | null;
}

export interface MessageLogDto {
  id: string;
  channel: MessageChannel;
  status: MessageStatus;
  recipientAddress: string;
  recipientUserId: string | null;
  subject: string | null;
  bodyPreview: string | null;
  templateKey: string | null;
  templateVersion: number | null;
  eventKey: string | null;
  campaignId: string | null;
  providerType: string | null;
  providerMessageId: string | null;
  cost: number | null;
  attempts: number;
  lastError: string | null;
  institutionId: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  events?: Array<{ status: string; rawStatus: string | null; occurredAt: string }>;
}

export interface CampaignDto {
  id: string;
  name: string;
  channel: MessageChannel;
  status: 'SCHEDULED' | 'QUEUED' | 'SENDING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  institutionId: string | null;
  templateKey: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/* -------------------------------- Integrations ------------------------------------------- */

export interface ApiClientDto {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  scopes: string[];
  scopeType: SettingScopeType;
  targetId: string;
  rateLimitPerMinute: number;
  status: 'ACTIVE' | 'REVOKED';
  secretLast4: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiClientCreatedDto extends ApiClientDto {
  /** Returned ONCE (create / rotate); only a hash is stored. */
  clientSecret: string;
}

export interface ApiUsageDto {
  id: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip: string | null;
  createdAt: string;
}

export interface WebhookDto {
  id: string;
  name: string;
  url: string;
  events: string[];
  description: string | null;
  isActive: boolean;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookCreatedDto extends WebhookDto {
  /** Returned ONCE (create / rotate): HMAC-SHA256 signing secret. */
  signingSecret: string;
}

export interface WebhookDeliveryDto {
  id: string;
  eventId: string;
  eventKey: string;
  status: 'PENDING' | 'RETRYING' | 'DELIVERED' | 'FAILED';
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  replayOfId: string | null;
  createdAt: string;
}

export interface IntegrationCredentialDto {
  id: string;
  scopeType: SettingScopeType;
  targetId: string;
  provider: string;
  name: string;
  description: string | null;
  config: Record<string, string | number | boolean>;
  isActive: boolean;
  masked: string;
  createdAt: string;
  updatedAt: string;
}

export interface DomainEventTypeDto {
  key: string;
  label: string;
  description: string | null;
  /** Deliverable to outbound webhooks. */
  webhook: boolean;
}

/**
 * Workflow entity registry. Modules register each approvable entity type once at import time:
 *
 *   registerWorkflowEntity({
 *     entityType: 'leave_request',
 *     label: 'Leave request',
 *     linkFor: (i) => `/leave/requests/${i.entityId}`,
 *     onApproved: async (i) => leaveService.markApproved(i.entityId),
 *     onRejected: async (i) => leaveService.markRejected(i.entityId),
 *   });
 *
 * Callbacks run in the tenant context of the acting principal (or the system principal for
 * escalations) right after the instance reaches the terminal state. They must be idempotent.
 */
export interface WorkflowInstanceRef {
  id: string;
  entityType: string;
  entityId: string;
  title: string;
  status: string;
  requesterUserId: string | null;
  institutionId: string | null;
  groupId: string | null;
  departmentId: string | null;
  context: Record<string, unknown>;
  /** Comment of the deciding action (reject / send back). */
  comment?: string | null;
}

export interface WorkflowEntityDefinition {
  entityType: string;
  label: string;
  /** App-relative link to the subject (used in notifications / inbox). */
  linkFor?: (instance: WorkflowInstanceRef) => string;
  onApproved?: (instance: WorkflowInstanceRef) => Promise<void>;
  onRejected?: (instance: WorkflowInstanceRef) => Promise<void>;
  onSentBack?: (instance: WorkflowInstanceRef) => Promise<void>;
  onCancelled?: (instance: WorkflowInstanceRef) => Promise<void>;
}

const entities = new Map<string, WorkflowEntityDefinition>();

export function registerWorkflowEntity(def: WorkflowEntityDefinition): void {
  if (!/^[a-z][a-z0-9_]*$/.test(def.entityType)) {
    throw new Error(`Invalid workflow entity type ${def.entityType}`);
  }
  entities.set(def.entityType, def);
}

export function getWorkflowEntity(entityType: string) {
  return entities.get(entityType);
}

export function listWorkflowEntities() {
  return [...entities.values()]
    .map((e) => ({ entityType: e.entityType, label: e.label }))
    .sort((a, b) => a.entityType.localeCompare(b.entityType));
}

/** Resolves the user ids of a requester's reporting manager chain (1 = direct manager). */
export type ReportingManagerResolver = (
  requesterUserId: string,
  levels: number,
) => Promise<string[]>;

let reportingManagerResolver: ReportingManagerResolver | null = null;

/** Registered by the HR layer (employee master). Without it `reporting_manager` resolves to nobody. */
export function registerReportingManagerResolver(fn: ReportingManagerResolver | null): void {
  reportingManagerResolver = fn;
}

export function getReportingManagerResolver() {
  return reportingManagerResolver;
}

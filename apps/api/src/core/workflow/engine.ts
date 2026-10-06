import type { WorkflowActInput, WorkflowApproverInput, WorkflowStepInput } from '@erp/shared';
import {
  Prisma,
  type WorkflowDefinition,
  type WorkflowInstance,
  type WorkflowStepInstance,
} from '@prisma/client';
import { audit } from '../audit';
import { findScopeHolders } from '../authz/holders';
import { currentPrincipal, tryGetPrincipal } from '../authz/principal';
import { emit, registerEventType } from '../events';
import { AppError, ConflictError, ForbiddenError, ValidationError } from '../http/errors';
import { logger } from '../logger';
import { publish, registerNotificationEvent } from '../notifications';
import { tenantDb, withTenant } from '../tenancy/tenant-db';
import { conditionsMatch } from './conditions';
import {
  getReportingManagerResolver,
  getWorkflowEntity,
  type WorkflowInstanceRef,
} from './registry';

for (const [key, label] of [
  ['workflow.submitted', 'Approval request submitted'],
  ['workflow.approved', 'Approval request approved'],
  ['workflow.rejected', 'Approval request rejected'],
  ['workflow.sent_back', 'Approval request sent back'],
  ['workflow.cancelled', 'Approval request cancelled'],
] as const) {
  registerEventType({ key, label });
}
registerNotificationEvent({
  key: 'workflow.approval_requested',
  label: 'Approval requested from me',
  defaultChannels: ['in_app', 'email'],
});
registerNotificationEvent({
  key: 'workflow.escalated',
  label: 'Approval overdue (escalation)',
  defaultChannels: ['in_app', 'email'],
});
registerNotificationEvent({
  key: 'workflow.decided',
  label: 'My request was approved / rejected / sent back',
  defaultChannels: ['in_app', 'email'],
});

export interface SubmitWorkflowInput {
  entityType: string;
  /** Id of the subject (leave request id, payroll run id…). */
  entityId: string;
  title: string;
  /** Defaults to the current principal's user. */
  requesterUserId?: string | null;
  institutionId?: string | null;
  groupId?: string | null;
  departmentId?: string | null;
  /** Fields for step conditions and for approvers (e.g. `{ amount: 60000, days: 3 }`). */
  context?: Record<string, unknown>;
}

const now = () => new Date();

export function toRef(row: WorkflowInstance, comment?: string | null): WorkflowInstanceRef {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    title: row.title,
    status: row.status,
    requesterUserId: row.requesterUserId,
    institutionId: row.institutionId,
    groupId: row.groupId,
    departmentId: row.departmentId,
    context: (row.context as Record<string, unknown>) ?? {},
    comment: comment ?? null,
  };
}

export function instanceResource(row: {
  groupId: string | null;
  institutionId: string | null;
  departmentId: string | null;
}) {
  return { groupId: row.groupId, institutionId: row.institutionId, departmentId: row.departmentId };
}

function linkFor(row: WorkflowInstance): string {
  const entity = getWorkflowEntity(row.entityType);
  return entity?.linkFor?.(toRef(row)) ?? `/approvals/${row.id}`;
}

async function recordAction(
  instance: WorkflowInstance,
  action: string,
  extra: {
    step?: WorkflowStepInstance | null;
    actorUserId?: string | null;
    comment?: string | null;
    delegateToUserId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
) {
  await tenantDb().workflowAction.create({
    data: withTenant({
      instanceId: instance.id,
      stepInstanceId: extra.step?.id ?? null,
      stepKey: extra.step?.stepKey ?? null,
      action,
      actorUserId:
        extra.actorUserId === undefined ? (tryGetPrincipal()?.userId ?? null) : extra.actorUserId,
      comment: extra.comment ?? null,
      delegateToUserId: extra.delegateToUserId ?? null,
      metadata: extra.metadata ? (extra.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
    }),
  });
}

/** Most specific ACTIVE definition for the entity type: institution → group → organization. */
export async function findActiveDefinition(
  entityType: string,
  coords: { institutionId?: string | null; groupId?: string | null },
): Promise<WorkflowDefinition | null> {
  const rows = await tenantDb().workflowDefinition.findMany({
    where: {
      entityType,
      status: 'ACTIVE',
      OR: [
        { scopeType: 'ORGANIZATION' },
        ...(coords.groupId ? [{ scopeType: 'GROUP' as const, targetId: coords.groupId }] : []),
        ...(coords.institutionId
          ? [{ scopeType: 'INSTITUTION' as const, targetId: coords.institutionId }]
          : []),
      ],
    },
  });
  const rank = { INSTITUTION: 0, GROUP: 1, ORGANIZATION: 2 } as const;
  rows.sort((a, b) => rank[a.scopeType] - rank[b.scopeType] || b.version - a.version);
  return rows[0] ?? null;
}

async function activeMemberIds(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await tenantDb().organizationMembership.findMany({
    where: {
      userId: { in: [...new Set(userIds)] },
      status: 'ACTIVE',
      deletedAt: null,
      user: { status: 'ACTIVE', deletedAt: null },
    },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** Users matching the approver sources for this instance (scope-aware). */
export async function resolveApprovers(
  approvers: WorkflowApproverInput[],
  instance: WorkflowInstance,
): Promise<string[]> {
  const resource = instanceResource(instance);
  const ids = new Set<string>();
  for (const a of approvers) {
    if (a.type === 'role') {
      (await findScopeHolders({ roleKeys: [a.roleKey], resource })).forEach((u) => ids.add(u));
    } else if (a.type === 'permission') {
      (await findScopeHolders({ permission: a.permission, resource })).forEach((u) => ids.add(u));
    } else if (a.type === 'user') {
      a.userIds.forEach((u) => ids.add(u));
    } else if (a.type === 'reporting_manager') {
      const resolver = getReportingManagerResolver();
      if (resolver && instance.requesterUserId) {
        try {
          (await resolver(instance.requesterUserId, a.levels)).forEach((u) => ids.add(u));
        } catch (err) {
          logger.warn({ err: (err as Error).message }, 'Reporting manager resolver failed');
        }
      }
    }
  }
  return activeMemberIds([...ids]);
}

async function allowSelfApproval(instance: WorkflowInstance): Promise<boolean> {
  const def = await tenantDb().workflowDefinition.findFirst({
    where: { id: instance.definitionId },
    select: { allowSelfApproval: true },
  });
  return def?.allowSelfApproval ?? false;
}

function stepConfig(step: WorkflowStepInstance): WorkflowStepInput {
  return step.config as unknown as WorkflowStepInput;
}

async function notifyAssignees(
  instance: WorkflowInstance,
  step: WorkflowStepInstance,
  userIds: string[],
  eventKey = 'workflow.approval_requested',
) {
  if (userIds.length === 0) return;
  const entity = getWorkflowEntity(instance.entityType);
  await publish(eventKey, {
    recipients: userIds,
    title:
      eventKey === 'workflow.escalated'
        ? `Overdue approval: ${instance.title}`
        : `Approval needed: ${instance.title}`,
    body: `${entity?.label ?? instance.entityType} — step "${step.name}" is waiting for your decision.`,
    link: `/approvals/${instance.id}`,
    data: {
      workflowInstanceId: instance.id,
      entityType: instance.entityType,
      entityId: instance.entityId,
    },
    institutionId: instance.institutionId,
  });
}

async function notifyRequester(
  instance: WorkflowInstance,
  outcome: string,
  comment?: string | null,
) {
  if (!instance.requesterUserId) return;
  await publish('workflow.decided', {
    recipients: [instance.requesterUserId],
    title: `${instance.title}: ${outcome}`,
    body: comment ?? null,
    link: linkFor(instance),
    data: { workflowInstanceId: instance.id, entityType: instance.entityType, outcome },
    institutionId: instance.institutionId,
  });
}

async function emitStatus(instance: WorkflowInstance, eventKey: string, comment?: string | null) {
  await emit(
    eventKey,
    {
      workflowInstanceId: instance.id,
      entityType: instance.entityType,
      entityId: instance.entityId,
      status: instance.status,
      requesterUserId: instance.requesterUserId,
      ...(comment ? { comment } : {}),
    },
    { institutionId: instance.institutionId },
  );
}

async function finish(instance: WorkflowInstance, comment?: string | null) {
  const db = tenantDb();
  const updated = await db.workflowInstance.update({
    where: { id: instance.id },
    data: { status: 'APPROVED', completedAt: now(), currentStepOrder: null },
  });
  await getWorkflowEntity(updated.entityType)?.onApproved?.(toRef(updated, comment));
  await audit.record({
    action: 'workflow_instance.approved',
    entityType: 'workflow_instance',
    entityId: updated.id,
    after: { status: 'APPROVED', entityType: updated.entityType, entityId: updated.entityId },
  });
  await notifyRequester(updated, 'approved');
  await emitStatus(updated, 'workflow.approved');
  return updated;
}

/**
 * Activate the next applicable step at/after `fromOrder`. Steps whose conditions do not match
 * (or with no resolvable approvers and `skipIfNoApprovers`) are SKIPPED. Without approvers the
 * step falls back to workflow administrators (`workflow.manage` covering the subject).
 */
async function advance(
  instance: WorkflowInstance,
  fromOrder: number,
  /** Comment of the approving action, handed to `onApproved` when this completes the flow. */
  comment?: string | null,
): Promise<WorkflowInstance> {
  const db = tenantDb();
  const steps = await db.workflowStepInstance.findMany({
    where: { instanceId: instance.id, order: { gte: fromOrder } },
    orderBy: { order: 'asc' },
  });
  const context = (instance.context as Record<string, unknown>) ?? {};
  const selfAllowed = await allowSelfApproval(instance);
  for (const step of steps) {
    const cfg = stepConfig(step);
    if (!conditionsMatch(cfg.conditions ?? [], context)) {
      await db.workflowStepInstance.update({
        where: { id: step.id },
        data: { status: 'SKIPPED', completedAt: now() },
      });
      await recordAction(instance, 'skip', {
        step,
        actorUserId: null,
        metadata: { reason: 'conditions' },
      });
      continue;
    }
    const exclude = (ids: string[]) =>
      selfAllowed ? ids : ids.filter((u) => u !== instance.requesterUserId);
    let approvers = exclude(await resolveApprovers(cfg.approvers, instance));
    let fallback = false;
    if (approvers.length === 0 && !cfg.skipIfNoApprovers) {
      approvers = exclude(
        await activeMemberIds(
          await findScopeHolders({
            permission: 'workflow.manage',
            resource: instanceResource(instance),
          }),
        ),
      );
      fallback = true;
    }
    if (approvers.length === 0) {
      await db.workflowStepInstance.update({
        where: { id: step.id },
        data: { status: 'SKIPPED', completedAt: now() },
      });
      await recordAction(instance, 'skip', {
        step,
        actorUserId: null,
        metadata: { reason: 'no_approvers' },
      });
      continue;
    }
    const activatedAt = now();
    const activated = await db.workflowStepInstance.update({
      where: { id: step.id },
      data: {
        status: 'PENDING',
        activatedAt,
        dueAt: cfg.slaHours ? new Date(activatedAt.getTime() + cfg.slaHours * 3_600_000) : null,
      },
    });
    await db.workflowStepAssignee.createMany({
      data: approvers.map((userId) =>
        withTenant({ stepInstanceId: step.id, instanceId: instance.id, userId }),
      ),
    });
    const updated = await db.workflowInstance.update({
      where: { id: instance.id },
      data: { currentStepOrder: step.order },
    });
    if (fallback) {
      await recordAction(instance, 'escalate', {
        step,
        actorUserId: null,
        metadata: { reason: 'no_approvers_fallback_to_admins' },
      });
    }
    await notifyAssignees(updated, activated, approvers);
    return updated;
  }
  return finish(instance, comment);
}

async function createSteps(instance: WorkflowInstance, steps: WorkflowStepInput[]) {
  await tenantDb().workflowStepInstance.createMany({
    data: steps.map((s, i) =>
      withTenant({
        instanceId: instance.id,
        stepKey: s.key,
        name: s.name,
        order: i + 1,
        mode: s.mode ?? 'any',
        status: 'WAITING' as const,
        config: s as unknown as Prisma.InputJsonValue,
      }),
    ),
  });
}

/**
 * Start an approval for a subject. Picks the most specific ACTIVE definition for the entity
 * type and activates its first applicable step. Returns `null` when no definition is configured
 * (the calling module decides: auto-approve or refuse). One open instance per subject (409).
 */
export async function submitWorkflow(input: SubmitWorkflowInput): Promise<WorkflowInstance | null> {
  if (!getWorkflowEntity(input.entityType)) {
    throw new Error(`Workflow entity type "${input.entityType}" is not registered`);
  }
  const db = tenantDb();
  let groupId = input.groupId ?? null;
  if (input.institutionId && !groupId) {
    const inst = await db.institution.findFirst({
      where: { id: input.institutionId },
      select: { groupId: true },
    });
    groupId = inst?.groupId ?? null;
  }
  const definition = await findActiveDefinition(input.entityType, {
    institutionId: input.institutionId,
    groupId,
  });
  if (!definition) return null;
  const open = await db.workflowInstance.findFirst({
    where: {
      entityType: input.entityType,
      entityId: input.entityId,
      status: { in: ['PENDING', 'SENT_BACK'] },
    },
    select: { id: true },
  });
  if (open) throw new ConflictError('An approval request is already open for this item');
  const requesterUserId =
    input.requesterUserId === undefined
      ? (tryGetPrincipal()?.userId ?? null)
      : input.requesterUserId;
  const instance = await db.workflowInstance.create({
    data: withTenant({
      definitionId: definition.id,
      definitionVersion: definition.version,
      entityType: input.entityType,
      entityId: input.entityId,
      title: input.title.slice(0, 300),
      status: 'PENDING' as const,
      requesterUserId,
      groupId,
      institutionId: input.institutionId ?? null,
      departmentId: input.departmentId ?? null,
      context: (input.context ?? {}) as Prisma.InputJsonValue,
    }),
  });
  await createSteps(instance, definition.steps as unknown as WorkflowStepInput[]);
  await recordAction(instance, 'submit', { actorUserId: requesterUserId });
  await audit.record({
    action: 'workflow_instance.submit',
    entityType: 'workflow_instance',
    entityId: instance.id,
    after: {
      entityType: instance.entityType,
      entityId: instance.entityId,
      definitionId: definition.id,
      definitionVersion: definition.version,
    },
  });
  await emitStatus(instance, 'workflow.submitted');
  return advance(instance, 1);
}

async function loadOpen(instanceId: string) {
  const db = tenantDb();
  const instance = await db.workflowInstance.findFirst({ where: { id: instanceId } });
  if (!instance) return null;
  const step =
    instance.status === 'PENDING' && instance.currentStepOrder != null
      ? await db.workflowStepInstance.findFirst({
          where: { instanceId, order: instance.currentStepOrder, status: 'PENDING' },
        })
      : null;
  return { instance, step };
}

const ACT_CONFLICT = () => new ConflictError('This approval step has already been decided');

/**
 * Perform an approver action. Authorization: only a PENDING assignee of the current step may
 * approve / reject / send back / delegate; the requester can never decide their own request
 * unless the definition allows self-approval. Comments: requester, any assignee, or callers
 * with access (checked by the service layer).
 */
export async function actOnWorkflow(
  instance: WorkflowInstance,
  step: WorkflowStepInstance | null,
  input: WorkflowActInput,
): Promise<WorkflowInstance> {
  const principal = currentPrincipal();
  const userId = principal.userId;
  const db = tenantDb();
  if (input.action === 'comment') {
    await recordAction(instance, 'comment', { step, comment: input.comment });
    await audit.record({
      action: 'workflow_instance.comment',
      entityType: 'workflow_instance',
      entityId: instance.id,
    });
    return instance;
  }
  if (instance.status !== 'PENDING' || !step) {
    throw new AppError(409, 'INVALID_STATE', `Request is ${instance.status.toLowerCase()}`);
  }
  if (!userId) throw new ForbiddenError('Only users can decide approvals', 'NOT_AN_APPROVER');
  if (userId === instance.requesterUserId && !(await allowSelfApproval(instance))) {
    throw new ForbiddenError('You cannot approve your own request', 'SELF_APPROVAL_FORBIDDEN');
  }
  const assignee = await db.workflowStepAssignee.findFirst({
    where: { stepInstanceId: step.id, userId, status: 'PENDING' },
  });
  if (!assignee) {
    throw new ForbiddenError('You are not an approver of the current step', 'NOT_AN_APPROVER');
  }
  const cfg = stepConfig(step);

  if (input.action === 'delegate') {
    if (cfg.allowDelegation === false) {
      throw new ForbiddenError('Delegation is not allowed for this step', 'DELEGATION_FORBIDDEN');
    }
    const target = input.delegateToUserId!;
    if (target === userId) throw new ValidationError('Cannot delegate to yourself');
    if (target === instance.requesterUserId && !(await allowSelfApproval(instance))) {
      throw new ValidationError('Cannot delegate to the requester', { field: 'delegateToUserId' });
    }
    if ((await activeMemberIds([target])).length === 0) {
      throw new ValidationError('Delegate must be an active member of the organization', {
        field: 'delegateToUserId',
      });
    }
    const claimed = await db.workflowStepAssignee.updateMany({
      where: { id: assignee.id, status: 'PENDING' },
      data: { status: 'DELEGATED', actedAt: now() },
    });
    if (claimed.count === 0) throw ACT_CONFLICT();
    const existing = await db.workflowStepAssignee.findFirst({
      where: { stepInstanceId: step.id, userId: target },
    });
    if (existing) {
      if (existing.status !== 'PENDING') {
        await db.workflowStepAssignee.update({
          where: { id: existing.id },
          data: { status: 'PENDING', delegatedFromUserId: userId, actedAt: null },
        });
      }
    } else {
      await db.workflowStepAssignee.create({
        data: withTenant({
          stepInstanceId: step.id,
          instanceId: instance.id,
          userId: target,
          delegatedFromUserId: userId,
        }),
      });
    }
    await recordAction(instance, 'delegate', {
      step,
      comment: input.comment,
      delegateToUserId: target,
    });
    await audit.record({
      action: 'workflow_instance.delegate',
      entityType: 'workflow_instance',
      entityId: instance.id,
      metadata: { stepKey: step.stepKey, from: userId, to: target },
    });
    await notifyAssignees(instance, step, [target]);
    return instance;
  }

  const decision = input.action === 'approve' ? 'APPROVED' : 'REJECTED';
  const claimed = await db.workflowStepAssignee.updateMany({
    where: { id: assignee.id, status: 'PENDING' },
    data: { status: decision, actedAt: now() },
  });
  if (claimed.count === 0) throw ACT_CONFLICT();
  await recordAction(instance, input.action, { step, comment: input.comment });
  await audit.record({
    action: `workflow_instance.${input.action}`,
    entityType: 'workflow_instance',
    entityId: instance.id,
    metadata: { stepKey: step.stepKey, comment: input.comment ?? null },
  });

  if (input.action === 'approve') {
    if (step.mode === 'all') {
      const remaining = await db.workflowStepAssignee.count({
        where: { stepInstanceId: step.id, status: 'PENDING' },
      });
      if (remaining > 0) return instance;
    }
    const closed = await db.workflowStepInstance.updateMany({
      where: { id: step.id, status: 'PENDING' },
      data: { status: 'APPROVED', completedAt: now() },
    });
    if (closed.count === 0) return instance;
    await db.workflowStepAssignee.updateMany({
      where: { stepInstanceId: step.id, status: 'PENDING' },
      data: { status: 'SUPERSEDED' },
    });
    return advance(instance, step.order + 1, input.comment);
  }

  // reject / send back end the instance.
  const stepStatus = input.action === 'reject' ? 'REJECTED' : 'SENT_BACK';
  const closed = await db.workflowStepInstance.updateMany({
    where: { id: step.id, status: 'PENDING' },
    data: { status: stepStatus, completedAt: now() },
  });
  if (closed.count === 0) throw ACT_CONFLICT();
  await db.workflowStepAssignee.updateMany({
    where: { stepInstanceId: step.id, status: 'PENDING' },
    data: { status: 'SUPERSEDED' },
  });
  const updated = await db.workflowInstance.update({
    where: { id: instance.id },
    data: {
      status: stepStatus,
      currentStepOrder: null,
      completedAt: input.action === 'reject' ? now() : null,
    },
  });
  const entity = getWorkflowEntity(updated.entityType);
  if (input.action === 'reject') {
    await entity?.onRejected?.(toRef(updated, input.comment));
    await notifyRequester(updated, 'rejected', input.comment);
    await emitStatus(updated, 'workflow.rejected', input.comment);
  } else {
    await entity?.onSentBack?.(toRef(updated, input.comment));
    await notifyRequester(updated, 'sent back for changes', input.comment);
    await emitStatus(updated, 'workflow.sent_back', input.comment);
  }
  return updated;
}

/** Requester re-submits a SENT_BACK request (optionally with updated context): restarts at step 1. */
export async function resubmitWorkflow(
  instance: WorkflowInstance,
  context?: Record<string, unknown>,
  comment?: string | null,
): Promise<WorkflowInstance> {
  if (instance.status !== 'SENT_BACK') {
    throw new AppError(409, 'INVALID_STATE', 'Only sent-back requests can be resubmitted');
  }
  const db = tenantDb();
  const definition = await db.workflowDefinition.findFirst({
    where: { id: instance.definitionId },
  });
  await db.workflowStepAssignee.deleteMany({ where: { instanceId: instance.id } });
  await db.workflowStepInstance.deleteMany({ where: { instanceId: instance.id } });
  const updated = await db.workflowInstance.update({
    where: { id: instance.id },
    data: {
      status: 'PENDING',
      completedAt: null,
      ...(context ? { context: { ...((instance.context as object) ?? {}), ...context } } : {}),
    },
  });
  await createSteps(updated, (definition?.steps ?? []) as unknown as WorkflowStepInput[]);
  await recordAction(updated, 'resubmit', { comment });
  await audit.record({
    action: 'workflow_instance.resubmit',
    entityType: 'workflow_instance',
    entityId: instance.id,
  });
  return advance(updated, 1);
}

export async function cancelWorkflow(
  instance: WorkflowInstance,
  comment?: string | null,
): Promise<WorkflowInstance> {
  if (instance.status !== 'PENDING' && instance.status !== 'SENT_BACK') {
    throw new AppError(409, 'INVALID_STATE', `Request is ${instance.status.toLowerCase()}`);
  }
  const db = tenantDb();
  await db.workflowStepInstance.updateMany({
    where: { instanceId: instance.id, status: { in: ['PENDING', 'WAITING'] } },
    data: { status: 'CANCELLED', completedAt: now() },
  });
  await db.workflowStepAssignee.updateMany({
    where: { instanceId: instance.id, status: 'PENDING' },
    data: { status: 'SUPERSEDED' },
  });
  const updated = await db.workflowInstance.update({
    where: { id: instance.id },
    data: { status: 'CANCELLED', currentStepOrder: null, completedAt: now() },
  });
  await recordAction(updated, 'cancel', { comment });
  await audit.record({
    action: 'workflow_instance.cancel',
    entityType: 'workflow_instance',
    entityId: instance.id,
    before: { status: instance.status },
    after: { status: 'CANCELLED' },
  });
  await getWorkflowEntity(updated.entityType)?.onCancelled?.(toRef(updated, comment));
  await emitStatus(updated, 'workflow.cancelled', comment);
  return updated;
}

/** SLA breach handling for one organization (runs as the system principal). */
export async function escalateOverdueSteps(): Promise<number> {
  const db = tenantDb();
  const overdue = await db.workflowStepInstance.findMany({
    where: { status: 'PENDING', dueAt: { lt: now() }, escalatedAt: null },
    take: 200,
  });
  let count = 0;
  for (const step of overdue) {
    const instance = await db.workflowInstance.findFirst({ where: { id: step.instanceId } });
    if (!instance || instance.status !== 'PENDING') continue;
    const marked = await db.workflowStepInstance.updateMany({
      where: { id: step.id, escalatedAt: null },
      data: { escalatedAt: now() },
    });
    if (marked.count === 0) continue;
    const cfg = stepConfig(step);
    const selfAllowed = await allowSelfApproval(instance);
    const existing = await db.workflowStepAssignee.findMany({
      where: { stepInstanceId: step.id },
      select: { userId: true, status: true },
    });
    const known = new Set(existing.map((e) => e.userId));
    const extra = (await resolveApprovers(cfg.escalateTo ?? [], instance)).filter(
      (u) => !known.has(u) && (selfAllowed || u !== instance.requesterUserId),
    );
    if (extra.length > 0) {
      await db.workflowStepAssignee.createMany({
        data: extra.map((userId) =>
          withTenant({ stepInstanceId: step.id, instanceId: instance.id, userId, escalated: true }),
        ),
      });
    }
    await recordAction(instance, 'escalate', {
      step,
      actorUserId: null,
      metadata: { reason: 'sla_breached', added: extra },
    });
    await audit.record({
      action: 'workflow_instance.escalate',
      entityType: 'workflow_instance',
      entityId: instance.id,
      metadata: { stepKey: step.stepKey, added: extra },
    });
    const pending = existing.filter((e) => e.status === 'PENDING').map((e) => e.userId);
    await notifyAssignees(instance, step, [...pending, ...extra], 'workflow.escalated');
    count += 1;
  }
  return count;
}

export { loadOpen };

import { randomUUID } from 'node:crypto';
import type {
  CreateWorkflowDefinitionInput,
  ListWorkflowDefinitionsQuery,
  ListWorkflowInstancesQuery,
  ReviseWorkflowDefinitionInput,
  WorkflowActInput,
  WorkflowActionDto,
  WorkflowApproverInput,
  WorkflowDefinitionDto,
  WorkflowInboxItemDto,
  WorkflowInboxQuery,
  WorkflowInstanceDetailDto,
  WorkflowInstanceDto,
  WorkflowStepInput,
} from '@erp/shared';
import type { Prisma, WorkflowDefinition, WorkflowInstance } from '@prisma/client';
import { audit } from '../audit';
import { accessFor, authorize, can, currentPrincipal } from '../authz';
import { prisma } from '../db/prisma';
import { AppError, InvalidReferenceError, NotFoundError, ValidationError } from '../http/errors';
import { toListResponse, toPageWindow } from '../http/pagination';
import { defineJob, defineRecurringJob, enqueue, forEachActiveOrganization } from '../queue';
import {
  resolveSettingTarget,
  targetResource,
  whereForTargetAccess,
  type SettingTarget,
} from '../settings/target';
import { tenantDb, withTenant } from '../tenancy/tenant-db';
import {
  actOnWorkflow,
  cancelWorkflow,
  escalateOverdueSteps,
  instanceResource,
  loadOpen,
  resubmitWorkflow,
} from './engine';
import { getWorkflowEntity, listWorkflowEntities } from './registry';

/* ------------------------------------------------------------ definitions ---- */

function definitionDto(row: WorkflowDefinition): WorkflowDefinitionDto {
  return {
    id: row.id,
    entityType: row.entityType,
    name: row.name,
    description: row.description,
    version: row.version,
    status: row.status,
    scopeType: row.scopeType,
    targetId: row.targetId,
    allowSelfApproval: row.allowSelfApproval,
    steps: row.steps as unknown as WorkflowStepInput[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const defTarget = (row: WorkflowDefinition): SettingTarget => ({
  scopeType: row.scopeType,
  targetId: row.targetId,
  groupId: row.groupId,
  institutionId: row.institutionId,
});

async function validateSteps(steps: WorkflowStepInput[]) {
  const db = tenantDb();
  const approvers: WorkflowApproverInput[] = steps.flatMap((s) => [
    ...s.approvers,
    ...(s.escalateTo ?? []),
  ]);
  const roleKeys = [...new Set(approvers.flatMap((a) => (a.type === 'role' ? [a.roleKey] : [])))];
  if (roleKeys.length) {
    const found = await db.role.findMany({
      where: { key: { in: roleKeys }, deletedAt: null },
      select: { key: true },
    });
    const missing = roleKeys.filter((k) => !found.some((f) => f.key === k));
    if (missing.length)
      throw new InvalidReferenceError('steps.approvers.roleKey', `Role ${missing.join(', ')}`);
  }
  const userIds = [...new Set(approvers.flatMap((a) => (a.type === 'user' ? a.userIds : [])))];
  if (userIds.length) {
    const found = await db.organizationMembership.count({
      where: { userId: { in: userIds }, deletedAt: null },
    });
    if (found !== userIds.length)
      throw new InvalidReferenceError('steps.approvers.userIds', 'User');
  }
}

async function archiveActive(entityType: string, target: SettingTarget, exceptId: string) {
  await tenantDb().workflowDefinition.updateMany({
    where: {
      entityType,
      scopeType: target.scopeType,
      targetId: target.targetId,
      status: 'ACTIVE',
      id: { not: exceptId },
    },
    data: { status: 'ARCHIVED' },
  });
}

async function findDefinition(id: string, permission: 'workflow.view' | 'workflow.manage') {
  const row = await tenantDb().workflowDefinition.findFirst({ where: { id } });
  if (!row) throw new NotFoundError('Workflow definition');
  try {
    await authorize(currentPrincipal(), permission, targetResource(defTarget(row)));
  } catch (err) {
    if (permission === 'workflow.view') throw new NotFoundError('Workflow definition');
    throw err;
  }
  return row;
}

export const workflowDefinitionsService = {
  entityTypes: listWorkflowEntities,

  async list(query: ListWorkflowDefinitionsQuery) {
    const access = await accessFor(currentPrincipal(), 'workflow.view');
    const scope = whereForTargetAccess(access);
    const where: Prisma.WorkflowDefinitionWhereInput = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { name: { contains: query.search } } : {}),
      ...(scope ? { AND: [scope] } : {}),
    };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.workflowDefinition.findMany({
        where,
        orderBy: [{ entityType: 'asc' }, { familyId: 'asc' }, { version: 'desc' }],
        ...toPageWindow(query),
      }),
      db.workflowDefinition.count({ where }),
    ]);
    return toListResponse(rows.map(definitionDto), total, query);
  },

  async get(id: string) {
    return definitionDto(await findDefinition(id, 'workflow.view'));
  },

  async versions(id: string) {
    const row = await findDefinition(id, 'workflow.view');
    const rows = await tenantDb().workflowDefinition.findMany({
      where: { familyId: row.familyId },
      orderBy: { version: 'desc' },
    });
    return rows.map(definitionDto);
  },

  async create(input: CreateWorkflowDefinitionInput) {
    if (!getWorkflowEntity(input.entityType)) {
      throw new ValidationError(`Unknown workflow entity type "${input.entityType}"`, {
        field: 'entityType',
      });
    }
    const target = await resolveSettingTarget(input.scopeType, input.targetId);
    await authorize(currentPrincipal(), 'workflow.manage', targetResource(target));
    await validateSteps(input.steps);
    const row = await tenantDb().workflowDefinition.create({
      data: withTenant({
        familyId: randomUUID(),
        version: 1,
        entityType: input.entityType,
        name: input.name,
        description: input.description ?? null,
        status: input.activate ? 'ACTIVE' : 'DRAFT',
        scopeType: target.scopeType,
        targetId: target.targetId,
        groupId: target.groupId,
        institutionId: target.institutionId,
        steps: input.steps as unknown as Prisma.InputJsonValue,
        allowSelfApproval: input.allowSelfApproval,
        createdById: currentPrincipal().userId,
      }),
    });
    if (input.activate) await archiveActive(row.entityType, target, row.id);
    await audit.record({
      action: 'workflow_definition.create',
      entityType: 'workflow_definition',
      entityId: row.id,
      after: definitionDto(row),
    });
    return definitionDto(row);
  },

  /** New version of the definition family (running instances keep their version). */
  async revise(id: string, input: ReviseWorkflowDefinitionInput) {
    const base = await findDefinition(id, 'workflow.manage');
    await validateSteps(input.steps);
    const db = tenantDb();
    const latest = await db.workflowDefinition.findFirst({
      where: { familyId: base.familyId },
      orderBy: { version: 'desc' },
    });
    const row = await db.workflowDefinition.create({
      data: withTenant({
        familyId: base.familyId,
        version: (latest?.version ?? base.version) + 1,
        entityType: base.entityType,
        name: input.name ?? base.name,
        description: input.description !== undefined ? input.description : base.description,
        status: input.activate ? 'ACTIVE' : 'DRAFT',
        scopeType: base.scopeType,
        targetId: base.targetId,
        groupId: base.groupId,
        institutionId: base.institutionId,
        steps: input.steps as unknown as Prisma.InputJsonValue,
        allowSelfApproval: input.allowSelfApproval ?? base.allowSelfApproval,
        createdById: currentPrincipal().userId,
      }),
    });
    if (input.activate) await archiveActive(row.entityType, defTarget(row), row.id);
    await audit.record({
      action: 'workflow_definition.revise',
      entityType: 'workflow_definition',
      entityId: row.id,
      before: { id: base.id, version: base.version },
      after: definitionDto(row),
    });
    return definitionDto(row);
  },

  async setStatus(id: string, status: 'ACTIVE' | 'ARCHIVED') {
    const before = await findDefinition(id, 'workflow.manage');
    const row = await tenantDb().workflowDefinition.update({ where: { id }, data: { status } });
    if (status === 'ACTIVE') await archiveActive(row.entityType, defTarget(row), row.id);
    await audit.record({
      action: status === 'ACTIVE' ? 'workflow_definition.activate' : 'workflow_definition.archive',
      entityType: 'workflow_definition',
      entityId: id,
      before: { status: before.status },
      after: { status },
    });
    return definitionDto(row);
  },
};

/* -------------------------------------------------------------- instances ---- */

async function userNames(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (unique.length === 0) return new Map<string, string>();
  const rows = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

function instanceDto(
  row: WorkflowInstance,
  names: Map<string, string>,
  currentStepKey: string | null,
): WorkflowInstanceDto {
  return {
    id: row.id,
    definitionId: row.definitionId,
    definitionVersion: row.definitionVersion,
    entityType: row.entityType,
    entityId: row.entityId,
    title: row.title,
    status: row.status,
    requester: row.requesterUserId
      ? { id: row.requesterUserId, name: names.get(row.requesterUserId) ?? '' }
      : null,
    institutionId: row.institutionId,
    groupId: row.groupId,
    departmentId: row.departmentId,
    context: (row.context as Record<string, unknown>) ?? {},
    currentStepKey,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

/** Visible to: the requester, any (past) assignee, or `workflow.view` covering the subject. */
async function findVisibleInstance(id: string) {
  const row = await tenantDb().workflowInstance.findFirst({ where: { id } });
  if (!row) throw new NotFoundError('Approval request');
  const principal = currentPrincipal();
  const userId = principal.userId;
  if (userId && row.requesterUserId === userId) return { row, role: 'requester' as const };
  if (userId) {
    const assigned = await tenantDb().workflowStepAssignee.findFirst({
      where: { instanceId: id, userId },
      select: { id: true },
    });
    if (assigned) return { row, role: 'assignee' as const };
  }
  if (await can(principal, 'workflow.view', instanceResource(row)))
    return { row, role: 'viewer' as const };
  throw new NotFoundError('Approval request');
}

export const workflowInstancesService = {
  async list(query: ListWorkflowInstancesQuery) {
    const principal = currentPrincipal();
    const filters: Prisma.WorkflowInstanceWhereInput[] = [];
    if (query.view === 'mine') {
      filters.push({ requesterUserId: principal.userId ?? '__none__' });
    } else {
      const access = await accessFor(principal, 'workflow.view');
      if (!access.all) {
        if (!principal.grants.some((g) => g.permissions.has('workflow.view'))) {
          await authorize(principal, 'workflow.view');
        }
        filters.push({
          OR: [
            { groupId: { in: [...access.groupIds] } },
            { institutionId: { in: [...access.institutionIds] } },
            { departmentId: { in: [...access.departmentIds] } },
          ],
        });
      }
    }
    if (query.entityType) filters.push({ entityType: query.entityType });
    if (query.status) filters.push({ status: query.status });
    const where: Prisma.WorkflowInstanceWhereInput = { AND: filters };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.workflowInstance.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toPageWindow(query),
      }),
      db.workflowInstance.count({ where }),
    ]);
    const names = await userNames(rows.map((r) => r.requesterUserId));
    const steps = await currentSteps(rows);
    return toListResponse(
      rows.map((r) => instanceDto(r, names, steps.get(r.id)?.stepKey ?? null)),
      total,
      query,
    );
  },

  /** My pending approvals. */
  async inbox(query: WorkflowInboxQuery) {
    const userId = currentPrincipal().userId;
    if (!userId) return toListResponse<WorkflowInboxItemDto>([], 0, query);
    const where: Prisma.WorkflowStepAssigneeWhereInput = {
      userId,
      status: 'PENDING',
      stepInstance: {
        status: 'PENDING',
        instance: {
          status: 'PENDING',
          ...(query.entityType ? { entityType: query.entityType } : {}),
        },
      },
    };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.workflowStepAssignee.findMany({
        where,
        include: { stepInstance: { include: { instance: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...toPageWindow(query),
      }),
      db.workflowStepAssignee.count({ where }),
    ]);
    const names = await userNames(rows.map((r) => r.stepInstance.instance.requesterUserId));
    const nowMs = Date.now();
    const items: WorkflowInboxItemDto[] = rows.map((r) => ({
      ...instanceDto(r.stepInstance.instance, names, r.stepInstance.stepKey),
      stepInstanceId: r.stepInstance.id,
      stepName: r.stepInstance.name,
      dueAt: r.stepInstance.dueAt?.toISOString() ?? null,
      overdue: !!r.stepInstance.dueAt && r.stepInstance.dueAt.getTime() < nowMs,
    }));
    return toListResponse(items, total, query);
  },

  async get(id: string): Promise<WorkflowInstanceDetailDto> {
    const { row, role } = await findVisibleInstance(id);
    return detail(row, role);
  },

  /**
   * Active organization members a pending approver can delegate the current step to, searched by
   * name or email. Only the current step's pending assignees may look up delegates.
   */
  async delegateCandidates(id: string, search: string) {
    const { row } = await findVisibleInstance(id);
    const open = await loadOpen(row.id);
    const userId = currentPrincipal().userId;
    const db = tenantDb();
    const assignee =
      open?.step && userId
        ? await db.workflowStepAssignee.findFirst({
            where: { stepInstanceId: open.step.id, userId, status: 'PENDING' },
            select: { id: true },
          })
        : null;
    if (!assignee) {
      throw new AppError(403, 'NOT_AN_APPROVER', 'You are not an approver of the current step');
    }
    const term = search.trim();
    const rows = await db.organizationMembership.findMany({
      where: {
        status: 'ACTIVE',
        userId: { not: userId! },
        user: {
          status: 'ACTIVE',
          deletedAt: null,
          ...(term ? { OR: [{ name: { contains: term } }, { email: { contains: term } }] } : {}),
        },
      },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: 'asc' } },
      take: 20,
    });
    return rows.map((r) => r.user);
  },

  async act(id: string, input: WorkflowActInput) {
    const { row, role } = await findVisibleInstance(id);
    const open = await loadOpen(row.id);
    await actOnWorkflow(open!.instance, open!.step, input);
    const fresh = await tenantDb().workflowInstance.findFirstOrThrow({ where: { id } });
    return detail(fresh, role);
  },

  async cancel(id: string, comment?: string | null) {
    const { row, role } = await findVisibleInstance(id);
    const principal = currentPrincipal();
    const isRequester = !!principal.userId && principal.userId === row.requesterUserId;
    if (!isRequester && !(await can(principal, 'workflow.manage', instanceResource(row)))) {
      throw new AppError(
        403,
        'PERMISSION_DENIED',
        'Only the requester or a workflow administrator can cancel',
      );
    }
    const updated = await cancelWorkflow(row, comment);
    return detail(updated, role);
  },

  async resubmit(id: string, comment?: string | null) {
    const { row, role } = await findVisibleInstance(id);
    if (currentPrincipal().userId !== row.requesterUserId) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only the requester can resubmit');
    }
    const updated = await resubmitWorkflow(row, undefined, comment);
    return detail(updated, role);
  },
};

async function currentSteps(rows: WorkflowInstance[]) {
  const open = rows.filter((r) => r.currentStepOrder != null);
  if (open.length === 0) return new Map<string, { stepKey: string }>();
  const steps = await tenantDb().workflowStepInstance.findMany({
    where: { OR: open.map((r) => ({ instanceId: r.id, order: r.currentStepOrder! })) },
    select: { instanceId: true, stepKey: true },
  });
  return new Map(steps.map((s) => [s.instanceId, s]));
}

async function detail(
  row: WorkflowInstance,
  role: 'requester' | 'assignee' | 'viewer',
): Promise<WorkflowInstanceDetailDto> {
  const db = tenantDb();
  const [steps, actions] = await Promise.all([
    db.workflowStepInstance.findMany({
      where: { instanceId: row.id },
      include: { assignees: { orderBy: { createdAt: 'asc' } } },
      orderBy: { order: 'asc' },
    }),
    db.workflowAction.findMany({ where: { instanceId: row.id }, orderBy: { createdAt: 'asc' } }),
  ]);
  const names = await userNames([
    row.requesterUserId,
    ...steps.flatMap((s) => s.assignees.map((a) => a.userId)),
    ...actions.map((a) => a.actorUserId),
  ]);
  const principal = currentPrincipal();
  const userId = principal.userId;
  const current = steps.find((s) => s.order === row.currentStepOrder && s.status === 'PENDING');
  const allowed: WorkflowInstanceDetailDto['allowedActions'] = ['comment'];
  const isRequester = !!userId && userId === row.requesterUserId;
  if (
    row.status === 'PENDING' &&
    current?.assignees.some((a) => a.userId === userId && a.status === 'PENDING')
  ) {
    const def = await db.workflowDefinition.findFirst({
      where: { id: row.definitionId },
      select: { allowSelfApproval: true },
    });
    if (!isRequester || def?.allowSelfApproval) {
      allowed.push('approve', 'reject', 'send_back');
      if ((current.config as unknown as WorkflowStepInput).allowDelegation !== false) {
        allowed.push('delegate');
      }
    }
  }
  if (
    (row.status === 'PENDING' || row.status === 'SENT_BACK') &&
    (isRequester || (await can(principal, 'workflow.manage', instanceResource(row))))
  ) {
    allowed.push('cancel');
  }
  if (row.status === 'SENT_BACK' && isRequester) allowed.push('resubmit');
  void role;
  return {
    ...instanceDto(row, names, current?.stepKey ?? null),
    steps: steps.map((s) => ({
      id: s.id,
      stepKey: s.stepKey,
      name: s.name,
      order: s.order,
      mode: s.mode as 'any' | 'all',
      status: s.status,
      dueAt: s.dueAt?.toISOString() ?? null,
      escalatedAt: s.escalatedAt?.toISOString() ?? null,
      activatedAt: s.activatedAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
      assignees: s.assignees.map((a) => ({
        userId: a.userId,
        name: names.get(a.userId) ?? null,
        status: a.status,
        delegatedFromUserId: a.delegatedFromUserId,
        escalated: a.escalated,
        actedAt: a.actedAt?.toISOString() ?? null,
      })),
    })),
    actions: actions.map((a): WorkflowActionDto => ({
      id: a.id,
      action: a.action as WorkflowActionDto['action'],
      stepKey: a.stepKey,
      actor: a.actorUserId ? { id: a.actorUserId, name: names.get(a.actorUserId) ?? '' } : null,
      comment: a.comment,
      delegateToUserId: a.delegateToUserId,
      createdAt: a.createdAt.toISOString(),
    })),
    allowedActions: allowed,
  };
}

/* ---------------------------------------------------------------- SLA jobs ---- */

defineJob<{ organizationId: string }>({
  name: 'workflow.sla_check',
  attempts: 3,
  handler: async () => {
    await escalateOverdueSteps();
  },
});

defineRecurringJob({
  name: 'workflow.sla_escalation',
  everyMs: 15 * 60 * 1000,
  handler: async () => {
    const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
    await forEachActiveOrganization(async (organizationId) => {
      const pending = await prisma.workflowStepInstance.count({
        where: { organizationId, status: 'PENDING', dueAt: { lt: new Date() }, escalatedAt: null },
      });
      if (pending > 0) {
        await enqueue(
          'workflow.sla_check',
          { organizationId },
          { jobId: `sla:${organizationId}:${bucket}` },
        );
      }
    });
  },
});

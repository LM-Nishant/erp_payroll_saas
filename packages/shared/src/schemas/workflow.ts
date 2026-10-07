import { z } from 'zod';
import { idSchema, nameSchema, paginationQuerySchema } from './common';
import { refineSettingTarget, settingScopeTypeSchema } from './licensing';

/*
 * Approval workflow engine (core/workflow). Definitions are versioned: editing an ACTIVE
 * definition creates a new version; running instances keep the version they started with.
 */

export const WORKFLOW_ACTIONS = ['approve', 'reject', 'send_back', 'delegate', 'comment'] as const;
export type WorkflowActionType = (typeof WORKFLOW_ACTIONS)[number];

export const WORKFLOW_INSTANCE_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SENT_BACK',
  'CANCELLED',
] as const;
export type WorkflowInstanceStatus = (typeof WORKFLOW_INSTANCE_STATUSES)[number];

export const WORKFLOW_DEFINITION_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type WorkflowDefinitionStatus = (typeof WORKFLOW_DEFINITION_STATUSES)[number];

export const workflowEntityTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Lower snake_case entity type');

const stepKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[a-z][a-z0-9_]*$/, 'Lower snake_case step key');

/**
 * Who approves a step.
 * - `role`: users holding the role (by key) whose scope covers the request (institution /
 *   group / department of the subject).
 * - `permission`: users holding the permission in a scope covering the request.
 * - `user`: specific users.
 * - `reporting_manager`: resolved by the registered reporting-manager hook (HR layer).
 */
export const workflowApproverSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('role'), roleKey: z.string().trim().min(1).max(64) }).strict(),
  z
    .object({
      type: z.literal('permission'),
      permission: z
        .string()
        .trim()
        .max(100)
        .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
    })
    .strict(),
  z.object({ type: z.literal('user'), userIds: z.array(idSchema).min(1).max(50) }).strict(),
  z
    .object({ type: z.literal('reporting_manager'), levels: z.number().int().min(1).max(5) })
    .strict(),
]);
export type WorkflowApproverInput = z.infer<typeof workflowApproverSchema>;

/** Step condition on the instance context (e.g. `amount > 50000`); false → step skipped. */
export const workflowConditionSchema = z
  .object({
    field: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/),
    op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'exists']),
    value: z
      .union([z.string().max(200), z.number(), z.boolean(), z.array(z.string().max(200)).max(50)])
      .optional(),
  })
  .strict();
export type WorkflowConditionInput = z.infer<typeof workflowConditionSchema>;

export const workflowStepSchema = z
  .object({
    key: stepKeySchema,
    name: nameSchema,
    /** One or more approver sources; resolved users are merged. */
    approvers: z.array(workflowApproverSchema).min(1).max(5),
    /** `any`: first approval completes the step; `all`: every resolved approver must approve. */
    mode: z.enum(['any', 'all']).default('any'),
    conditions: z.array(workflowConditionSchema).max(10).default([]),
    /** Hours until the step escalates (SLA). */
    slaHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .nullish(),
    /** Extra approvers added when the SLA is breached. */
    escalateTo: z.array(workflowApproverSchema).max(5).default([]),
    /** Skip (instead of failing) when no approver can be resolved. */
    skipIfNoApprovers: z.boolean().default(false),
    allowDelegation: z.boolean().default(true),
  })
  .strict();
export type WorkflowStepInput = z.infer<typeof workflowStepSchema>;

const stepsSchema = z
  .array(workflowStepSchema)
  .min(1)
  .max(20)
  .superRefine((steps, ctx) => {
    const seen = new Set<string>();
    steps.forEach((s, i) => {
      if (seen.has(s.key)) {
        ctx.addIssue({ code: 'custom', path: [i, 'key'], message: 'Duplicate step key' });
      }
      seen.add(s.key);
    });
  });

export const createWorkflowDefinitionSchema = z
  .object({
    entityType: workflowEntityTypeSchema,
    name: nameSchema,
    description: z.string().trim().max(1000).nullish(),
    scopeType: settingScopeTypeSchema.default('ORGANIZATION'),
    targetId: idSchema.optional(),
    steps: stepsSchema,
    allowSelfApproval: z.boolean().default(false),
    activate: z.boolean().default(true),
  })
  .strict()
  .superRefine(refineSettingTarget);
export type CreateWorkflowDefinitionInput = z.infer<typeof createWorkflowDefinitionSchema>;

/** Creates a NEW version of the definition (the previous ACTIVE version is archived). */
export const reviseWorkflowDefinitionSchema = z
  .object({
    name: nameSchema.optional(),
    description: z.string().trim().max(1000).nullish(),
    steps: stepsSchema,
    allowSelfApproval: z.boolean().optional(),
    activate: z.boolean().default(true),
  })
  .strict();
export type ReviseWorkflowDefinitionInput = z.infer<typeof reviseWorkflowDefinitionSchema>;

export const listWorkflowDefinitionsQuerySchema = paginationQuerySchema
  .extend({
    entityType: workflowEntityTypeSchema.optional(),
    status: z.enum(WORKFLOW_DEFINITION_STATUSES).optional(),
  })
  .strict();
export type ListWorkflowDefinitionsQuery = z.infer<typeof listWorkflowDefinitionsQuerySchema>;

export const workflowActSchema = z
  .object({
    action: z.enum(WORKFLOW_ACTIONS),
    comment: z.string().trim().max(2000).nullish(),
    delegateToUserId: idSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.action === 'delegate' && !v.delegateToUserId) {
      ctx.addIssue({ code: 'custom', path: ['delegateToUserId'], message: 'Required' });
    }
    if (v.action !== 'delegate' && v.delegateToUserId) {
      ctx.addIssue({ code: 'custom', path: ['delegateToUserId'], message: 'Only for delegate' });
    }
    if (
      (v.action === 'reject' || v.action === 'send_back' || v.action === 'comment') &&
      !v.comment
    ) {
      ctx.addIssue({ code: 'custom', path: ['comment'], message: 'A comment is required' });
    }
  });
export type WorkflowActInput = z.infer<typeof workflowActSchema>;

export const workflowCancelSchema = z
  .object({ comment: z.string().trim().max(2000).nullish() })
  .strict();

export const listWorkflowInstancesQuerySchema = paginationQuerySchema
  .omit({ search: true })
  .extend({
    entityType: workflowEntityTypeSchema.optional(),
    status: z.enum(WORKFLOW_INSTANCE_STATUSES).optional(),
    /** `mine` = requested by me; `all` = everything in scope (needs workflow.view). */
    view: z.enum(['mine', 'all']).default('mine'),
  })
  .strict();
export type ListWorkflowInstancesQuery = z.infer<typeof listWorkflowInstancesQuerySchema>;

export const workflowInboxQuerySchema = paginationQuerySchema
  .omit({ search: true })
  .extend({ entityType: workflowEntityTypeSchema.optional() })
  .strict();
export type WorkflowInboxQuery = z.infer<typeof workflowInboxQuerySchema>;

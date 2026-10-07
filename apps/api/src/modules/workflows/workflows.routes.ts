import {
  createWorkflowDefinitionSchema,
  idParamSchema,
  listWorkflowDefinitionsQuerySchema,
  listWorkflowInstancesQuerySchema,
  reviseWorkflowDefinitionSchema,
  workflowActSchema,
  workflowCancelSchema,
  workflowInboxQuerySchema,
} from '@erp/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../core/authz';
import { parseInput } from '../../core/http/validation';
import { workflowDefinitionsService, workflowInstancesService } from '../../core/workflow';

/**
 * /api/v1/workflows — approval workflow definitions (workflow.view / workflow.manage) and
 * instances. The inbox and instance actions are authorized per step by the engine (only the
 * pending assignee may act; requesters cannot approve their own requests unless configured).
 */
export const workflowsRouter = Router();

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'ARCHIVED']) }).strict();

workflowsRouter.get('/entity-types', (_req, res) => {
  res.json({ data: workflowDefinitionsService.entityTypes() });
});

workflowsRouter.get('/definitions', requirePermission('workflow.view'), async (req, res) => {
  res.json(
    await workflowDefinitionsService.list(
      parseInput(listWorkflowDefinitionsQuerySchema, req.query),
    ),
  );
});
workflowsRouter.get('/definitions/:id', requirePermission('workflow.view'), async (req, res) => {
  res.json({ data: await workflowDefinitionsService.get(idOf(req)) });
});
workflowsRouter.get(
  '/definitions/:id/versions',
  requirePermission('workflow.view'),
  async (req, res) => {
    res.json({ data: await workflowDefinitionsService.versions(idOf(req)) });
  },
);
workflowsRouter.post('/definitions', requirePermission('workflow.manage'), async (req, res) => {
  const input = parseInput(createWorkflowDefinitionSchema, req.body);
  res.status(201).json({ data: await workflowDefinitionsService.create(input) });
});
workflowsRouter.post(
  '/definitions/:id/revisions',
  requirePermission('workflow.manage'),
  async (req, res) => {
    const input = parseInput(reviseWorkflowDefinitionSchema, req.body);
    res.status(201).json({ data: await workflowDefinitionsService.revise(idOf(req), input) });
  },
);
workflowsRouter.post(
  '/definitions/:id/status',
  requirePermission('workflow.manage'),
  async (req, res) => {
    const { status } = parseInput(statusSchema, req.body);
    res.json({ data: await workflowDefinitionsService.setStatus(idOf(req), status) });
  },
);

workflowsRouter.get('/inbox', async (req, res) => {
  res.json(await workflowInstancesService.inbox(parseInput(workflowInboxQuerySchema, req.query)));
});
workflowsRouter.get('/instances', async (req, res) => {
  res.json(
    await workflowInstancesService.list(parseInput(listWorkflowInstancesQuerySchema, req.query)),
  );
});
workflowsRouter.get('/instances/:id', async (req, res) => {
  res.json({ data: await workflowInstancesService.get(idOf(req)) });
});
const delegateQuerySchema = z.object({ search: z.string().max(100).optional() }).strict();
workflowsRouter.get('/instances/:id/delegates', async (req, res) => {
  const { search } = parseInput(delegateQuerySchema, req.query);
  res.json({ data: await workflowInstancesService.delegateCandidates(idOf(req), search ?? '') });
});
workflowsRouter.post('/instances/:id/actions', async (req, res) => {
  const input = parseInput(workflowActSchema, req.body);
  res.json({ data: await workflowInstancesService.act(idOf(req), input) });
});
workflowsRouter.post('/instances/:id/cancel', async (req, res) => {
  const { comment } = parseInput(workflowCancelSchema, req.body ?? {});
  res.json({ data: await workflowInstancesService.cancel(idOf(req), comment) });
});
workflowsRouter.post('/instances/:id/resubmit', async (req, res) => {
  const { comment } = parseInput(workflowCancelSchema, req.body ?? {});
  res.json({ data: await workflowInstancesService.resubmit(idOf(req), comment) });
});

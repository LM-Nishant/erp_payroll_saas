import { Router, type Request, type RequestHandler } from 'express';
import {
  aiChatSchema,
  aiDraftSchema,
  aiPayrollExplainSchema,
  aiStudentInsightSchema,
  aiSummarizeSchema,
  aiUsageQuerySchema,
  idParamSchema,
  listAiConversationsQuerySchema,
  listAiUsageLogsQuerySchema,
  updateAiSettingsSchema,
} from '@erp/shared';
import { aiUsageDashboard, listAiUsageLogs, loadAiSettings, updateAiSettings } from '../../core/ai';
import { currentPrincipal, hasPermission, requirePermission } from '../../core/authz';
import { ForbiddenError } from '../../core/http/errors';
import { parseInput } from '../../core/http/validation';
import { aiService } from './ai.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

/** Any of the given permissions (at some scope). */
const requireAnyPermission =
  (...permissions: string[]): RequestHandler =>
  (_req, _res, next) => {
    const principal = currentPrincipal();
    if (!permissions.some((p) => hasPermission(principal, p))) {
      throw new ForbiddenError(`Requires one of: ${permissions.join(', ')}`);
    }
    next();
  };

export const aiRouter = Router();

aiRouter.get(
  '/status',
  requireAnyPermission('ai.use', 'ai.manage', 'ai.view_usage'),
  async (_req, res) => {
    res.json({ data: await aiService.status() });
  },
);

/* settings (org admins) */
aiRouter.get('/settings', requireAnyPermission('ai.manage', 'ai.view_usage'), async (_req, res) => {
  res.json({ data: await loadAiSettings() });
});
aiRouter.put('/settings', requirePermission('ai.manage'), async (req, res) => {
  res.json({ data: await updateAiSettings(parseInput(updateAiSettingsSchema, req.body)) });
});

/* assistant */
aiRouter.post('/chat', requirePermission('ai.use'), async (req, res) => {
  res.json({ data: await aiService.chat(parseInput(aiChatSchema, req.body)) });
});
aiRouter.get('/conversations', requirePermission('ai.use'), async (req, res) => {
  res.json(
    await aiService.listConversations(parseInput(listAiConversationsQuerySchema, req.query)),
  );
});
aiRouter.get('/conversations/:id', requirePermission('ai.use'), async (req, res) => {
  res.json({ data: await aiService.getConversation(idOf(req)) });
});
aiRouter.delete('/conversations/:id', requirePermission('ai.use'), async (req, res) => {
  await aiService.deleteConversation(idOf(req));
  res.status(204).end();
});

/* task features */
aiRouter.post('/drafts', requirePermission('ai.use'), async (req, res) => {
  res.json({ data: await aiService.draft(parseInput(aiDraftSchema, req.body)) });
});
aiRouter.post(
  '/payroll/explain',
  requirePermission('ai.use'),
  requirePermission('payroll.view'),
  async (req, res) => {
    res.json({
      data: await aiService.explainPayrollRun(parseInput(aiPayrollExplainSchema, req.body)),
    });
  },
);
aiRouter.post(
  '/students/insights',
  requirePermission('ai.use'),
  requirePermission('student.view'),
  async (req, res) => {
    res.json({
      data: await aiService.studentInsights(parseInput(aiStudentInsightSchema, req.body)),
    });
  },
);
aiRouter.post('/summarize', requirePermission('ai.use'), async (req, res) => {
  res.json({ data: await aiService.summarize(parseInput(aiSummarizeSchema, req.body)) });
});

/* governance */
aiRouter.get('/usage', requirePermission('ai.view_usage'), async (req, res) => {
  res.json({ data: await aiUsageDashboard(parseInput(aiUsageQuerySchema, req.query)) });
});
aiRouter.get('/usage/logs', requirePermission('ai.view_usage'), async (req, res) => {
  res.json(await listAiUsageLogs(parseInput(listAiUsageLogsQuerySchema, req.query)));
});

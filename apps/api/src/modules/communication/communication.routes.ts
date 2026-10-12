import {
  createBroadcastSchema,
  createCampaignSchema,
  createCommunicationProviderSchema,
  createMessageTemplateSchema,
  idParamSchema,
  listCampaignsQuerySchema,
  listMessageLogsQuerySchema,
  listProvidersQuerySchema,
  listTemplatesQuerySchema,
  messageChannelSchema,
  previewAudienceSchema,
  previewMessageTemplateSchema,
  reviseMessageTemplateSchema,
  sendMessageSchema,
  templateKeySchema,
  testCommunicationProviderSchema,
  templateVariablesSchema,
  updateCommunicationProviderSchema,
} from '@erp/shared';
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { currentPrincipal, hasPermission, requirePermission } from '../../core/authz';
import {
  broadcastsService,
  campaignsService,
  handleDeliveryCallback,
  messagesService,
  providersService,
  templatesService,
} from '../../core/communication';
import { env } from '../../core/config/env';
import { ForbiddenError } from '../../core/http/errors';
import { parseInput } from '../../core/http/validation';

/**
 * /api/v1/communication — providers, templates, message logs, sends and campaigns. Mounted
 * behind `requireFeature('communication')`; channel features (email/sms/whatsapp) and the
 * `communication_messages` limit are enforced by the engine. Row-level target scope is
 * enforced inside the services.
 */
export const communicationRouter = Router();

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const activeSchema = z.object({ isActive: z.boolean() }).strict();
const previewByKeySchema = z
  .object({
    key: templateKeySchema,
    channel: messageChannelSchema,
    institutionId: z.string().uuid().optional(),
    variables: templateVariablesSchema.default({}),
  })
  .strict();

const view = requirePermission('communication.view');
const manage = requirePermission('communication.manage');
const broadcast = requirePermission('message.broadcast');
/** Campaign list / detail: the message log admins and announcement senders (own campaigns). */
const viewCampaigns: RequestHandler = (_req, _res, next) => {
  const principal = currentPrincipal();
  if (!['communication.view', 'message.broadcast'].some((p) => hasPermission(principal, p))) {
    throw new ForbiddenError('One of communication.view, message.broadcast is required');
  }
  next();
};

communicationRouter.get('/providers', view, async (req, res) => {
  res.json(await providersService.list(parseInput(listProvidersQuerySchema, req.query)));
});
communicationRouter.get('/providers/:id', view, async (req, res) => {
  res.json({ data: await providersService.get(idOf(req)) });
});
communicationRouter.post('/providers', manage, async (req, res) => {
  const input = parseInput(createCommunicationProviderSchema, req.body);
  res.status(201).json({ data: await providersService.create(input) });
});
communicationRouter.patch('/providers/:id', manage, async (req, res) => {
  const input = parseInput(updateCommunicationProviderSchema, req.body);
  res.json({ data: await providersService.update(idOf(req), input) });
});
communicationRouter.post('/providers/:id/test', manage, async (req, res) => {
  const { to } = parseInput(testCommunicationProviderSchema, req.body);
  res.json({ data: await providersService.test(idOf(req), to) });
});
communicationRouter.post('/providers/:id/rotate-webhook-secret', manage, async (req, res) => {
  res.json({ data: await providersService.rotateWebhookSecret(idOf(req)) });
});
communicationRouter.delete('/providers/:id', manage, async (req, res) => {
  await providersService.remove(idOf(req));
  res.status(204).end();
});

communicationRouter.get('/templates', view, async (req, res) => {
  res.json(await templatesService.list(parseInput(listTemplatesQuerySchema, req.query)));
});
communicationRouter.post('/templates/preview', view, async (req, res) => {
  const input = parseInput(previewByKeySchema, req.body);
  res.json({
    data: await templatesService.previewByKey(
      input.key,
      input.channel,
      input.variables,
      input.institutionId,
    ),
  });
});
communicationRouter.get('/templates/:id', view, async (req, res) => {
  res.json({ data: await templatesService.get(idOf(req)) });
});
communicationRouter.get('/templates/:id/versions', view, async (req, res) => {
  res.json({ data: await templatesService.versions(idOf(req)) });
});
communicationRouter.post('/templates', manage, async (req, res) => {
  const input = parseInput(createMessageTemplateSchema, req.body);
  res.status(201).json({ data: await templatesService.create(input) });
});
communicationRouter.post('/templates/:id/versions', manage, async (req, res) => {
  const input = parseInput(reviseMessageTemplateSchema, req.body);
  res.status(201).json({ data: await templatesService.revise(idOf(req), input) });
});
communicationRouter.post('/templates/:id/active', manage, async (req, res) => {
  const { isActive } = parseInput(activeSchema, req.body);
  res.json({ data: await templatesService.setActive(idOf(req), isActive) });
});
communicationRouter.post('/templates/:id/preview', view, async (req, res) => {
  const { variables } = parseInput(previewMessageTemplateSchema, req.body ?? {});
  res.json({ data: await templatesService.preview(idOf(req), variables) });
});
communicationRouter.delete('/templates/:id', manage, async (req, res) => {
  await templatesService.remove(idOf(req));
  res.status(204).end();
});

// Authorization (message.send at the institution) happens in the service.
communicationRouter.post('/messages', async (req, res) => {
  const input = parseInput(sendMessageSchema, req.body);
  res.status(202).json({ data: await messagesService.send(input) });
});
communicationRouter.get('/messages', view, async (req, res) => {
  res.json(await messagesService.list(parseInput(listMessageLogsQuerySchema, req.query)));
});
communicationRouter.get('/messages/:id', view, async (req, res) => {
  res.json({ data: await messagesService.get(idOf(req)) });
});

// Announcements: audience resolved server-side inside the caller's scope (see audience.ts).
communicationRouter.post('/audience/preview', broadcast, async (req, res) => {
  const input = parseInput(previewAudienceSchema, req.body);
  res.json({ data: await broadcastsService.preview(input) });
});
communicationRouter.post('/broadcasts', broadcast, async (req, res) => {
  const input = parseInput(createBroadcastSchema, req.body);
  res.status(201).json({ data: await broadcastsService.create(input) });
});

communicationRouter.get('/campaigns', viewCampaigns, async (req, res) => {
  res.json(await campaignsService.list(parseInput(listCampaignsQuerySchema, req.query)));
});
communicationRouter.post('/campaigns', async (req, res) => {
  const input = parseInput(createCampaignSchema, req.body);
  res.status(201).json({ data: await campaignsService.create(input) });
});
communicationRouter.get('/campaigns/:id', viewCampaigns, async (req, res) => {
  res.json({ data: await campaignsService.get(idOf(req)) });
});
communicationRouter.post('/campaigns/:id/cancel', async (req, res) => {
  res.json({ data: await campaignsService.cancel(idOf(req)) });
});

/**
 * PUBLIC: provider delivery callbacks (`POST /api/v1/communication/webhooks/:id`). Mounted
 * before authentication; the signature (provider-native or X-Erp-Signature) is the credential.
 */
export const communicationCallbackRouter = Router();

communicationCallbackRouter.post('/:id', async (req, res) => {
  const id = idOf(req);
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
  const result = await handleDeliveryCallback(id, {
    rawBody,
    body: req.body,
    headers: req.headers,
    url: `${env.API_PUBLIC_URL}/api/v1/communication/webhooks/${id}`,
  });
  res.json({ data: result });
});

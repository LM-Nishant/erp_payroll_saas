import {
  clientCredentialsTokenSchema,
  createApiClientSchema,
  createIntegrationCredentialSchema,
  createWebhookSchema,
  idParamSchema,
  listApiUsageQuerySchema,
  listWebhookDeliveriesQuerySchema,
  paginationQuerySchema,
  updateApiClientSchema,
  updateIntegrationCredentialSchema,
  updateWebhookSchema,
} from '@erp/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../core/authz';
import { listEventTypes } from '../../core/events';
import { parseInput } from '../../core/http/validation';
import {
  apiClientsService,
  integrationCredentialsService,
  issueClientToken,
  webhooksService,
} from '../../core/integrations';

/**
 * /api/v1/integrations — API clients (machine credentials), outbound webhooks, third-party
 * integration credentials and the domain-event catalog. API clients can never manage these
 * (integration.* is not grantable to API clients).
 */
export const integrationsRouter = Router();

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const deliveryParams = z.object({ id: z.string().uuid(), deliveryId: z.string().uuid() });
const view = requirePermission('integration.view');
const manage = requirePermission('integration.manage');

integrationsRouter.get('/events', view, (_req, res) => {
  res.json({ data: listEventTypes() });
});

integrationsRouter.get('/api-clients', view, async (req, res) => {
  res.json(await apiClientsService.list(parseInput(paginationQuerySchema.strict(), req.query)));
});
integrationsRouter.get('/api-clients/:id', view, async (req, res) => {
  res.json({ data: await apiClientsService.get(idOf(req)) });
});
integrationsRouter.get('/api-clients/:id/usage', view, async (req, res) => {
  res.json(
    await apiClientsService.usage(idOf(req), parseInput(listApiUsageQuerySchema, req.query)),
  );
});
integrationsRouter.post('/api-clients', manage, async (req, res) => {
  const input = parseInput(createApiClientSchema, req.body);
  res.status(201).json({ data: await apiClientsService.create(input) });
});
integrationsRouter.patch('/api-clients/:id', manage, async (req, res) => {
  const input = parseInput(updateApiClientSchema, req.body);
  res.json({ data: await apiClientsService.update(idOf(req), input) });
});
integrationsRouter.post('/api-clients/:id/rotate-secret', manage, async (req, res) => {
  res.json({ data: await apiClientsService.rotateSecret(idOf(req)) });
});
integrationsRouter.post('/api-clients/:id/revoke', manage, async (req, res) => {
  res.json({ data: await apiClientsService.revoke(idOf(req)) });
});

integrationsRouter.get('/webhooks', view, async (req, res) => {
  res.json(await webhooksService.list(parseInput(paginationQuerySchema.strict(), req.query)));
});
integrationsRouter.get('/webhooks/:id', view, async (req, res) => {
  res.json({ data: await webhooksService.get(idOf(req)) });
});
integrationsRouter.post('/webhooks', manage, async (req, res) => {
  const input = parseInput(createWebhookSchema, req.body);
  res.status(201).json({ data: await webhooksService.create(input) });
});
integrationsRouter.patch('/webhooks/:id', manage, async (req, res) => {
  const input = parseInput(updateWebhookSchema, req.body);
  res.json({ data: await webhooksService.update(idOf(req), input) });
});
integrationsRouter.post('/webhooks/:id/rotate-secret', manage, async (req, res) => {
  res.json({ data: await webhooksService.rotateSecret(idOf(req)) });
});
integrationsRouter.delete('/webhooks/:id', manage, async (req, res) => {
  await webhooksService.remove(idOf(req));
  res.status(204).end();
});
integrationsRouter.get('/webhooks/:id/deliveries', view, async (req, res) => {
  res.json(
    await webhooksService.deliveries(
      idOf(req),
      parseInput(listWebhookDeliveriesQuerySchema, req.query),
    ),
  );
});
integrationsRouter.post('/webhooks/:id/deliveries/:deliveryId/replay', manage, async (req, res) => {
  const { id, deliveryId } = parseInput(deliveryParams, req.params);
  res.status(202).json({ data: await webhooksService.replay(id, deliveryId) });
});

integrationsRouter.get('/credentials', view, async (req, res) => {
  res.json(
    await integrationCredentialsService.list(parseInput(paginationQuerySchema.strict(), req.query)),
  );
});
integrationsRouter.get('/credentials/:id', view, async (req, res) => {
  res.json({ data: await integrationCredentialsService.get(idOf(req)) });
});
integrationsRouter.post('/credentials', manage, async (req, res) => {
  const input = parseInput(createIntegrationCredentialSchema, req.body);
  res.status(201).json({ data: await integrationCredentialsService.create(input) });
});
integrationsRouter.patch('/credentials/:id', manage, async (req, res) => {
  const input = parseInput(updateIntegrationCredentialSchema, req.body);
  res.json({ data: await integrationCredentialsService.update(idOf(req), input) });
});
integrationsRouter.delete('/credentials/:id', manage, async (req, res) => {
  await integrationCredentialsService.remove(idOf(req));
  res.status(204).end();
});

/**
 * PUBLIC: OAuth2 client-credentials token endpoint (`POST /api/v1/oauth/token`). Accepts JSON
 * or form-encoded bodies and HTTP Basic client authentication. Mounted before authentication.
 */
export const oauthRouter = Router();

oauthRouter.post('/token', async (req, res) => {
  const input = parseInput(clientCredentialsTokenSchema, req.body ?? {});
  const token = await issueClientToken(input, req.headers.authorization);
  res.setHeader('Cache-Control', 'no-store');
  res.json(token);
});

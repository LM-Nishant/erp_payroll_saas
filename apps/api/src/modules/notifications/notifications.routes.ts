import {
  createNotificationRuleSchema,
  idParamSchema,
  listNotificationsQuerySchema,
  registerPushDeviceSchema,
  updateNotificationPreferencesSchema,
  updateNotificationRuleSchema,
} from '@erp/shared';
import { Router, type Request } from 'express';
import { requirePermission } from '../../core/authz';
import { parseInput } from '../../core/http/validation';
import { notificationRulesService, notificationsService } from '../../core/notifications';

/**
 * /api/v1/notifications — the signed-in user's in-app notifications, preferences and push
 * devices (always self-scoped), plus notification rules (notification.manage).
 */
export const notificationsRouter = Router();

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

notificationsRouter.get('/', async (req, res) => {
  res.json(await notificationsService.list(parseInput(listNotificationsQuerySchema, req.query)));
});
notificationsRouter.get('/unread-count', async (_req, res) => {
  res.json({ data: { count: await notificationsService.unreadCount() } });
});
notificationsRouter.post('/read-all', async (_req, res) => {
  res.json({ data: { updated: await notificationsService.markAllRead() } });
});
notificationsRouter.get('/preferences', async (_req, res) => {
  res.json({ data: await notificationsService.preferences() });
});
notificationsRouter.put('/preferences', async (req, res) => {
  const input = parseInput(updateNotificationPreferencesSchema, req.body);
  res.json({ data: await notificationsService.updatePreferences(input) });
});
notificationsRouter.get('/events', (_req, res) => {
  res.json({ data: notificationsService.events() });
});
notificationsRouter.post('/devices', async (req, res) => {
  const input = parseInput(registerPushDeviceSchema, req.body);
  res.status(201).json({ data: await notificationsService.registerDevice(input) });
});
notificationsRouter.delete('/devices/:id', async (req, res) => {
  await notificationsService.removeDevice(idOf(req));
  res.status(204).end();
});

notificationsRouter.get('/rules', requirePermission('notification.manage'), async (_req, res) => {
  res.json({ data: await notificationRulesService.list() });
});
notificationsRouter.post('/rules', requirePermission('notification.manage'), async (req, res) => {
  const input = parseInput(createNotificationRuleSchema, req.body);
  res.status(201).json({ data: await notificationRulesService.create(input) });
});
notificationsRouter.patch(
  '/rules/:id',
  requirePermission('notification.manage'),
  async (req, res) => {
    const input = parseInput(updateNotificationRuleSchema, req.body);
    res.json({ data: await notificationRulesService.update(idOf(req), input) });
  },
);
notificationsRouter.delete(
  '/rules/:id',
  requirePermission('notification.manage'),
  async (req, res) => {
    await notificationRulesService.remove(idOf(req));
    res.status(204).end();
  },
);

notificationsRouter.post('/:id/read', async (req, res) => {
  res.json({ data: await notificationsService.markRead(idOf(req)) });
});

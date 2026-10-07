import {
  createSecretSchema,
  idParamSchema,
  listSecretsQuerySchema,
  rotateSecretSchema,
  updateSecretSchema,
} from '@erp/shared';
import { Router } from 'express';
import { requirePermission } from '../../core/authz';
import { parseInput } from '../../core/http/validation';
import { secretsService } from '../../core/secrets';

/**
 * /api/v1/secrets — WRITE-ONLY secret management. Responses carry masked metadata only; the
 * plaintext value is never returned by any endpoint.
 */
export const secretsRouter = Router();

secretsRouter.get('/', requirePermission('secret.view'), async (req, res) => {
  res.json(await secretsService.list(parseInput(listSecretsQuerySchema, req.query)));
});

secretsRouter.get('/:id', requirePermission('secret.view'), async (req, res) => {
  res.json({ data: await secretsService.get(parseInput(idParamSchema, req.params).id) });
});

secretsRouter.post('/', requirePermission('secret.manage'), async (req, res) => {
  res
    .status(201)
    .json({ data: await secretsService.create(parseInput(createSecretSchema, req.body)) });
});

secretsRouter.post('/:id/rotate', requirePermission('secret.manage'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  const { value } = parseInput(rotateSecretSchema, req.body);
  res.json({ data: await secretsService.rotate(id, value) });
});

secretsRouter.patch('/:id', requirePermission('secret.manage'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  res.json({ data: await secretsService.update(id, parseInput(updateSecretSchema, req.body)) });
});

secretsRouter.delete('/:id', requirePermission('secret.manage'), async (req, res) => {
  await secretsService.remove(parseInput(idParamSchema, req.params).id);
  res.status(204).end();
});

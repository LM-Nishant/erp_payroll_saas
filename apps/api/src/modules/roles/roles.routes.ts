import {
  createRoleSchema,
  idParamSchema,
  paginationQuerySchema,
  updateRoleSchema,
} from '@erp/shared';
import { Router } from 'express';
import { listPermissions, requirePermission } from '../../core/authz';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { roleService } from './roles.service';

export const rolesRouter = Router();

rolesRouter.get('/', requirePermission('role.view'), async (req, res) => {
  const query = parseInput(paginationQuerySchema.strict(), req.query);
  const { items, total } = await roleService.list(query);
  res.json(toListResponse(items, total, query));
});

rolesRouter.get('/:id', requirePermission('role.view'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  res.json({ data: await roleService.get(id) });
});

rolesRouter.post('/', requirePermission('role.manage'), async (req, res) => {
  res.status(201).json({ data: await roleService.create(parseInput(createRoleSchema, req.body)) });
});

rolesRouter.patch('/:id', requirePermission('role.manage'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  res.json({ data: await roleService.update(id, parseInput(updateRoleSchema, req.body)) });
});

rolesRouter.delete('/:id', requirePermission('role.manage'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  await roleService.remove(id);
  res.status(204).end();
});

/** GET /api/v1/permissions — the permission catalog (for role editors). */
export const permissionsRouter = Router();

permissionsRouter.get('/', requirePermission('role.view'), async (_req, res) => {
  const data = await listPermissions();
  res.json({ data, meta: { total: data.length } });
});

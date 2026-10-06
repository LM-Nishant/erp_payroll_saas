import {
  createUserSchema,
  idParamSchema,
  listUsersQuerySchema,
  setUserRolesSchema,
  updateUserSchema,
} from '@erp/shared';
import { Router } from 'express';
import { requirePermission } from '../../core/authz';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { userService } from './users.service';

/** Tenant user management. Scope checks happen in userService. */
export const usersRouter = Router();

usersRouter.get('/', requirePermission('user.view'), async (req, res) => {
  const query = parseInput(listUsersQuerySchema, req.query);
  const { items, total } = await userService.list(query);
  res.json(toListResponse(items, total, query));
});

usersRouter.get('/:id', requirePermission('user.view'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  res.json({ data: await userService.get(id) });
});

usersRouter.post('/', requirePermission('user.create'), async (req, res) => {
  const input = parseInput(createUserSchema, req.body);
  res.status(201).json({ data: await userService.create(input) });
});

usersRouter.patch('/:id', requirePermission('user.update'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  const input = parseInput(updateUserSchema, req.body);
  res.json({ data: await userService.update(id, input) });
});

usersRouter.put('/:id/roles', requirePermission('user.role.assign'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  const { roles } = parseInput(setUserRolesSchema, req.body);
  res.json({ data: await userService.setRoles(id, roles) });
});

usersRouter.post('/:id/deactivate', requirePermission('user.deactivate'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  res.json({ data: await userService.setActive(id, false) });
});

usersRouter.post('/:id/reactivate', requirePermission('user.deactivate'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  res.json({ data: await userService.setActive(id, true) });
});

usersRouter.post(
  '/:id/password-reset',
  requirePermission('user.reset_password'),
  async (req, res) => {
    const { id } = parseInput(idParamSchema, req.params);
    res.status(201).json({ data: await userService.issuePasswordReset(id) });
  },
);

import {
  createCampusSchema,
  idParamSchema,
  listCampusesQuerySchema,
  updateCampusSchema,
} from '@erp/shared';
import { Router } from 'express';
import { requirePermission } from '../../core/authz';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { campusService } from './campuses.service';

export const campusesRouter = Router();

campusesRouter.get('/', requirePermission('campus.view'), async (req, res) => {
  const query = parseInput(listCampusesQuerySchema, req.query);
  const { items, total } = await campusService.list(query);
  res.json(toListResponse(items, total, query));
});

campusesRouter.get('/:id', requirePermission('campus.view'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  res.json({ data: await campusService.get(id) });
});

campusesRouter.post('/', requirePermission('campus.create'), async (req, res) => {
  const input = parseInput(createCampusSchema, req.body);
  res.status(201).json({ data: await campusService.create(input) });
});

campusesRouter.patch('/:id', requirePermission('campus.update'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  const input = parseInput(updateCampusSchema, req.body);
  res.json({ data: await campusService.update(id, input) });
});

campusesRouter.delete('/:id', requirePermission('campus.delete'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  await campusService.remove(id);
  res.status(204).end();
});

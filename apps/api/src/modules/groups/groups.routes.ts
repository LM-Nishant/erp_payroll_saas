import {
  createGroupSchema,
  idParamSchema,
  listGroupsQuerySchema,
  updateGroupSchema,
} from '@erp/shared';
import { Router } from 'express';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { groupService } from './groups.service';

export const groupsRouter = Router();

groupsRouter.get('/', async (req, res) => {
  const query = parseInput(listGroupsQuerySchema, req.query);
  const { items, total } = await groupService.list(query);
  res.json(toListResponse(items, total, query));
});

groupsRouter.get('/:id', async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  res.json({ data: await groupService.get(id) });
});

groupsRouter.post('/', async (req, res) => {
  const input = parseInput(createGroupSchema, req.body);
  res.status(201).json({ data: await groupService.create(input) });
});

groupsRouter.patch('/:id', async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  const input = parseInput(updateGroupSchema, req.body);
  res.json({ data: await groupService.update(id, input) });
});

groupsRouter.delete('/:id', async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  await groupService.remove(id);
  res.status(204).end();
});

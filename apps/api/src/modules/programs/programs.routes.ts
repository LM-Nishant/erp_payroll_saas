import {
  createProgramSchema,
  idParamSchema,
  listProgramsQuerySchema,
  updateProgramSchema,
} from '@erp/shared';
import { Router } from 'express';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { programService } from './programs.service';

export const programsRouter = Router();

programsRouter.get('/', async (req, res) => {
  const query = parseInput(listProgramsQuerySchema, req.query);
  const { items, total } = await programService.list(query);
  res.json(toListResponse(items, total, query));
});

programsRouter.get('/:id', async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  res.json({ data: await programService.get(id) });
});

programsRouter.post('/', async (req, res) => {
  const input = parseInput(createProgramSchema, req.body);
  res.status(201).json({ data: await programService.create(input) });
});

programsRouter.patch('/:id', async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  const input = parseInput(updateProgramSchema, req.body);
  res.json({ data: await programService.update(id, input) });
});

programsRouter.delete('/:id', async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  await programService.remove(id);
  res.status(204).end();
});

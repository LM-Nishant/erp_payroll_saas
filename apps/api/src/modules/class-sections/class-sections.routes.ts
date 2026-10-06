import {
  createClassSectionSchema,
  idParamSchema,
  listClassSectionsQuerySchema,
  updateClassSectionSchema,
} from '@erp/shared';
import { Router } from 'express';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { classSectionService } from './class-sections.service';

export const classSectionsRouter = Router();

classSectionsRouter.get('/', async (req, res) => {
  const query = parseInput(listClassSectionsQuerySchema, req.query);
  const { items, total } = await classSectionService.list(query);
  res.json(toListResponse(items, total, query));
});

classSectionsRouter.get('/:id', async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  res.json({ data: await classSectionService.get(id) });
});

classSectionsRouter.post('/', async (req, res) => {
  const input = parseInput(createClassSectionSchema, req.body);
  res.status(201).json({ data: await classSectionService.create(input) });
});

classSectionsRouter.patch('/:id', async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  const input = parseInput(updateClassSectionSchema, req.body);
  res.json({ data: await classSectionService.update(id, input) });
});

classSectionsRouter.delete('/:id', async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  await classSectionService.remove(id);
  res.status(204).end();
});

import {
  createInstitutionSchema,
  idParamSchema,
  listInstitutionsQuerySchema,
  updateInstitutionSchema,
} from '@erp/shared';
import { Router } from 'express';
import { requirePermission } from '../../core/authz';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { institutionService } from './institutions.service';

export const institutionsRouter = Router();

institutionsRouter.get('/', requirePermission('institution.view'), async (req, res) => {
  const query = parseInput(listInstitutionsQuerySchema, req.query);
  const { items, total } = await institutionService.list(query);
  res.json(toListResponse(items, total, query));
});

institutionsRouter.get('/:id', requirePermission('institution.view'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  res.json({ data: await institutionService.get(id) });
});

institutionsRouter.post('/', requirePermission('institution.create'), async (req, res) => {
  const input = parseInput(createInstitutionSchema, req.body);
  res.status(201).json({ data: await institutionService.create(input) });
});

institutionsRouter.patch('/:id', requirePermission('institution.update'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  const input = parseInput(updateInstitutionSchema, req.body);
  res.json({ data: await institutionService.update(id, input) });
});

institutionsRouter.delete('/:id', requirePermission('institution.delete'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  await institutionService.remove(id);
  res.status(204).end();
});

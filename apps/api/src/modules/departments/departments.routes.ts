import {
  createDepartmentSchema,
  idParamSchema,
  listDepartmentsQuerySchema,
  updateDepartmentSchema,
} from '@erp/shared';
import { Router } from 'express';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { departmentService } from './departments.service';

export const departmentsRouter = Router();

departmentsRouter.get('/', async (req, res) => {
  const query = parseInput(listDepartmentsQuerySchema, req.query);
  const { items, total } = await departmentService.list(query);
  res.json(toListResponse(items, total, query));
});

departmentsRouter.get('/:id', async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  res.json({ data: await departmentService.get(id) });
});

departmentsRouter.post('/', async (req, res) => {
  const input = parseInput(createDepartmentSchema, req.body);
  res.status(201).json({ data: await departmentService.create(input) });
});

departmentsRouter.patch('/:id', async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  const input = parseInput(updateDepartmentSchema, req.body);
  res.json({ data: await departmentService.update(id, input) });
});

departmentsRouter.delete('/:id', async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  await departmentService.remove(id);
  res.status(204).end();
});

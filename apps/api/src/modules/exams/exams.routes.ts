import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  computeResultsSchema,
  createExamTermSchema,
  createGradingScaleSchema,
  enterMarksSchema,
  idParamSchema,
  idSchema,
  listExamSchedulesQuerySchema,
  listExamTermsQuerySchema,
  listGradingScalesQuerySchema,
  listResultsQuerySchema,
  lockMarksSchema,
  ownResultsQuerySchema,
  updateExamTermSchema,
  upsertExamSchedulesSchema,
} from '@erp/shared';
import { requirePermission } from '../../core/authz';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { requireAnyPermission } from '../academics/academics.access';
import { renderReportCard } from './exams.report-card';
import { examTermService, gradingScaleService } from './exams.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const reportCardParams = z.object({ id: idSchema, studentId: idSchema }).strict();

const fileName = (title: string) =>
  `${title
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120)}.pdf`;

async function sendReportCard(req: Request, res: Response) {
  const p = parseInput(reportCardParams, req.params);
  const pdf = await renderReportCard(p.id, p.studentId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName(pdf.title)}"`);
  res.send(pdf.body);
}

export const examsRouter = Router();

/* ---- self-service ---- */
examsRouter.get('/my-results', requirePermission('exam.view_own'), async (req, res) => {
  const q = parseInput(ownResultsQuerySchema, req.query);
  res.json({ data: await examTermService.own(q.studentId) });
});
examsRouter.get(
  '/my-results/:id/report-card/:studentId',
  requirePermission('exam.view_own'),
  sendReportCard,
);

/* ---- grading scales ---- */
examsRouter.get('/grading-scales', requirePermission('exam.view'), async (req, res) => {
  const q = parseInput(listGradingScalesQuerySchema, req.query);
  res.json({ data: await gradingScaleService.list(q.institutionId) });
});
examsRouter.post('/grading-scales', requirePermission('exam.manage'), async (req, res) => {
  res.status(201).json({
    data: await gradingScaleService.create(parseInput(createGradingScaleSchema, req.body)),
  });
});
examsRouter.delete('/grading-scales/:id', requirePermission('exam.manage'), async (req, res) => {
  await gradingScaleService.remove(idOf(req));
  res.status(204).end();
});

/* ---- papers (schedules) & marks ---- */
examsRouter.delete('/schedules/:id', requirePermission('exam.manage'), async (req, res) => {
  await examTermService.removeSchedule(idOf(req));
  res.status(204).end();
});
examsRouter.get(
  '/schedules/:id/marks',
  requireAnyPermission(['exam.view', 'exam.marks_entry']),
  async (req, res) => {
    res.json({ data: await examTermService.marksSheet(idOf(req)) });
  },
);
examsRouter.put('/schedules/:id/marks', requirePermission('exam.marks_entry'), async (req, res) => {
  res.json({
    data: await examTermService.enterMarks(idOf(req), parseInput(enterMarksSchema, req.body)),
  });
});
examsRouter.post(
  '/schedules/:id/lock',
  requireAnyPermission(['exam.marks_entry', 'exam.publish']),
  async (req, res) => {
    const { locked } = parseInput(lockMarksSchema, req.body);
    res.json({ data: await examTermService.lockMarks(idOf(req), locked) });
  },
);

/* ---- terms ---- */
examsRouter.get(
  '/terms',
  requireAnyPermission(['exam.view', 'exam.marks_entry']),
  async (req, res) => {
    const query = parseInput(listExamTermsQuerySchema, req.query);
    const { items, total } = await examTermService.list(query);
    res.json(toListResponse(items, total, query));
  },
);
examsRouter.post('/terms', requirePermission('exam.manage'), async (req, res) => {
  res
    .status(201)
    .json({ data: await examTermService.create(parseInput(createExamTermSchema, req.body)) });
});
examsRouter.get('/terms/:id', requirePermission('exam.view'), async (req, res) => {
  res.json({ data: await examTermService.get(idOf(req)) });
});
examsRouter.patch('/terms/:id', requirePermission('exam.manage'), async (req, res) => {
  res.json({
    data: await examTermService.update(idOf(req), parseInput(updateExamTermSchema, req.body)),
  });
});
examsRouter.delete('/terms/:id', requirePermission('exam.manage'), async (req, res) => {
  await examTermService.remove(idOf(req));
  res.status(204).end();
});
examsRouter.get(
  '/terms/:id/schedules',
  requireAnyPermission(['exam.view', 'exam.marks_entry']),
  async (req, res) => {
    res.json({
      data: await examTermService.schedules(
        idOf(req),
        parseInput(listExamSchedulesQuerySchema, req.query),
      ),
    });
  },
);
examsRouter.put('/terms/:id/schedules', requirePermission('exam.manage'), async (req, res) => {
  res.json({
    data: await examTermService.upsertSchedules(
      idOf(req),
      parseInput(upsertExamSchedulesSchema, req.body),
    ),
  });
});
examsRouter.post('/terms/:id/compute', requirePermission('exam.manage'), async (req, res) => {
  const body = parseInput(computeResultsSchema, req.body ?? {});
  res.json({ data: await examTermService.computeResults(idOf(req), body.classSectionId) });
});
examsRouter.post('/terms/:id/publish', requirePermission('exam.publish'), async (req, res) => {
  res.json({ data: await examTermService.publish(idOf(req)) });
});
examsRouter.get('/terms/:id/results', requirePermission('exam.view'), async (req, res) => {
  const q = parseInput(listResultsQuerySchema, req.query);
  res.json({ data: await examTermService.results(idOf(req), q.classSectionId) });
});
examsRouter.get(
  '/terms/:id/report-card/:studentId',
  requirePermission('exam.view'),
  sendReportCard,
);

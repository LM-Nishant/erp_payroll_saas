import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  createLibraryBookSchema,
  createLibraryCopiesSchema,
  createLibraryReservationSchema,
  createStockVerificationSchema,
  idParamSchema,
  issueLibraryCopySchema,
  libraryInstitutionQuerySchema,
  libraryLabelsSchema,
  libraryReportKeySchema,
  libraryReportQuerySchema,
  listLibraryBooksQuerySchema,
  listLibraryCopiesQuerySchema,
  listLibraryFinesQuerySchema,
  listLibraryLoansQuerySchema,
  listLibraryMembersQuerySchema,
  listLibraryReservationsQuerySchema,
  opacSearchQuerySchema,
  renewLibraryLoanSchema,
  reserveOwnSchema,
  returnLibraryCopySchema,
  scanStockVerificationSchema,
  collectLibraryFineSchema,
  settleLibraryFineSchema,
  updateLibraryBookSchema,
  updateLibraryCopySchema,
  upsertLibraryPolicySchema,
} from '@erp/shared';
import { currentPrincipal, hasPermission, requirePermission } from '../../core/authz';
import { ForbiddenError } from '../../core/http/errors';
import { parseMultipartFile } from '../../core/http/multipart';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { catalogueService } from './library.catalogue';
import { circulationService } from './library.circulation';
import {
  buildReport,
  dashboard,
  exportReport,
  importBooks,
  labelsPdf,
  stockService,
} from './library.reports';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const instOf = (req: Request) => parseInput(libraryInstitutionQuerySchema, req.query).institutionId;

/** Staff (library.view) or self-service members (library.view_own). */
const requireAny =
  (...perms: string[]): RequestHandler =>
  (_req, _res, next) => {
    const principal = currentPrincipal();
    if (!perms.some((p) => hasPermission(principal, p)))
      throw new ForbiddenError(`Missing permission ${perms.join(' or ')}`);
    next();
  };

export const libraryRouter = Router();

/* ---- self-service & OPAC (before parameterised routes) ---- */

libraryRouter.get('/me', requirePermission('library.view_own'), async (_req, res) => {
  res.json({ data: await circulationService.me() });
});
libraryRouter.post('/me/reservations', requirePermission('library.view_own'), async (req, res) => {
  res
    .status(201)
    .json({ data: await circulationService.reserveOwn(parseInput(reserveOwnSchema, req.body)) });
});
libraryRouter.delete(
  '/me/reservations/:id',
  requirePermission('library.view_own'),
  async (req, res) => {
    await circulationService.cancelOwnReservation(idOf(req));
    res.status(204).end();
  },
);
libraryRouter.post(
  '/me/loans/:id/renew',
  requirePermission('library.view_own'),
  async (req, res) => {
    res.json({ data: await circulationService.renewOwn(idOf(req)) });
  },
);
libraryRouter.get('/opac', requireAny('library.view', 'library.view_own'), async (req, res) => {
  const query = parseInput(opacSearchQuerySchema, req.query);
  const { items, total } = await catalogueService.opac(query);
  res.json(toListResponse(items, total, query));
});
libraryRouter.get(
  '/books/:id/cover',
  requireAny('library.view', 'library.view_own'),
  async (req, res) => {
    const cover = await catalogueService.cover(idOf(req));
    res.setHeader('Content-Type', cover.contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(cover.body);
  },
);

/* ---- dashboard / catalogue ---- */

libraryRouter.get('/dashboard', requirePermission('library.view'), async (req, res) => {
  res.json({ data: await dashboard(instOf(req)) });
});
libraryRouter.get('/categories', requirePermission('library.view'), async (req, res) => {
  res.json({ data: await catalogueService.categories(instOf(req)) });
});
libraryRouter.get('/books', requirePermission('library.view'), async (req, res) => {
  const query = parseInput(listLibraryBooksQuerySchema, req.query);
  const { items, total } = await catalogueService.listBooks(query);
  res.json(toListResponse(items, total, query));
});
libraryRouter.post('/books', requirePermission('library.manage'), async (req, res) => {
  res.status(201).json({
    data: await catalogueService.createBook(parseInput(createLibraryBookSchema, req.body)),
  });
});
libraryRouter.post('/books/import', requirePermission('library.manage'), async (req, res) => {
  const { file, fields } = await parseMultipartFile(req, { maxBytes: 5 * 1024 * 1024 });
  const { institutionId } = parseInput(
    z.object({ institutionId: z.string().uuid() }).passthrough(),
    fields,
  );
  res.json({ data: await importBooks(institutionId, file) });
});
libraryRouter.get('/books/:id', requirePermission('library.view'), async (req, res) => {
  res.json({ data: await catalogueService.getBook(idOf(req)) });
});
libraryRouter.patch('/books/:id', requirePermission('library.manage'), async (req, res) => {
  res.json({
    data: await catalogueService.updateBook(
      idOf(req),
      parseInput(updateLibraryBookSchema, req.body),
    ),
  });
});
libraryRouter.delete('/books/:id', requirePermission('library.manage'), async (req, res) => {
  await catalogueService.removeBook(idOf(req));
  res.status(204).end();
});
libraryRouter.post('/books/:id/cover', requirePermission('library.manage'), async (req, res) => {
  const { file } = await parseMultipartFile(req, { maxBytes: 3 * 1024 * 1024 });
  res.json({ data: await catalogueService.uploadCover(idOf(req), file) });
});

/* ---- copies ---- */

libraryRouter.get('/copies', requirePermission('library.view'), async (req, res) => {
  const query = parseInput(listLibraryCopiesQuerySchema, req.query);
  const { items, total } = await catalogueService.listCopies(query);
  res.json(toListResponse(items, total, query));
});
libraryRouter.get(
  '/copies/by-barcode/:barcode',
  requirePermission('library.view'),
  async (req, res) => {
    const { barcode } = parseInput(z.object({ barcode: z.string().min(1).max(64) }), req.params);
    res.json({ data: await catalogueService.copyByBarcode(barcode) });
  },
);
libraryRouter.post('/copies', requirePermission('library.manage'), async (req, res) => {
  res.status(201).json({
    data: await catalogueService.addCopies(parseInput(createLibraryCopiesSchema, req.body)),
  });
});
libraryRouter.post('/labels', requirePermission('library.view'), async (req, res) => {
  const file = await labelsPdf(parseInput(libraryLabelsSchema, req.body));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  res.send(file.body);
});
libraryRouter.patch('/copies/:id', requirePermission('library.manage'), async (req, res) => {
  res.json({
    data: await catalogueService.updateCopy(
      idOf(req),
      parseInput(updateLibraryCopySchema, req.body),
    ),
  });
});
libraryRouter.delete('/copies/:id', requirePermission('library.manage'), async (req, res) => {
  await catalogueService.removeCopy(idOf(req));
  res.status(204).end();
});

/* ---- policies ---- */

libraryRouter.get('/policies', requirePermission('library.view'), async (req, res) => {
  res.json({ data: await catalogueService.listPolicies(instOf(req)) });
});
libraryRouter.put('/policies', requirePermission('library.manage'), async (req, res) => {
  res.json({
    data: await catalogueService.upsertPolicy(parseInput(upsertLibraryPolicySchema, req.body)),
  });
});

/* ---- circulation ---- */

libraryRouter.post('/issue', requirePermission('library.circulate'), async (req, res) => {
  res
    .status(201)
    .json({ data: await circulationService.issue(parseInput(issueLibraryCopySchema, req.body)) });
});
libraryRouter.post('/return', requirePermission('library.circulate'), async (req, res) => {
  res.json({
    data: await circulationService.return(parseInput(returnLibraryCopySchema, req.body)),
  });
});
libraryRouter.get('/loans', requirePermission('library.view'), async (req, res) => {
  const query = parseInput(listLibraryLoansQuerySchema, req.query);
  const { items, total } = await circulationService.listLoans(query);
  res.json(toListResponse(items, total, query));
});
libraryRouter.post('/loans/:id/renew', requirePermission('library.circulate'), async (req, res) => {
  res.json({
    data: await circulationService.renew(
      idOf(req),
      parseInput(renewLibraryLoanSchema, req.body ?? {}),
    ),
  });
});

libraryRouter.get('/reservations', requirePermission('library.view'), async (req, res) => {
  const query = parseInput(listLibraryReservationsQuerySchema, req.query);
  const { items, total } = await circulationService.listReservations(query);
  res.json(toListResponse(items, total, query));
});
libraryRouter.post('/reservations', requirePermission('library.circulate'), async (req, res) => {
  res.status(201).json({
    data: await circulationService.reserve(parseInput(createLibraryReservationSchema, req.body)),
  });
});
libraryRouter.delete(
  '/reservations/:id',
  requirePermission('library.circulate'),
  async (req, res) => {
    await circulationService.cancelReservation(idOf(req));
    res.status(204).end();
  },
);

/* ---- fines ---- */

libraryRouter.get('/fines', requirePermission('library.view'), async (req, res) => {
  const query = parseInput(listLibraryFinesQuerySchema, req.query);
  const { items, total, pendingAmount } = await circulationService.listFines(query);
  res.json({ ...toListResponse(items, total, query), summary: { pendingAmount } });
});
libraryRouter.post('/fines/:id/collect', requirePermission('library.fine'), async (req, res) => {
  res.json({
    data: await circulationService.settleFine(
      idOf(req),
      'COLLECTED',
      parseInput(collectLibraryFineSchema, req.body ?? {}),
    ),
  });
});
libraryRouter.post('/fines/:id/waive', requirePermission('library.fine'), async (req, res) => {
  res.json({
    data: await circulationService.settleFine(
      idOf(req),
      'WAIVED',
      parseInput(settleLibraryFineSchema, req.body ?? {}),
    ),
  });
});

/* ---- members ---- */

libraryRouter.get('/members', requirePermission('library.view'), async (req, res) => {
  const query = parseInput(listLibraryMembersQuerySchema, req.query);
  const { items, total } = await circulationService.listMembers(query);
  res.json(toListResponse(items, total, query));
});
libraryRouter.get('/members/:type/:id', requirePermission('library.view'), async (req, res) => {
  const { type, id } = parseInput(
    z.object({ type: z.enum(['student', 'employee']), id: z.string().uuid() }),
    req.params,
  );
  res.json({
    data: await circulationService.member(type === 'student' ? 'STUDENT' : 'EMPLOYEE', id),
  });
});

/* ---- reports / stock verification ---- */

libraryRouter.get('/reports/:key', requirePermission('library.view'), async (req, res) => {
  const key = parseInput(z.object({ key: libraryReportKeySchema }), req.params).key;
  const query = parseInput(libraryReportQuerySchema, req.query);
  const report = await buildReport(key, query);
  if (query.format === 'json') {
    res.json({ data: report });
    return;
  }
  const file = await exportReport(report, query.format);
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  res.send(file.body);
});

libraryRouter.get('/stock-verifications', requirePermission('library.view'), async (req, res) => {
  res.json({ data: await stockService.list(instOf(req)) });
});
libraryRouter.post(
  '/stock-verifications',
  requirePermission('library.manage'),
  async (req, res) => {
    res.status(201).json({
      data: await stockService.create(parseInput(createStockVerificationSchema, req.body)),
    });
  },
);
libraryRouter.get(
  '/stock-verifications/:id',
  requirePermission('library.view'),
  async (req, res) => {
    res.json({ data: await stockService.get(idOf(req)) });
  },
);
libraryRouter.post(
  '/stock-verifications/:id/scan',
  requirePermission('library.manage'),
  async (req, res) => {
    res.json({
      data: await stockService.scan(idOf(req), parseInput(scanStockVerificationSchema, req.body)),
    });
  },
);
libraryRouter.post(
  '/stock-verifications/:id/complete',
  requirePermission('library.manage'),
  async (req, res) => {
    res.json({ data: await stockService.complete(idOf(req)) });
  },
);

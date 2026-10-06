import { Router } from 'express';

export type ReadinessCheck = () => Promise<void>;

export function healthRouter(readinessCheck: ReadinessCheck): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  router.get('/ready', async (req, res) => {
    try {
      await readinessCheck();
      res.json({ status: 'ready', checks: { database: 'ok' } });
    } catch (err) {
      req.log?.warn({ err }, 'readiness check failed');
      res.status(503).json({ status: 'unavailable', checks: { database: 'error' } });
    }
  });

  return router;
}

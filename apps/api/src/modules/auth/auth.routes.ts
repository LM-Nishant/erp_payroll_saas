import {
  acceptInviteSchema,
  changePasswordSchema,
  idParamSchema,
  loginSchema,
  logoutSchema,
  mfaCodeSchema,
  mfaDisableSchema,
  mfaVerifySchema,
  refreshSchema,
  resetPasswordSchema,
  type LoginResult,
  type TokenDelivery,
} from '@erp/shared';
import { Router, type RequestHandler, type Response } from 'express';
import {
  acceptInvite,
  activateMfa,
  authenticate,
  changePassword,
  clearRefreshCookie,
  disableMfa,
  listActiveSessions,
  listLoginEvents,
  login,
  readCookie,
  REFRESH_COOKIE,
  regenerateRecoveryCodes,
  resetPasswordWithToken,
  revokeByRefreshToken,
  revokeSession,
  rotateRefreshToken,
  setRefreshCookie,
  startMfaEnrollment,
  verifyMfaLogin,
  type IssuedTokens,
  type LoginOutcome,
} from '../../core/auth';
import { NotFoundError, UnauthenticatedError } from '../../core/http/errors';
import { parseInput } from '../../core/http/validation';

export interface AuthRouterOptions {
  /** Rate limiter applied (per client IP) to each public credential endpoint. */
  limit: (name: string) => RequestHandler;
}

function tokenResponse(res: Response, tokens: IssuedTokens, delivery: TokenDelivery): LoginResult {
  const body: LoginResult = {
    mfaRequired: false,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
  };
  if (tokens.refreshToken && tokens.refreshTokenExpiresAt) {
    body.refreshTokenExpiresAt = tokens.refreshTokenExpiresAt.toISOString();
    if (delivery === 'cookie') {
      setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
    } else {
      body.refreshToken = tokens.refreshToken;
    }
  }
  return body;
}

function outcomeResponse(res: Response, outcome: LoginOutcome): LoginResult {
  return outcome.mfaRequired
    ? { mfaRequired: true, mfaToken: outcome.mfaToken }
    : tokenResponse(res, outcome.tokens, outcome.tokenDelivery);
}

const auth = (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth) throw new UnauthenticatedError();
  return req.auth;
};

/**
 * /api/v1/auth — credential endpoints (public, rate-limited) and self-service session/MFA
 * management (authenticated; works with or without a tenant).
 */
export function authRouter(options: AuthRouterOptions): Router {
  const router = Router();

  router.post('/login', options.limit('login'), async (req, res) => {
    const input = parseInput(loginSchema, req.body);
    res.json({ data: outcomeResponse(res, await login(input)) });
  });

  router.post('/mfa/verify', options.limit('mfa-verify'), async (req, res) => {
    const input = parseInput(mfaVerifySchema, req.body);
    res.json({ data: outcomeResponse(res, await verifyMfaLogin(input)) });
  });

  router.post('/refresh', options.limit('refresh'), async (req, res) => {
    const input = parseInput(refreshSchema, req.body ?? {});
    const fromCookie = readCookie(req, REFRESH_COOKIE);
    const raw = input.refreshToken ?? fromCookie;
    if (!raw) throw new UnauthenticatedError('Refresh token required', 'REFRESH_TOKEN_INVALID');
    try {
      const { tokens } = await rotateRefreshToken(raw);
      const delivery: TokenDelivery = input.refreshToken ? input.tokenDelivery : 'cookie';
      res.json({ data: tokenResponse(res, tokens, delivery) });
    } catch (err) {
      if (!input.refreshToken && fromCookie) clearRefreshCookie(res);
      throw err;
    }
  });

  router.post('/accept-invite', options.limit('accept-invite'), async (req, res) => {
    const input = parseInput(acceptInviteSchema, req.body);
    await acceptInvite(input.token, input.password, input.name);
    res.status(204).end();
  });

  router.post('/password/reset', options.limit('password-reset'), async (req, res) => {
    const input = parseInput(resetPasswordSchema, req.body);
    await resetPasswordWithToken(input.token, input.newPassword);
    res.status(204).end();
  });

  // Logout works with the refresh token alone (cookie or body) so expired access tokens can
  // still end the session.
  router.post('/logout', authenticate({ optional: true }), async (req, res) => {
    const input = parseInput(logoutSchema, req.body ?? {});
    const raw = input.refreshToken ?? readCookie(req, REFRESH_COOKIE);
    if (req.auth) await revokeSession(req.auth.sessionId, 'logout');
    else if (raw) await revokeByRefreshToken(raw, 'logout');
    else throw new UnauthenticatedError();
    clearRefreshCookie(res);
    res.status(204).end();
  });

  const authed = Router();
  authed.use(authenticate());

  authed.post('/password/change', async (req, res) => {
    const input = parseInput(changePasswordSchema, req.body);
    const { userId, sessionId } = auth(req);
    await changePassword(userId, sessionId, input.currentPassword, input.newPassword);
    res.status(204).end();
  });

  authed.get('/sessions', async (req, res) => {
    const { userId, sessionId } = auth(req);
    const sessions = await listActiveSessions(userId);
    res.json({ data: sessions.map((s) => ({ ...s, current: s.id === sessionId })) });
  });

  authed.delete('/sessions/:id', async (req, res) => {
    const { id } = parseInput(idParamSchema, req.params);
    const { userId } = auth(req);
    const sessions = await listActiveSessions(userId);
    if (!sessions.some((s) => s.id === id)) throw new NotFoundError('Session');
    await revokeSession(id, 'user_revoked');
    res.status(204).end();
  });

  authed.get('/login-history', async (req, res) => {
    res.json({ data: await listLoginEvents(auth(req).userId) });
  });

  authed.post('/mfa/enroll', async (req, res) => {
    res.json({ data: await startMfaEnrollment(auth(req).userId) });
  });

  authed.post('/mfa/activate', async (req, res) => {
    const { code } = parseInput(mfaCodeSchema, req.body);
    res.json({ data: await activateMfa(auth(req).userId, code) });
  });

  authed.post('/mfa/disable', async (req, res) => {
    const input = parseInput(mfaDisableSchema, req.body);
    await disableMfa(auth(req).userId, input.password, input.code);
    res.status(204).end();
  });

  authed.post('/mfa/recovery-codes', async (req, res) => {
    const { code } = parseInput(mfaCodeSchema, req.body);
    res.json({ data: await regenerateRecoveryCodes(auth(req).userId, code) });
  });

  router.use(authed);
  return router;
}

import { test } from '@playwright/test';
import { AppSession } from './app';
import { registerResultShot } from './guide-steps';
import { user } from './manifest';

/**
 * Signs `email` in once for the enclosing (serial) describe block and returns a getter for the
 * shared session — one login per role keeps the suite under the auth rate limit.
 */
export function signedIn(email: string): () => AppSession {
  let s: AppSession | undefined;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    s = await AppSession.open(browser);
    await s.signIn(user(email));
  });
  registerResultShot(() => s?.page);
  test.afterAll(async () => {
    await s?.close();
  });
  return () => {
    if (!s) throw new Error(`session for ${email} not open`);
    return s;
  };
}

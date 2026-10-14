import { expect, type Browser, type Page, type Response } from '@playwright/test';
import { guideUser, installStepCapture, logNav } from './guide-steps';
import { PASSWORD, type DemoUser } from './manifest';

export interface ApiCall {
  method: string;
  path: string;
  status: number;
  code?: string;
  message?: string;
}

/**
 * A signed-in browser page plus a recorder of every /api/ response, so tests can assert both what
 * the UI shows and what the API answered (e.g. 403 FEATURE_DISABLED surfaced as an error alert).
 */
export class AppSession {
  readonly calls: ApiCall[] = [];
  private inflight = 0;
  private lastActivity = Date.now();
  private pending: Array<Promise<void>> = [];

  constructor(readonly page: Page) {
    page.on('request', (req) => {
      if (isApi(req.url())) {
        this.inflight++;
        this.lastActivity = Date.now();
      }
    });
    const done = (url: string) => {
      if (isApi(url)) {
        this.inflight = Math.max(0, this.inflight - 1);
        this.lastActivity = Date.now();
      }
    };
    page.on('requestfinished', (req) => done(req.url()));
    page.on('requestfailed', (req) => done(req.url()));
    page.on('response', (res) => {
      if (isApi(res.url())) this.pending.push(this.record(res));
    });
  }

  static async open(browser: Browser): Promise<AppSession> {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    installStepCapture(page);
    return new AppSession(page);
  }

  async close() {
    await this.page.context().close();
  }

  private async record(res: Response) {
    const url = new URL(res.url());
    const call: ApiCall = {
      method: res.request().method(),
      path: url.pathname + url.search,
      status: res.status(),
    };
    this.calls.push(call);
    if (res.status() >= 400) {
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        call.code = body.error?.code;
        call.message = body.error?.message;
      } catch {
        /* non-JSON error body */
      }
    }
  }

  /** Marks the current position of the API log; pass it to `failedSince`. */
  mark(): number {
    return this.calls.length;
  }

  async failedSince(mark: number, ignore: (c: ApiCall) => boolean = () => false) {
    await Promise.all(this.pending);
    return this.calls.slice(mark).filter((c) => c.status >= 400 && !ignore(c));
  }

  /** Waits until no /api/ request has been in flight for `quietMs` (max `timeoutMs`). */
  async settle(quietMs = 500, timeoutMs = 20_000) {
    const start = Date.now();
    // Let the router resolve lazy components and fire the first requests.
    await this.page.waitForTimeout(150);
    while (Date.now() - start < timeoutMs) {
      if (this.inflight === 0 && Date.now() - this.lastActivity >= quietMs) break;
      await this.page.waitForTimeout(100);
    }
    await Promise.all(this.pending);
  }

  /** Signs in through the login form (retrying when the auth rate limit answers 429). */
  async login(u: Pick<DemoUser, 'email'> & { org?: string | null }, password = PASSWORD) {
    const { page } = this;
    await page.goto('/login');
    await expect(page.getByText('Sign in', { exact: true })).toBeVisible();
    for (let attempt = 0; ; attempt++) {
      await page.getByLabel('Email').fill(u.email);
      await page.getByLabel('Password').fill(password);
      const response = page.waitForResponse(
        (r) => r.url().includes('/api/v1/auth/login') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Continue' }).click();
      const res = await response;
      if (res.status() === 429 && attempt < 10) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { details?: { retryAfterSeconds?: number } };
        };
        const wait = Number(
          body.error?.details?.retryAfterSeconds ?? res.headers()['retry-after'] ?? 10,
        );
        await page.waitForTimeout(Math.max(1, wait) * 1000 + 500);
        continue;
      }
      // The dev proxy answers 5xx while the API (tsx watch) restarts: wait and try again.
      if (res.status() >= 500 && attempt < 10) {
        await page.waitForTimeout(3000);
        continue;
      }
      return res;
    }
  }

  /** Logs in and waits for the workspace chooser (home page). */
  async signIn(u: DemoUser) {
    guideUser(this.page, u.email);
    const res = await this.login(u);
    expect(res.status(), `login ${u.email}`).toBe(200);
    await expect(this.page.getByText(`Signed in as ${u.name}`)).toBeVisible();
    await expect(this.page).toHaveURL(/\/$/);
  }

  /**
   * In-app navigation through the real vue-router (guards included) without a full page load —
   * a reload would spend an /auth/refresh call, which is rate limited.
   */
  async go(path: string) {
    logNav(this.page, path);
    await this.page.evaluate(async (to) => {
      const el = document.querySelector('#app') as
        | (Element & {
            __vue_app__?: {
              config: { globalProperties: { $router: { push: (p: string) => Promise<unknown> } } };
            };
          })
        | null;
      const router = el?.__vue_app__?.config.globalProperties.$router;
      if (!router) throw new Error('vue-router not found on #app');
      await router.push(to);
    }, path);
    await this.settle();
  }

  pathname() {
    return new URL(this.page.url()).pathname;
  }

  /** Title + link of every item in the left navigation drawer. */
  async drawerItems(): Promise<Array<{ title: string; to: string }>> {
    const nav = this.page.locator('.v-navigation-drawer .v-list--nav');
    await expect(nav).toBeVisible();
    return nav.locator('a.v-list-item').evaluateAll((links) =>
      links.map((a) => ({
        title: a.querySelector('.v-list-item-title')?.textContent?.trim() ?? '',
        to: new URL((a as HTMLAnchorElement).href).pathname,
      })),
    );
  }

  /** Text of every visible error alert on the page (the subscription banner excluded). */
  async errorAlerts(): Promise<string[]> {
    const alerts = this.page.locator(
      '.v-alert.bg-error:visible:not([data-testid=subscription-banner]), .v-alert.text-error:visible:not([data-testid=subscription-banner])',
    );
    return (await alerts.allInnerTexts()).map((t) => t.trim());
  }
}

function isApi(url: string) {
  return new URL(url).pathname.startsWith('/api/');
}

/** Pages the router guard redirects to when a route is not allowed. */
export const BLOCKED_PATHS = ['/forbidden', '/module-disabled', '/login', '/'];

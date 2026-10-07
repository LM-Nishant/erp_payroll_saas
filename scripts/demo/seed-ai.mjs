#!/usr/bin/env node
/**
 * Demo seed for the AI gateway (HTTP API based, idempotent).
 *
 *   API_URL=http://127.0.0.1:3106 node scripts/demo/seed-ai.mjs
 *
 * For ABBS and Logicmines it: enables the `ai` module (organization override, only if off),
 * configures AI settings to the deterministic `mock` provider (no key needed), and — only when
 * the admin has no conversations yet — creates a few sample assistant chats, drafts and
 * summaries, which also produce usage logs for the AI usage dashboard.
 *
 * To use a real model later: Secrets → add kind `ai.openai` (value = API key, optional metadata
 * {"model":"gpt-4o-mini","baseUrl":"…"}), then AI settings → provider `openai` + data sharing on.
 */
const API = (process.env.API_URL ?? 'http://127.0.0.1:3106').replace(/\/+$/, '');

const TENANTS = [
  {
    slug: 'abbs',
    email: 'abbs.admin@abbs.test',
    password: 'Abbs@2026Demo',
    chats: [
      'How many employees do we have?',
      'How many students are enrolled?',
      'Total of the latest payroll run',
    ],
    drafts: [
      {
        kind: 'circular',
        instructions: 'School will remain closed on Friday for Diwali; classes resume Monday.',
      },
      {
        kind: 'parent_email',
        instructions: 'Invite parents to the annual Parent-Teacher Meeting next Saturday at 10 AM.',
      },
    ],
  },
  {
    slug: 'logicmines',
    email: 'admin@logicmines.in',
    password: 'Logicmines@2026',
    chats: ['How many employees do we have?', 'Attendance summary for this month'],
    drafts: [
      {
        kind: 'offer_letter',
        instructions: 'Offer a Senior Software Engineer role starting next month.',
        variables: { designation: 'Senior Software Engineer' },
      },
      {
        kind: 'notice',
        instructions: 'Office will be closed for maintenance on Sunday; remote work on Monday.',
      },
    ],
  },
];

const SAMPLE_RESUME = `Priya Sharma — Senior Software Engineer. 7 years of experience building payroll and HR
systems with Node.js, TypeScript and MySQL. Led a team of 5 engineers at a fintech startup,
reduced payroll processing time by 60%. B.Tech in Computer Science. Skills: Vue, Express,
Prisma, AWS, CI/CD, mentoring.`;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(
      `${method} ${path} → ${res.status} ${json?.error?.code ?? ''} ${json?.error?.message ?? ''}`,
    );
  }
  return json;
}

async function seedTenant(t) {
  const login = await call('POST', '/api/v1/auth/login', {
    body: { email: t.email, password: t.password, organization: t.slug },
  });
  const token = login.data.accessToken;
  if (!token) throw new Error('login did not return an access token (MFA enabled?)');
  const api = (method, path, body) => call(method, path, { token, body });

  const features = (await api('GET', '/api/v1/features')).data;
  const ai = features.features.find((f) => f.key === 'ai');
  if (!ai?.licensed) {
    console.warn(`[${t.slug}] 'ai' is not licensed for this organization's plan — skipping.`);
    return;
  }
  if (!ai.enabled) {
    await api('PUT', '/api/v1/features/overrides', {
      scopeType: 'ORGANIZATION',
      featureKey: 'ai',
      enabled: true,
    });
    console.log(`[${t.slug}] enabled the ai module`);
  }

  await api('PUT', '/api/v1/ai/settings', {
    enabled: true,
    provider: 'mock',
    defaultModel: 'gpt-4o-mini',
    maxTokensPerRequest: 1024,
    temperature: 0.2,
    enabledFeatures: ['assistant', 'drafting', 'payroll_anomaly', 'student_insight', 'summarizer'],
    dataSharing: false,
  });
  console.log(`[${t.slug}] AI settings → mock provider`);

  const existing = await api('GET', '/api/v1/ai/conversations?pageSize=1');
  if (existing.meta.total > 0) {
    console.log(`[${t.slug}] sample conversations already exist — skipping samples`);
    return;
  }

  let conversationId;
  for (const message of t.chats) {
    const res = await api('POST', '/api/v1/ai/chat', {
      message,
      ...(conversationId ? { conversationId } : {}),
    });
    conversationId = res.data.conversation.id;
  }
  await api('POST', '/api/v1/ai/chat', { message: 'Show leave balances for my team' });
  for (const d of t.drafts) await api('POST', '/api/v1/ai/drafts', d);
  await api('POST', '/api/v1/ai/summarize', { kind: 'resume', text: SAMPLE_RESUME });

  const runs = await api('GET', '/api/v1/payroll/runs?pageSize=5').catch(() => null);
  const run = runs?.data?.find((r) => !['DRAFT', 'COMPUTING', 'CANCELLED'].includes(r.status));
  if (run) {
    await api('POST', '/api/v1/ai/payroll/explain', { runId: run.id }).catch((e) =>
      console.warn(`[${t.slug}] payroll explanation skipped: ${e.message}`),
    );
  }
  if (t.slug === 'abbs') {
    await api('POST', '/api/v1/ai/students/insights', {}).catch((e) =>
      console.warn(`[${t.slug}] student insights skipped: ${e.message}`),
    );
  }
  const usage = (await api('GET', '/api/v1/ai/usage')).data;
  console.log(
    `[${t.slug}] samples created: ${usage.totals.requests} AI requests, ${usage.totals.totalTokens} tokens`,
  );
}

for (const t of TENANTS) {
  try {
    await seedTenant(t);
  } catch (e) {
    console.error(`[${t.slug}] failed: ${e.message}`);
    process.exitCode = 1;
  }
}

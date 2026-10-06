# Education ERP + HRMS + Payroll SaaS

Multi-tenant SaaS platform for schools, colleges, universities and multi-institution
education groups. See [`docs/SPEC.md`](docs/SPEC.md) for the product specification and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for binding technical conventions.

## Stack

- **API:** Node 22, TypeScript, Express 5, Prisma (MySQL 8), zod, pino, Redis/BullMQ
- **Web:** Vue 3, Vite, Pinia, Vue Router, Vuetify 3
- **Shared:** `@erp/shared` zod schemas & types
- **Tooling:** pnpm workspaces, Vitest + supertest, ESLint + Prettier, GitHub Actions

## Prerequisites

- Node.js 22.13+ (`nvm use`)
- pnpm (`corepack enable` — version pinned in `package.json`)
- MySQL 8 and Redis — via Docker (`docker compose up -d`) or local installs

## Setup

```bash
pnpm install
docker compose up -d                  # MySQL 8.4 on :3306 (erp/erp), Redis on :6379
cp .env.example apps/api/.env         # adjust if your DB credentials differ
pnpm db:migrate                       # apply Prisma migrations to DATABASE_URL
pnpm db:seed                          # demo orgs (ABBS, BCC, JP College), roles, users
pnpm dev:api                          # http://localhost:3000
pnpm dev:web                          # http://localhost:5173 (proxies /api to :3000)
```

Without Docker, create a MySQL user that can create databases (Prisma needs a shadow DB for
`migrate dev` and the integration tests reset `erp_test`), and point `DATABASE_URL` /
`TEST_DATABASE_URL` at it.

## Scripts

| Command           | Description                                                |
| ----------------- | ---------------------------------------------------------- |
| `pnpm lint`       | ESLint (zero warnings)                                     |
| `pnpm format`     | Prettier write (`format:check` in CI)                      |
| `pnpm typecheck`  | `tsc` / `vue-tsc` across all packages                      |
| `pnpm test`       | All tests (API integration tests need `TEST_DATABASE_URL`) |
| `pnpm test:unit`  | Unit tests only — no database required                     |
| `pnpm build`      | Build all apps                                             |
| `pnpm db:migrate` | `prisma migrate dev` (create/apply migrations)             |
| `pnpm db:deploy`  | `prisma migrate deploy` (CI/production)                    |
| `pnpm db:seed`    | Seed demo hierarchy, default roles and users (idempotent)  |

> ⚠️ The integration suite **resets** the database in `TEST_DATABASE_URL` (the URL must
> contain `test`). Never point it at a real database.

## Trying the API

`pnpm db:seed` creates demo users (password `Demo-Passw0rd!`, override with
`SEED_DEMO_PASSWORD`; the default is refused in production):

| Email                   | Role (scope)                                        |
| ----------------------- | --------------------------------------------------- |
| `platform@erp.test`     | Platform Super Admin (no tenant access by default)  |
| `owner@abbs.test`       | Group Owner — ABBS (organization-wide)              |
| `group.admin@abbs.test` | Group Admin — ABBS Group (all 4 ABBS colleges)      |
| `eng.admin@abbs.test`   | Institution Admin — ABBS College of Engineering     |
| `cse.hod@abbs.test`     | HOD — CSE department of ABBS College of Engineering |
| `admin@bcc.test`        | Group Admin — BCC Group                             |
| `admin@jp-college.test` | Institution Owner — JP College                      |

```bash
TOKEN=$(curl -s localhost:3000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"group.admin@abbs.test","password":"Demo-Passw0rd!"}' | jq -r .data.accessToken)
curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/v1/me
curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/v1/institutions   # 4 ABBS colleges
curl localhost:3000/health/ready
```

The web app (`pnpm dev:web`) has a login page (with the MFA step) and a permission-driven
sidebar.

With `TENANT_RESOLVER=dev-header` (dev/test only, refused in production) a request without a
token may send `X-Dev-Organization: <slug>` and acts as an all-permissions dev principal.

Endpoints (under `/api/v1`):

- `auth/*` — login, MFA verify, refresh, logout, sessions, login history, MFA enrollment,
  password change/reset, invite acceptance. `me` — current user, roles, scopes, permissions.
- Tenant hierarchy: `organization`, `groups`, `institutions`, `campuses`, `departments`,
  `programs`, `class-sections` (list/get/create/patch/soft delete, scope-filtered).
- `users`, `roles`, `permissions`, `audit-logs`; `platform/*` for platform admins.

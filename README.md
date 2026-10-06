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
pnpm db:seed                          # demo data: ABBS (4 colleges), BCC (2), JP College
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
| `pnpm db:seed`    | Seed demo hierarchy (idempotent)                           |

> ⚠️ The integration suite **resets** the database in `TEST_DATABASE_URL` (the URL must
> contain `test`). Never point it at a real database.

## Trying the API

Until authentication lands, the tenant is resolved by a **development-only** stub that
reads the `X-Dev-Organization` header (org slug or id). It is disabled unless
`TENANT_RESOLVER=dev-header` and refused when `NODE_ENV=production`.

```bash
curl -H 'X-Dev-Organization: abbs' localhost:3000/api/v1/institutions     # 4 ABBS colleges
curl -H 'X-Dev-Organization: jp-college' localhost:3000/api/v1/institutions
curl localhost:3000/health/ready
```

Endpoints (all tenant-scoped, under `/api/v1`): `organization`, `groups`, `institutions`,
`campuses`, `departments`, `programs`, `class-sections` — each with list (paginated,
filterable), get, create, patch and soft delete.

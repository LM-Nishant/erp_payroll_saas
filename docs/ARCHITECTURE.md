# Architecture & Conventions

This document records the **binding technical decisions** for the Education ERP + HRMS +
Payroll SaaS. Every layer of the foundation stack (and every later feature) must follow it.
The product specification lives in [`SPEC.md`](./SPEC.md).

## 1. Repository layout

pnpm workspace monorepo:

| Path              | Purpose                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| `apps/api`        | Node.js + TypeScript (strict) + Express 5 modular monolith                |
| `apps/web`        | Vue 3 + TypeScript + Vite + Pinia + Vue Router + Vuetify 3                |
| `packages/shared` | Shared TypeScript types and **zod** schemas (request DTOs, API envelopes) |
| `docs/`           | Spec (`SPEC.md`) and this architecture guide                              |

Runtime: **Node 22 LTS** (`.nvmrc`; satisfies the "Node 20+" requirement — Node 20 is EOL and
pnpm 11 requires ≥ 22.13). Package manager: **pnpm** (version pinned via `packageManager`).

## 2. Backend (apps/api)

```
apps/api/
  prisma/schema.prisma        # single Prisma schema (MySQL 8)
  prisma/migrations/          # committed SQL migrations (prisma migrate)
  prisma/seed.ts|seed-data.ts # idempotent demo seed
  src/
    app.ts                    # createApp(deps) — composable for tests
    server.ts                 # process entrypoint, graceful shutdown
    core/                     # shared platform engines
      config/env.ts           # zod-validated environment
      logger/                 # pino
      http/                   # errors, error handler, request id, validation, pagination
      db/prisma.ts            # BASE (unscoped) Prisma client — core only
      tenancy/                # Multi-Tenant Engine
      queue/                  # Redis (ioredis) + BullMQ wiring
    modules/<module>/         # feature modules
      <module>.routes.ts      # Express router: parse input → call service → envelope
      <module>.service.ts     # business rules, parent/reference validation
      <module>.repository.ts  # data access via tenantDb() only
  test/                       # integration tests (*.int.test.ts) against MySQL
```

- **Modular monolith.** Modules talk to each other through exported services/repositories,
  never by reaching into another module's tables ad hoc. Keep boundaries extractable.
- **Shared engines** (tenancy, auth, audit, workflow, notifications, storage, …) live in
  `src/core/<engine>` and are consumed by modules.
- **Validation:** every request body/query/params is parsed with a zod schema from
  `@erp/shared` via `parseInput()`. Request schemas are `.strict()` — unknown keys are 400s.
- **Errors:** throw `AppError` subclasses (`NotFoundError`, `ConflictError`,
  `InvalidReferenceError`, …). The central error handler produces
  `{ error: { code, message, requestId, details? } }`. Prisma `P2002` → 409, `P2025` → 404.
  5xx messages are never leaked.
- **Responses:** `{ data }` for single resources, `{ data, meta: { page, pageSize, total } }`
  for lists. `POST` → 201, `DELETE` → 204.
- **Routes:** versioned under `/api/v1`, kebab-case plural nouns (`/class-sections`).
  Health: `GET /health` (liveness), `GET /health/ready` (DB readiness).
- **Request id:** `X-Request-Id` is accepted if well-formed, otherwise generated; echoed in
  the response header, logs and error bodies.
- **Logging:** pino / pino-http. Secrets & auth headers are redacted. Logs carry
  `organizationId` once the tenant is resolved.
- **Config:** add every new env var to `core/config/env.ts` (zod) **and** `.env.example`.
  Never commit secrets.

## 3. Database

- **MySQL 8** via **Prisma ORM**; schema changes only through `prisma migrate dev` with the
  generated SQL committed.
- **IDs:** UUID v4 strings stored as `CHAR(36)` (`@default(uuid()) @db.Char(36)`) everywhere.
- **Naming:** tables and columns are `snake_case` (`@@map`/`@map`); Prisma fields camelCase.
- **Timestamps:** `created_at`, `updated_at` (`DATETIME(3)`) on every table.
- **Soft delete:** business tables have `deleted_at`. The tenant client hides soft-deleted
  rows unless a query filters on `deletedAt` explicitly. Unique keys include soft-deleted rows.
- **Tenant columns:** every tenant-owned table carries `organization_id` plus the relevant
  hierarchy FKs (e.g. class sections carry institution, department, program, campus) and
  composite indexes starting with `organization_id`.
- **Referential integrity:** FKs use `onDelete: Restrict`; services refuse to soft-delete
  parents that still have live children (409).

## 4. Multi-Tenant Engine (`src/core/tenancy`)

Hierarchy: **Platform → Organization (tenant) → Group? → Institution → Campus → Department →
Program → Class/Section**.

- An **organization** is the SaaS tenant root: an education group (ABBS, BCC), a society, or
  an independent institution (JP College). Institutions have a nullable `group_id`.
- Isolation boundary = `organization_id`. Finer-grained scopes (group / institution /
  department assignments) are enforced by the authorization engine (§5).

Components:

| Piece                               | Responsibility                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TenantContext` (AsyncLocalStorage) | `runWithTenant()`, `getTenantContext()`, `currentOrganizationId()`. Frozen; nested tenant switching throws.                                                                                                                                                                                      |
| `TenantResolver`                    | Resolves the tenant **server-side** per request. `jwt` (default): the organization bound to the authenticated session. `dev-header` (dev/test only, rejected in production): jwt, else `X-Dev-Organization`. `none`: deny all.                                                                   |
| `tenantContext()` middleware        | Runs resolver, verifies org exists & is `ACTIVE`, runs the request inside the context. 401 `TENANT_UNRESOLVED` / 403 `TENANT_INACTIVE`.                                                                                                                                                          |
| `rejectClientTenantIdentifiers`     | 400 if body/query contain `organizationId`/`tenantId` (defense in depth).                                                                                                                                                                                                                        |
| `tenantDb()` (Prisma extension)     | Tenant-scoped client: filters all reads/updates/deletes by `organization_id` (+ soft delete), stamps creates, throws `TenantIsolationError` on cross-tenant filters/writes, nested relation writes, raw SQL, or unregistered models. `Organization` is read-only and limited to the current org. |
| `tenant-models.ts`                  | Registry of tenant-scoped / global / soft-delete models. A unit test fails if a model with `organizationId` is not registered.                                                                                                                                                                   |

Rules for all modules:

1. **Never** import `core/db/prisma` (the unscoped client) from `src/modules/**` — ESLint
   enforces this. Use `tenantDb()` and `withTenant(data)` for creates.
2. **Never** accept tenant or hierarchy-owner ids from the client for authorization. Parent
   references in payloads (e.g. `institutionId`) must be **looked up through `tenantDb()`**
   and rejected with `InvalidReferenceError` (422) if not visible. Derive denormalized
   hierarchy FKs from the verified parent server-side.
3. Use **scalar foreign keys**, not nested relation writes (`connect`/`create`), on tenant
   models — the extension rejects nested writes.
4. Register every new model in `tenant-models.ts` (tenant-scoped or global).
5. Background jobs carry `organizationId` in their payload and run inside
   `runWithTenant({ organizationId, source: 'system' }, …)`.
6. Platform-level (cross-tenant) operations live in `core/platform` using the base client
   with explicit authorization and audit logging (`runAsPlatform`, §5.4).

## 5. Authentication, authorization & audit

### 5.1 Identity & authentication (`src/core/auth`, `src/modules/auth`)

- **Users are platform-level identities** (`users`, global model, unique email). Tenant access
  comes from `organization_memberships` (INVITED / ACTIVE / DISABLED). Platform roles
  (`platform_super_admin`, `platform_support_admin`) are `platform_role_assignments`, defined
  in code (`core/authz/default-roles.ts`), never per tenant.
- Passwords: **argon2id** (`core/auth/password.ts`); policy shared with the web in
  `@erp/shared` (`passwordPolicyViolations`: 12+ chars, 3 character classes, no email name).
- Login → short-lived **JWT access token** (HS256 via `jose`, `ACCESS_TOKEN_TTL_SECONDS`,
  claims: `sub`, `sid`, `org`) + opaque **refresh token** stored only as a SHA-256 hash.
  Each login creates an `auth_sessions` row (device/IP/user agent). Refresh **rotates** the
  token; presenting a rotated token again is treated as theft → the whole session is revoked
  (`REFRESH_TOKEN_REUSED`, audited). Every request re-checks the session is not revoked, so
  logout / revoke / deactivation / password change take effect immediately.
- The browser uses `tokenDelivery: 'cookie'`: the refresh token is an httpOnly,
  `SameSite=Strict` cookie scoped to `/api/v1/auth`; the access token lives in memory only.
- `login_events` records every attempt (ip, user agent, success, failure reason). After
  `AUTH_MAX_FAILED_LOGINS` failures the account is locked for `AUTH_LOCKOUT_MINUTES` (423).
  Public auth endpoints are rate limited per IP (429, `RateLimitStore` — in-memory by
  default; swap for Redis when running several API instances).
- **MFA (TOTP, RFC 6238)**: enroll → activate with a code → 10 single-use recovery codes
  (hashed). Login then returns `{ mfaRequired, mfaToken }` to exchange at `/auth/mfa/verify`.
  TOTP secrets are AES-256-GCM encrypted (`DATA_ENCRYPTION_KEY`); codes cannot be replayed.
- Invite / password-reset tokens are single-use and hashed (`user_tokens`). **Until the
  notification engine (Layer 5) exists the API returns them in the response**; Layer 5 must
  deliver them by email and stop returning them.
- A session is bound to one organization. Users in several organizations pick one at login
  (`organization` slug; 409 `ORGANIZATION_SELECTION_REQUIRED` lists the choices).

### 5.2 Authorization: permissions + scopes (`src/core/authz`)

- **Permissions** are declared in `@erp/shared` → `PERMISSIONS` (`<resource>.<action>`, e.g.
  `payroll.approve`; `platform.*` are platform-only). The catalog is synced into the
  `permissions` table at startup (`syncPermissionCatalog`). Default tenant roles (spec §3)
  live in `core/authz/default-roles.ts` and are provisioned per organization by
  `provisionOrganizationRoles(orgId)` (call it when creating an organization).
  **Adding a permission in a later layer** = add it to `PERMISSIONS` + to the relevant
  default roles; existing organizations pick it up on the next provisioning run.
- **Roles** (`roles`, `role_permissions`) are per tenant; system roles are read-only, custom
  roles may only contain permissions their editor holds organization-wide.
- **Assignments**: `user_roles` + `user_scopes`. Each role assignment has ≥1 scope:
  `ORGANIZATION`, `GROUP`, `INSTITUTION`, `CAMPUS`, `DEPARTMENT` (FKs to the hierarchy;
  `PLATFORM` is a platform role assignment). A permission applies only within the scopes
  of the role that grants it. Group scopes cover every institution in the group; campus
  scopes cover their departments; department scopes do **not** grant their institution.
- A `Principal` (user, roles, grants, platform permissions, session) is built per request by
  `principalContext()` and available through `currentPrincipal()`.
- Assigning roles is checked for **privilege escalation**: the assigner needs
  `user.role.assign` and every permission of the role, covering each target scope.

**How modules use it** (the hierarchy modules are the reference implementation):

```ts
// routes: coarse check (permission held in at least one scope)
router.get('/', requirePermission('department.view'), handler);
// optional: requirePermission('x.update', (req) => resourceScopeOf(req)) for fixed resources

// service — lists: filter by the caller's scopes
const scope = await scopeWhere(currentPrincipal(), 'department.view', 'department');
repo.list({ ...filters, scope }); // repository: where = andScope(where, scope)

// service — reads: out-of-scope looks like not found (no existence leak)
if (!(await can(principal, 'department.view', hierarchyResource.department(row))))
  throw new NotFoundError('Department');

// service — writes: authorize against the existing row AND the destination parent
await authorize(principal, 'department.update', hierarchyResource.department(before));
```

- Every tenant-owned record of a later layer that belongs to the hierarchy must carry the
  relevant hierarchy FKs (`institution_id`, `department_id`, …) so it can be scoped. Add the
  model to `ScopedModel`/`COLUMNS` in `engine.ts` (or build the `where` from
  `accessFor()`), and a `hierarchyResource` helper.
- Organization-wide resources (roles, audit logs, settings) use `authorize(p, perm, {})`,
  which only an `ORGANIZATION`-scoped grant satisfies.
- The web menu and route guards use `GET /api/v1/me` (`permissions`, `roles[].scopes`);
  they are convenience only — the API is always authoritative.

### 5.3 Audit engine (`src/core/audit`)

- `audit_logs` is **append-only**: no update/delete API, and DB triggers reject UPDATE and
  DELETE. Rows hold organization, actor (user + actor type), action, entity type/id,
  before/after **diff** (changed keys only), reason, metadata, ip, user agent, request id.
- Sensitive keys (password, hash, secret, token, otp, api key, bank account, …) are
  redacted automatically (`redact.ts`) — still never pass raw secrets.
- Call `audit.record({ action: '<entity>.<verb>', entityType, entityId, before, after })` for
  **every mutation** of business data and every security event. Actor, organization, IP,
  user agent and request id come from the request context. Audit writes run after the
  mutation (not in the same transaction) and failures propagate as errors.
- Already audited automatically: login success and lockout (every attempt, incl. failures,
  is in `login_events`), MFA changes, refresh-token
  reuse, password change/reset, user create/update/(de)activate, role & scope changes, role
  edits, hierarchy create/update/delete, platform tenant access.
- Read via `GET /api/v1/audit-logs` (organization-wide `audit.view`) and
  `GET /api/v1/platform/audit-logs` (`platform.audit.view`).

### 5.4 Platform (cross-tenant) access (`src/core/platform`)

- Platform admins have **no tenant access** by default (tenant routes return 401).
- `POST /api/v1/platform/organizations/:id/access { reason }` opens a short-lived
  (`PLATFORM_ACCESS_TTL_MINUTES`), non-refreshable tenant session; it is audited in the
  target organization, and every action in it carries the reason in audit metadata.
- Background/system code that must act inside a tenant with platform authority uses
  `runAsPlatform({ organizationId, reason }, fn)` — always audited (`platform.run_as`).

#### Organization onboarding & lifecycle (`core/platform/organizations.ts`)

Platform admins manage tenants under `/api/v1/platform/organizations` (`platform.organization.view`
to read, `platform.organization.manage` to write; UI: Platform → Organizations):

- `POST /` `{ name, slug, planId, subscriptionStatus: TRIAL|ACTIVE, owner: { name, email, role } }`:
  creates the organization, provisions default roles (`provisionOrganizationRoles`) and the plan
  subscription (`provisionOrganizationSubscription`), then invites the first owner
  (`group_owner` or `institution_owner`, organization scope) via `runAsPlatform` +
  `userService.create`. The invite token goes by e-mail and is never returned. The slug must be
  unique (409), and the plan must be ACTIVE (422).
- `GET /`, `GET /:id` (counts and owners), `PATCH /:id` `{ name, reason }`,
  `POST /:id/owners` (invite another owner).
- `POST /:id/status` `{ status: ACTIVE|SUSPENDED|ARCHIVED, reason }`. A non-ACTIVE status revokes
  every session of the org, and tenant requests then get 403 `TENANT_INACTIVE`.
- Every change is audited in the target org with `actorType: 'platform'`
  (`organization.create|update|suspend|activate|archive`). Subscription, add-ons and limit
  overrides use the existing `/platform/organizations/:id/subscription` endpoints.

### 5.5 Rules for later layers

1. Declare permissions in `@erp/shared` and add them to default roles; guard every route with
   `requirePermission` and enforce scope in the service (`scopeWhere` / `can` / `authorize`).
2. Never trust client-supplied scope or tenant ids; resolve parents through `tenantDb()` and
   authorize against the resolved resource.
3. `audit.record()` every mutation; never log secrets.
4. Tests: use `signIn(app, email, password)` (test/helpers) with the seeded demo users for
   RBAC/scope tests; `asTenant()` (dev header, all permissions) only for tenant-isolation
   tests. Call `syncPermissionCatalog()` + `provisionOrganizationRoles()` for new orgs.

## 6. Licensing, branding & secrets (Layer 3)

### 6.1 Plans, subscriptions & billing (`src/core/features`)

- `SubscriptionPlan` (global, platform-managed) holds `features` (module keys) and `limits`
  (`institutions`, `students`, `employees`, `storage_bytes`, `ai_tokens`,
  `communication_messages` — `LIMITS` in `@erp/shared`; **missing = 0, `null` = unlimited**). `syncPlanCatalog()` upserts the
  Starter / Professional / Enterprise defaults (`DEFAULT_PLANS`).
- `OrganizationSubscription` (one per org): status `TRIAL | ACTIVE | PAST_DUE | CANCELLED`,
  trial end, period dates, add-on features and limit overrides. A subscription **licenses
  modules** when ACTIVE, PAST_DUE, or TRIAL with `trialEndsAt` in the future. No subscription ⇒
  no modules and every limit is 0.
- `Invoice`: period, line items, subtotal + GST (`taxRateBps`, default from settings) = amount,
  status `DRAFT|OPEN|PAYMENT_SUBMITTED|PAID|OVERDUE|VOID`. Drafts are hidden from the tenant.
- **Payments are manual UPI** (no gateway). `PlatformBillingSettings` (global single row:
  seller name/address/GSTIN, UPI ID + payee, default GST %, terms; `GET|PUT
/platform/billing-settings`). Tenants get a `upi://pay` link + QR (`GET
/subscription/invoices/:id/upi`), download the PDF (`/pdf`, also on the platform side), and
  report the UTR (`POST /subscription/invoices/:id/payment`, `billing.pay`) → `PAYMENT_SUBMITTED`.
  The platform verifies in `GET /platform/invoices?status=PAYMENT_SUBMITTED` and PATCHes the
  invoice to `PAID` (method/reference default to `UPI` / the submitted UTR) or back to `OPEN`.
  Invoice PDFs are rendered in `core/features/invoicing.ts` (PDF `image` block for the QR).
- Platform admins manage plans / subscriptions / invoices under `/api/v1/platform/{plans,
organizations/:id/subscription, organizations/:id/invoices}` (`platform.plan.manage`,
  `platform.subscription.manage`). Tenant-scoped writes go through `runAsPlatform` and are
  audited in the tenant. Tenants read `GET /api/v1/subscription` (+ `/invoices`, `billing.view`).
- **New orgs (incl. test orgs) must call `provisionOrganizationSubscription(orgId, planKey)`**
  after `provisionOrganizationRoles()`, otherwise all feature-gated routes return 403.

### 6.2 Module licensing (`src/core/features`)

- Feature keys live in `FEATURES` / `FEATURE_KEYS` (`@erp/shared`), with
  `FEATURE_DEPENDENCIES` (e.g. `payroll` → `hr`, `whatsapp` → `communication`).
- `FeatureOverride` rows (org / group / institution) can only **disable** or re-enable within
  the license; enabling an unlicensed module is rejected (422 `FEATURE_NOT_LICENSED`).
  Effective = licensed ∧ most-specific override (institution ?? group ?? org ?? on) ∧ all
  dependencies effective. An institution can never exceed its org plan.
- Gate routes with `requireFeature('payroll')` (mount after tenant context; 403
  `FEATURE_DISABLED` with `{ feature }` details). Without a resolver it checks "enabled
  anywhere in the org"; services then call `assertFeatureEnabled(key, { institutionId })`
  for the concrete resource. `isFeatureEnabled(ctx, key, { institutionId?, groupId? })` is the
  boolean variant (`currentFeatureContext()` gives `ctx`).
- `GET /api/v1/me` returns `features` (effective anywhere for the user) and `branding`. Web
  menus declare `feature` on `MenuItem` and routes declare `meta.feature`; the guard redirects
  to `module-disabled`.
- APIs: `/api/v1/features` (`feature.view`), `GET /features/effective`, `PUT /api/v1/features/overrides`,
  `DELETE /features/overrides/:id`
  (`feature.manage`, audited `feature_override.*`).

### 6.3 Usage limits (`src/core/features/limits.ts`)

- `UsageCounter(organizationId, limitKey, period)`; gauges use period `total`, monthly limits
  use `YYYY-MM` (UTC).
- `assertWithinLimit(key, delta)` checks only; `consumeLimit(key, delta)` atomically reserves;
  `releaseLimit(key, delta)` frees (e.g. on delete). Prefer
  `withLimit('employees', 1, () => create())` — reserves first, releases if `fn` throws.
  Over limit ⇒ 403 `LIMIT_EXCEEDED` with `{ limitKey, limit, used, requested }`.
- Modules owning a gauge register a recount with `registerUsageSource('employees', orgId =>
count)`; `reconcileUsage(orgId)` recounts (seed / repair jobs).

### 6.4 Branding (`src/core/branding`, `/api/v1/branding`)

- `BrandingProfile` per org / group / institution: display name, `logoStorageKey` +
  `logoFileId` (Layer 4 sets `logoFileId` to a document/file id; changing the storage key
  clears it), primary/secondary/accent colors, letterhead/footer text, address, contact info,
  custom domain / subdomain placeholders (never inherited).
- `resolveBranding(orgId, { institutionId? , groupId? })` merges institution → group → org →
  platform defaults per field and returns `sources`. **PDFs / emails must use it**; it is
  cached per request and invalidated on writes. `GET /branding/resolved?institutionId=` exposes
  it; `GET/PUT/DELETE /branding/{organization,groups/:id,institutions/:id}`
  (`branding.view` / `branding.manage`, audited).
- Web: `plugins/branding.ts` `applyBranding()` applies `me.branding` colors to the Vuetify theme.

### 6.5 Secret management (`src/core/secrets`, `/api/v1/secrets`)

- Envelope encryption: each secret gets a random AES-256-GCM data key; the value is
  encrypted with AAD bound to `org:secretId`; the data key is wrapped by the master key via a
  `KeyProvider` (`LocalKeyProvider` from `SECRETS_MASTER_KEYS="1:<b64 32B>,2:…"` +
  `SECRETS_ACTIVE_KEY_VERSION`; `SECRETS_KEY_PROVIDER` selects the provider — implement the
  interface for a cloud KMS and register it in `keyProvider()`).
- `TenantSecret`: org + optional group/institution scope, `kind` (`smtp`, `sms`,
  `ai.openai`, `storage`…), `name`, ciphertext, wrapped key, `keyVersion`, `last4`,
  `fingerprint`, `createdById`, `rotatedAt`.
- The HTTP API is **write-only**: responses carry only masked metadata (`masked`, `last4`,
  `fingerprint`). Create / rotate / delete are audited (`secret.create|rotate|delete`).
- **Engines read secrets only through `getSecret({ kind, name?, institutionId?, groupId?,
purpose })`** — falls back institution → group → org, audits `secret.access` (or
  `secret.access_failed`) with the purpose, and returns a `SecretValue` whose `toString/toJSON`
  are redacted; call `.reveal()` only at the point of use. Never log or return the value.
- Master-key rotation: add a new version to `SECRETS_MASTER_KEYS`, set it active, then
  `POST /api/v1/platform/secrets/rewrap` (`platform.secret.rotate_keys`, audited
  `secret.rewrap`). Old versions must stay configured until rewrap completes.
- pino redaction (`LOG_REDACT_PATHS`) covers `value`, `secret`, `password`, tokens, etc.

### 6.6 Permissions & default roles

`subscription.view`, `billing.view`, `feature.view`, `feature.manage`, `branding.view`,
`branding.manage`, `secret.view`, `secret.manage` (+ platform `platform.plan.manage`,
`platform.subscription.manage`, `platform.secret.rotate_keys`). Group owner: all; group
admin: features manage + secrets view + branding; institution admin: feature view + branding;
finance: subscription + billing view.

### 6.7 Rules for later layers

1. Mount module routers with `requireFeature('<module>')` and check per-institution access in
   services with `assertFeatureEnabled`.
2. Count-limited creates use `withLimit(key, 1, …)`, deletes `releaseLimit`, and register a
   `registerUsageSource`. Metered usage (AI tokens, messages) uses `consumeLimit(key, n)`.
3. Credentials for SMTP/SMS/AI/storage come only from `getSecret()` with a `purpose`.
4. Rendered documents and notifications use `resolveBranding()`.
5. Test fixtures provision a subscription (`provisionOrganizationSubscription`) for new orgs.

## 7. File storage, documents & PDFs (Layer 4)

### 7.1 Storage engine (`src/core/storage`)

- `StorageProvider` interface: `putObject`, `getObject`, `headObject`, `deleteObject`, `copy`,
  `getSignedDownloadUrl`, `getSignedUploadUrl`. Implementations: `S3StorageProvider`
  (`@aws-sdk/client-s3` + presigner; private bucket, SSE `AES256`/`aws:kms`, SHA-256 checksums,
  version-aware), `FsStorageProvider` (`STORAGE_DRIVER=local`, dev) and `MemoryStorageProvider`
  (unit tests). Local providers serve HMAC-signed, expiring tokens at
  `/api/v1/storage/local/:token` (GET download / PUT signed upload; checksum + size enforced).
- **Provider selection:** `storageForWrite({ institutionId, groupId })` uses the most specific
  tenant secret of kind `storage` (institution → group → org via `getSecret`), else the
  platform provider from env (`STORAGE_*`). Storage secret value:
  `{"accessKeyId":"…","secretAccessKey":"…"}`; metadata:
  `{provider:"s3", bucket, region, endpoint?, forcePathStyle?, sse?, kmsKeyId?}`. Each
  version records which secret wrote it (`storageSecretId`); reads use
  `storageForObject(ref)` (`getSecretById`), so rotating/adding a tenant bucket never breaks
  old files.
- **Keys are server-generated, never client-supplied:**
  `org/{orgId}[/grp/{groupId}][/inst/{institutionId}]/{module}/{entity}/{entityId}/{uuid}-{sanitizedName}`
  (`buildObjectKey`); every read/delete calls `assertTenantKey(key, orgId)`.
- Signed URLs only (`STORAGE_SIGNED_URL_TTL_SECONDS`, `STORAGE_UPLOAD_URL_TTL_SECONDS`), no
  public objects; responses are `no-store` with forced `Content-Disposition`.
- **Upload policy:** extension + MIME allowlist (`DOCUMENT_UPLOAD_TYPES`, `LOGO_UPLOAD_TYPES`
  in `@erp/shared`; no SVG/HTML), magic-byte sniffing, `STORAGE_MAX_UPLOAD_BYTES`. Bytes are
  counted against the `storage_bytes` limit (`consumeLimit` on write, `releaseLimit` on purge /
  failure; `registerUsageSource('storage_bytes')` for reconciliation). No BLOBs in MySQL.
- **Virus scanning:** `setVirusScanner({ scan })` — the default no-op marks versions
  `SKIPPED`; a real scanner can return `PENDING` and later call
  `recordScanResult(versionId, 'CLEAN' | 'INFECTED')`. `INFECTED` versions cannot be downloaded.

### 7.2 Document engine (`src/core/documents`, `/api/v1/documents`)

- Models (tenant-owned): `Document` (org + group/institution/campus/department FKs, owner
  `ownerType`/`ownerId`, `module`, `category`/`documentType`, title, `confidentiality`
  PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED, `status`, `currentVersionId`, issue/expiry date,
  soft delete + `purgeAfter`), `DocumentVersion` (**immutable** — DB triggers reject updates
  of content columns and deletes; storage key, size, sha256, mime, uploader, version number,
  scan status), `DocumentPermission` (grants to a USER, ROLE key or SCOPE with actions
  `view|download|upload_version|delete|share`, optional expiry), `DocumentExpiryReminder`
  (`daysBefore` → `remindAt`, PENDING/SENT/CANCELLED), `DocumentSignature` (e-signature
  placeholder: status only), `DocumentUpload` (pending signed-URL uploads).
- **Attaching documents from a module** (always through `documentEngine`, never Prisma):

  ```ts
  import { documentEngine } from '../../core/documents';
  const doc = await documentEngine.attach({
    ownerType: 'employee',
    ownerId: employee.id,
    module: 'hr',
    metadata: {
      title: 'PAN card',
      category: 'identity',
      documentType: 'pan',
      confidentiality: 'CONFIDENTIAL',
      expiryDate: '2030-01-01',
    },
    file: { fileName, mimeType, body }, // or the signed-URL flow below
    authorization: 'caller', // only if your service already authorized
  });
  ```

  Other APIs: `addVersion`, `restoreVersion` (copies the old object into a NEW version),
  `list`/`get`/`versions`, `downloadUrl` (audited `document.download`), `currentVersionUrl`,
  `readCurrentVersion`, `update`, `remove` (soft delete; bytes purged after
  `DOCUMENT_RETENTION_DAYS`), `expiring`, grants and signature requests.

- **Upload flows:** (a) multipart through the API — `POST /documents/files` (`file` +
  `metadata` JSON) or `POST /documents/:id/versions`; (b) signed URL —
  `POST /documents/uploads` (validates type/size, pre-checks `storage_bytes`) → client `PUT`s
  to the returned URL with the returned headers → `POST /documents/uploads/:id/complete`
  (`headObject` verifies size + checksum, records metadata, consumes the limit). Same for
  versions via `POST /documents/:id/versions/uploads`.
- **Authorization** (`core/documents/access.ts`) — a document is visible when ANY of:
  1. RBAC + scope: `document.view` in a scope covering the document's hierarchy FKs, plus
     confidentiality (`CONFIDENTIAL` needs `document.view_confidential`; `RESTRICTED` needs
     it at ORGANIZATION scope). Action permissions: `download` → `document.download`,
     `upload_version` → `document.upload`, `delete` → `document.delete`, `share` →
     `document.share`; metadata edits → `document.manage`.
  2. Explicit grants (`DocumentPermission`) by user, role key or scope. Creating a RESTRICTED
     document auto-grants the creator.
  3. **Owner self-access** via the owner-type registry (requires `document.view_own`).
     Invisible documents return 404; visible ones with a missing action return 403
     `DOCUMENT_ACCESS_DENIED`. DTOs include `allowedActions` for the UI.
- **Registering an owner type** (do this once at module import; Layer 6 registers
  `employee` so employees see their own documents):

  ```ts
  registerDocumentOwnerType({
    type: 'employee',
    // Hierarchy of the owner (tenant-scoped lookup); null = not found → 422.
    resolveScope: async (id) => { const e = await tenantDb().employee.findFirst(...);
      return e && { groupId: …, institutionId: e.institutionId, campusId: …, departmentId: … }; },
    selfAccess: {
      actions: ['view', 'download'],
      ownedIds: async (principal) => (await employeeIdsForUser(principal.userId)),
    },
  });
  ```

  Built-in owner types: `organization`, `group`, `institution`, `campus`, `department`.

- **Hooks for jobs / Layer 5** (`core/documents/hooks.ts`, run in a tenant context such as
  `runAsPlatform`, no principal checks): `dueExpiryReminders({ asOf })` +
  `markReminderSent(id)` (notification delivery is Layer 5), `purgeExpiredDocuments()`,
  `expireStaleUploads()`, `recordScanResult()`.
- Routes are mounted with `requireFeature('documents')`; every mutation is audited
  (`document.create|version_create|version_restore|update|delete|share|unshare|download|purge|…`).

### 7.3 Branding logos

`POST /api/v1/branding/{organization,groups/:id,institutions/:id}/logo` (multipart `file`,
PNG/JPEG ≤ `LOGO_MAX_BYTES`, `branding.manage`) stores the logo as a PUBLIC `branding`
document (new uploads add versions to the same document) and sets `BrandingProfile.logoFileId`
(+ `logoStorageKey`); `DELETE …/logo` detaches it. `brandingLogoUrl(target)` /
`GET /branding/logo-url?institutionId=` return an audited, short-lived signed URL of the
resolved (possibly inherited) logo.

### 7.4 PDF engine (`src/core/pdf`, `/api/v1/pdf`)

- Templates are versioned code in a registry: `registerPdfTemplate({ key, version, name,
inputSchema (zod .strict()), defaultCategory, defaultDocumentType, title(input), build(input,
ctx) })` → returns a `PdfDocumentModel` of blocks (`heading`, `paragraph`, `keyValue`,
  `table`, `signature`, `spacer`; `{{ var }}` interpolation). `pdfTemplate(key, version?)`
  resolves the latest version unless pinned; generated documents record
  `metadata.templateKey/templateVersion` so old PDFs stay reproducible.
- Renderer is pluggable (`setPdfRenderer`); default `PdfKitRenderer` (pure JS) draws the
  letterhead from `resolveBranding` (logo, display name, colors, letterhead text, contact
  line) and a footer with page numbers on every page.
- `generatePdf({ templateKey, version?, data, ownerType, ownerId, title?, category?,
confidentiality? })` checks `pdf.generate` + `document.upload` in the owner's scope, renders
  with the owner's branding and stores the result through the document engine (module `pdf`).
  `renderPdfTemplate()` renders without storing. Sample: `generic_letter` v1. Later layers
  register `offer_letter`, `relieving_letter`, `payslip`, … in their module and call
  `generatePdf` (or `renderPdfTemplate` + `documentEngine.attach` with
  `authorization: 'caller'` for batch jobs).

### 7.5 Permissions, roles, env

- Permissions: `document.view|upload|download|delete|manage|share|view_confidential|view_own`,
  `pdf.generate`. Group owner/admin: all; institution admin: all in scope; HR: documents +
  confidential + pdf; finance/academic/teaching: view + download; self-service: `document.view_own`.
- Env: `STORAGE_DRIVER` (`s3|local|memory`), `STORAGE_LOCAL_DIR`,
  `STORAGE_LOCAL_SIGNING_SECRET` (required in production for `local`), `STORAGE_PUBLIC_BASE_URL`,
  `STORAGE_S3_{BUCKET,REGION,ENDPOINT,FORCE_PATH_STYLE,ACCESS_KEY_ID,SECRET_ACCESS_KEY,SSE,KMS_KEY_ID}`,
  `STORAGE_SIGNED_URL_TTL_SECONDS`, `STORAGE_UPLOAD_URL_TTL_SECONDS`, `STORAGE_MAX_UPLOAD_BYTES`,
  `DOCUMENT_RETENTION_DAYS`.
- Web: `pages/DocumentsPage.vue` (list/upload/download/versions/restore) under
  `/group|/institution|/employee/documents`; `BrandingPage` handles logo upload/preview.
  `apiFetch` accepts `FormData` bodies for multipart.

### 7.6 Rules for later layers

1. Never store files in MySQL or build storage keys yourself — use `documentEngine` (or
   `core/storage` + `buildObjectKey` for non-document artifacts).
2. Register an owner type for every entity that owns documents, with `selfAccess` when the
   person should see their own files.
3. Never return storage keys or long-lived URLs; issue signed URLs via `downloadUrl` (audited).
4. Generated documents (letters, payslips) are PDF templates registered in the module and
   stored through `generatePdf`; bump `version` instead of changing a template's output.

## 8. Queues, workflow, notifications, communication & integrations (Layer 5)

All Layer 5 engines live in `src/core/*` and register themselves via side-effect imports in
`src/engines.ts`, which is imported by **both** the API (`app.ts`) and the worker
(`worker.ts`). Later layers add their own registration modules (e.g.
`modules/leave/leave.workflow.ts`) to `engines.ts`.

### 8.1 Queue (`src/core/queue`)

- Drivers: `bullmq` (Redis via ioredis; default outside tests) and `inline` (in-process,
  default when `NODE_ENV=test`). Select with `QUEUE_DRIVER`; `QUEUE_CONCURRENCY`, `QUEUE_PREFIX`,
  `REDIS_URL` configure BullMQ.
- `defineJob({ name, handler, attempts?, backoffMs? })` registers a handler (exponential
  backoff, default 5 attempts / 2 s). `enqueue(name, data, { delayMs?, jobId? })` — **`data`
  must include `organizationId`**; the processor runs inside `runWithTenant` with a system
  principal (`runAsSystem(orgId, fn)`), so `tenantDb()`/`audit.record` work unchanged.
- `defineRecurringJob({ name, everyMs | pattern, handler })` runs platform-level and fans out
  per tenant with `forEachActiveOrganization` + `enqueue`. BullMQ job schedulers are
  registered by the worker; the inline driver has `startInlineScheduler` (dev) and tests call
  `runRecurringJobNow(name)` + `drainJobs({ includeDelayed })`.
- Worker: `apps/api/src/worker.ts` (`pnpm --filter @erp/api worker` in dev,
  `start:worker` for the built bundle). Built-in recurring jobs: document expiry reminders
  (`dueExpiryReminders` → `document.expiring` notification → `markReminderSent`),
  `purgeExpiredDocuments`, `expireStaleUploads`, workflow SLA escalation. Retries (messages,
  webhooks) are delayed jobs.
- Auth rate limiting uses a pluggable store: `RATE_LIMIT_STORE=memory|redis` (memory in tests).

### 8.2 Domain event bus (`src/core/events`)

```ts
registerEventType({ key: 'employee.created', label: 'Employee created', webhook: true });
await emit('employee.created', { employeeId }, { institutionId });
onEvent('employee.*', 'payroll.employee-sync', async (event) => {
  /* subscriber */
});
```

`emit` persists a `domain_events` row in the current tenant and enqueues `events.dispatch`;
subscribers run in the job (each failing subscriber is retried on its own, never breaking the
emitting request). Events with `webhook !== false` fan out to matching outbound
webhook subscriptions. **Never put secrets/PII beyond what a subscriber needs in payloads.**

### 8.3 Workflow engine (`src/core/workflow`, `/api/v1/workflows`)

- Tenant-scoped, **versioned** `workflow_definitions` (editing an ACTIVE definition publishes
  a new version; running instances keep theirs) scoped ORGANIZATION / GROUP / INSTITUTION —
  the most specific active definition wins. Steps: approvers by `role` key or `permission` (holders
  whose scope covers the request), `user`, `reporting_manager` (levels); `mode: any|all`; optional
  `conditions` (`{ field, op, value }` on `context`, e.g. amount > 50000) — unmatched steps are
  skipped; `slaHours` + `escalateTo` approvers for SLA escalation (`workflow.sla_escalation` job); `allowSelfApproval` (default false).
- Modules register an entity type and submit:

```ts
registerWorkflowEntity({
  entityType: 'leave_request',
  label: 'Leave request',
  linkFor: (i) => `/employee/leave/${i.entityId}`,
  onApproved: async (i) => leaveService.markApproved(i.entityId),
  onRejected: async (i) => leaveService.markRejected(i.entityId, i.comment),
});
const instance = await submitWorkflow({
  entityType: 'leave_request',
  entityId: leave.id,
  title: 'Leave: 3 days',
  institutionId,
  departmentId,
  context: { days: 3 },
});
if (!instance) {
  /* no active definition → auto-approve per module policy */
}
```

- Layer 6 (HR) registers `registerReportingManagerResolver(async (userId, levels) => [...])`.
- Actions: `approve | reject | send_back | delegate | comment` (+ requester `cancel`,
  `resubmit`). Approver authorization is enforced server-side (must be a PENDING assignee;
  the requester can never approve unless `allowSelfApproval`). Every action is stored in
  `workflow_actions`, audited, emitted as `workflow.*` events and notified.
- APIs: `GET /workflows/inbox` (my pending approvals), `GET /workflows/instances?view=mine|all`,
  `GET /workflows/instances/:id` (steps, history, `allowedActions`),
  `POST /workflows/instances/:id/actions`, definitions CRUD (`workflow.view|manage`).

### 8.4 Notification engine (`src/core/notifications`, `/api/v1/notifications`)

```ts
registerNotificationEvent({
  key: 'leave.approved',
  label: 'Leave approved',
  defaultChannels: ['in_app', 'email'],
  mandatory: false,
});
await publish('leave.approved', { recipients: [userId], title, body, link, data, institutionId });
```

`publish` creates a `notification_jobs` row and enqueues delivery: organization
`notification_rules` (event → channels / extra recipients by role / template) override
defaults, user `notification_preferences` filter non-mandatory channels, then in-app rows,
email/SMS/WhatsApp (via the communication engine, template key = event key when present) and
push (`registerPushProvider`; FCM/APNs stubs record to `pushOutbox`) are produced. Users manage
their own notifications/preferences/devices (always self-scoped, no permission needed).

### 8.5 Communication engine (`src/core/communication`, `/api/v1/communication`)

- Providers (`communication_providers`, ORGANIZATION/GROUP/INSTITUTION scoped, `priority`
  order = fallback chain): email `smtp` (nodemailer) / `ses` / `sendgrid`, SMS `http` /
  `twilio` / `msg91`, WhatsApp `whatsapp_cloud`, and `log` for every channel (dev/tests; writes
  to `messageOutbox`). Credentials are write-only and stored via the secrets engine
  (`getSecret({ kind, purpose }).reveal()` at send time). With no provider configured, email
  uses the platform SMTP (`MAIL_DRIVER=smtp`) or `log`; other channels use `log` outside
  production.
- Templates (`message_templates` + immutable `message_template_versions`): `{{var}}`
  (HTML-escaped), `{{{raw}}}`, dotted paths; email wraps in the branded layout
  (`resolveBranding` + `brandingLogoUrl`). Modules ship defaults with
  `registerDefaultTemplate({ key, channel, subject, body, htmlBody })`; tenants override by key.
- Sending: `sendMessages({ channel, recipients, templateKey | body, variables, institutionId,
eventKey })` → `message_logs` (QUEUED) → queued delivery with per-provider rate limiting,
  retries/backoff and fallback. `sendSystemEmail({ to, templateKey, variables })` for
  security mail (invites, password reset) — it bypasses feature flags/limits and never stores
  the body (`sensitive`). `sendMessages` asserts the `communication` **and** channel features
  and calls `consumeLimit('communication_messages', n)`. The send API requires
  `message.send` in the target scope.
- Delivery callbacks: public `POST /api/v1/communication/webhooks/:providerId`, header
  `X-Erp-Signature: sha256=<hex HMAC-SHA256(raw body, provider webhook secret)>`; body
  `{ providerMessageId, status, cost?, error? }` or `{ events: [...] }` → `delivery_events` and
  the log status (QUEUED → SENT → DELIVERED | FAILED | BOUNCED).
- Campaigns: `POST /communication/campaigns` (≤ 5000 recipients) are queued in batches.
- **Invite / password-reset tokens are never returned by the API**; they are emailed. Tests
  read them from `messageOutbox` (`clearOutbox()` between tests).

### 8.6 Integration framework (`src/core/integrations`, `/api/v1/integrations`)

- **API clients**: org-scoped machine clients (optionally restricted to a group/institution)
  with hashed secrets (`clientSecret` shown once), `scopes` = permission codes allowed by
  `isApiClientScopeAllowed` (no `platform.*`, `secret.*`, `integration.*`, …), per-client rate
  limit, expiry, revoke, `api_usage` log. Token: `POST /api/v1/oauth/token`
  (`grant_type=client_credentials`, JSON/form or HTTP Basic, optional narrower `scope`) →
  short-lived bearer whose principal has **only** the granted scopes within the client's
  hierarchy scope; all existing `requirePermission`/`scopeWhere` checks apply unchanged.
- **Outbound webhooks**: subscriptions (`events` patterns like `employee.*`, HTTPS URL, signing
  secret stored via secrets) receive matching domain events. Delivery headers:
  `x-erp-event`, `x-erp-delivery`, `x-erp-timestamp`,
  `x-erp-signature: t=<ts>,v1=<hex HMAC-SHA256(secret, "<ts>.<body>")>`. Failures retry with
  backoff (6 attempts) and every attempt is recorded in `webhook_events`; deliveries can be
  replayed. Private/loopback URLs are rejected unless `WEBHOOK_ALLOW_INSECURE` (non-prod).
- **Integration credentials** (`integration_credentials`): third-party config + secret;
  modules call `getIntegrationCredential({ provider, name?, institutionId?, purpose })` →
  `{ config, secret }` and `secret.reveal()` only at use.

### 8.7 Permissions, features, env

New permissions: `workflow.view|manage`, `notification.manage`,
`communication.view|manage`, `integration.view|manage` (sending uses the existing
`message.send`) (granted to org/group/institution
admins per their scope). Feature keys: `communication`, `email`, `sms`, `whatsapp`; limit key
`communication_messages`. Env: `QUEUE_DRIVER`, `QUEUE_CONCURRENCY`, `RATE_LIMIT_STORE`,
`APP_PUBLIC_URL`, `API_PUBLIC_URL`, `WEBHOOK_ALLOW_INSECURE` (see `.env.example`).

### 8.8 Rules for later layers

1. Approvals go through `registerWorkflowEntity` + `submitWorkflow`; never build ad-hoc
   approval tables. Side effects belong in `onApproved/onRejected`.
2. User-facing alerts use `publish(eventKey, …)` with a registered notification event —
   never send email/SMS directly from a module for notifications.
3. Outbound messages use `sendMessages`/templates; never instantiate transports or read
   provider credentials yourself.
4. Emit a domain event (`registerEventType` + `emit`) for every significant state change;
   webhooks, notifications and workflows subscribe to it.
5. Background work uses `defineJob`/`enqueue` with `organizationId` in the payload; register
   jobs from a module imported by `engines.ts`.

## 9. HR employee master (Layer 6)

Module: `apps/api/src/modules/employees` (routes under `/api/v1/employees` and
`/api/v1/designations`), registered from `employees.registrations.ts` which is imported by
`src/engines.ts`. Every route is behind `requireFeature('hr')`. Shared zod schemas / DTOs live
in `@erp/shared` (`schemas/hr.ts`, `types/hr.ts`).

### 9.1 Data model

| Table                                                                    | Purpose                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `employees`                                                              | Current assignment (denormalized `groupId/institutionId/campusId/departmentId`, `designationId`, `reportingManagerId`), `employeeCode` (unique per org), `employmentType` (TEACHING / NON_TEACHING / CONTRACT / VISITING), `status` (DRAFT → ONBOARDING → ACTIVE → ON_NOTICE → EXITED), joining / probation / confirmation / resignation / exit dates, optional `userId`. |
| `employee_profiles`                                                      | Personal fields (`employeePersonalSchema`: contacts, addresses, family, qualifications, experience as JSON) + envelope-encrypted `sensitive*` columns + `sensitiveMasked` + PAN / Aadhaar blind indexes (`panIndex`, `aadhaarIndex`, unique per org).                                                                                                                     |
| `designations`                                                           | Position master; org-wide, group-level or institution-level.                                                                                                                                                                                                                                                                                                              |
| `employee_positions`, `employee_departments`, `employee_reporting_lines` | **Effective-dated history** (`effectiveFrom`, `effectiveTo` null = open). Departments carry `isPrimary` (secondary departments are extra open rows).                                                                                                                                                                                                                      |
| `employee_movements`                                                     | Transfer / promotion / designation / department / reporting change requests (PENDING_APPROVAL → SCHEDULED → APPLIED, or REJECTED / CANCELLED). Transfers stay inside the employee's organization/group.                                                                                                                                                                   |
| `employee_salary_history`                                                | Immutable salary revisions (DB triggers reject UPDATE / DELETE).                                                                                                                                                                                                                                                                                                          |
| `employee_checklist_items`                                               | Onboarding / exit checklist (PENDING / DONE / WAIVED).                                                                                                                                                                                                                                                                                                                    |
| `employee_profile_change_requests`                                       | Self-service change requests.                                                                                                                                                                                                                                                                                                                                             |
| `employee_code_sequences`                                                | Per-institution (or org default) numbering: `prefix + zero-padded nextNumber`.                                                                                                                                                                                                                                                                                            |

History rows are never rewritten when an employee moves: the open row is closed
(`effectiveTo = effectiveFrom(new) - 1 day`) and a new row is opened, so historical rows keep
the **old** institution / department ids (acceptance 8-9). Dates are `@db.Date`, exchanged as
`YYYY-MM-DD`.

### 9.2 Lookup helpers for later layers

```ts
import { employeeAssignmentAsOf, employeeIdsForUser } from '../employees/employees.assignment';
import { salaryAsOf } from '../employees/employees.salary';

await employeeAssignmentAsOf(employeeId, '2026-03-31');
// → { groupId, institutionId, campusId, departmentId, secondaryDepartmentIds, designationId,
//     employmentType, reportingManagerId, asOf } | null (not employed that day)
await salaryAsOf(employeeId, '2026-03-31'); // latest revision with effectiveFrom ≤ date | null
await employeeIdsForUser(userId); // employees linked to a login (normally 0/1)
```

- Use `employeeAssignmentAsOf` (not the denormalized `employees` columns) whenever a date
  matters: attendance/leave approver routing for a past day, payroll institution attribution
  for a period that spans a transfer.
- Authorization: load with `loadVisibleEmployee(id)` / `loadEmployeeFor(id, permission)` from
  `employees.service.ts`; they authorize against the employee's current hierarchy
  (`hierarchyResource('employee', …)`), so Group HR (`group_hr` at a group) sees all
  institutions in the group and `hr_manager` at an institution sees only that institution.

### 9.3 Salary history extension points (Layer 8)

`employee_salary_history` rows carry `effectiveFrom`, `annualCtc`, `currency`, `amounts`
(free-form `{ component: monthlyAmount }` JSON), nullable `salaryStructureId` (string ref —
payroll attaches its structure id), `revisionReason`, `previousId` (chain to the prior revision).
Rows are immutable; a correction is a new revision. Create through
`POST /employees/:id/salary` (`salary.update`; emits `employee.salary_revised`).
Payroll should resolve the structure via `salaryAsOf()` and must not edit history rows.

### 9.4 Lifecycle, workflow & hooks

- Lifecycle endpoints: `POST /employees/:id/{onboard,activate,confirm,resign,withdraw-resignation,exit,rehire}`
  (`employee.lifecycle`). Creating (and rehiring) an employee consumes the `employees` limit
  (`withLimit('employees', 1, …)`); deleting a draft or exiting releases it;
  `registerUsageSource('employees', …)` counts non-exited employees.
- Checklists: `registerChecklistHook(kind, { key, title })` / `registerExitChecklistHook(...)`
  add items to every new ONBOARDING / EXIT checklist (e.g. a future assets module registers
  `asset_recovery` and calls `completeChecklistItem` when assets are returned).
- Workflow entities: `employee_transfer` (movements) and `employee_profile_change`
  (self-service). When no ACTIVE definition exists the request auto-applies. Future-dated
  approved movements become SCHEDULED and are applied by the daily job
  `hr.apply_scheduled_movements`.
- `registerReportingManagerResolver(reportingManagerUserIds)`: `levels` = how many managers
  up the CURRENT chain contribute approvers (1 = direct manager). Managers without a user or
  EXITED are skipped but still count as a level. Layer 7 leave approvals get this for free via
  the `reporting_manager` approver type.
- Engine change: workflow `onApproved` now receives `ref.comment` (the final approver's
  comment); modules store it as `decidedComment`.

### 9.5 Sensitive fields

PAN / Aadhaar / UAN / ESIC / PF number and bank account are sealed together as one JSON blob
with `encryptFields(orgId, 'employee:<id>', values)` (`core/secrets/field-encryption.ts`,
envelope encryption via the Layer 3 key provider, AAD-bound to the employee). `sensitiveMasked` is stored alongside and
is all APIs ever return. `POST /employees/:id/sensitive/reveal` (`employee.view_sensitive`,
not granted to institution admins by default) decrypts and writes an `employee.sensitive_view`
audit row. Duplicate PAN / Aadhaar checks use `blindIndex` (HMAC) columns. Audit diffs redact
the `sensitive` key. Payroll (Layer 8) must use `decryptSensitive()` server-side for bank
transfer files and never persist clear values.

### 9.6 Events, notifications, documents, PDFs, jobs

- Events (all webhook-deliverable): `employee.created|updated|deleted|activated|confirmed|resigned|exited|rehired|transferred|promoted|reassigned|salary_revised`.
- Notifications: `employee.joined`, `employee.transferred`, `employee.exiting`,
  `employee.exited`, `employee.profile_change_decided`.
- Document owner type `employee`: HR in scope via `document.*` on the employee's hierarchy;
  the linked user (SELF_SERVICE, `document.view_own`) can view/download their own documents.
- PDF templates `hr_offer_letter`, `hr_experience_letter`, `hr_relieving_letter` (branded);
  `POST /employees/:id/letters` generates and stores them as employee documents.
- Bulk import: `POST /employees/import` (multipart `file`, `dryRun`) enqueues
  `hr.employee_import`; `GET /employees/import/:jobId` returns the validation report.
  `GET /employees/export` streams CSV (`employee.export`).
- Self-service: `GET /employees/me` (masked), `POST /employees/me/change-requests` (only
  `SELF_SERVICE_PROFILE_FIELDS`).

### 9.7 Rules for later layers

1. Reference employees by `employeeId`; never copy assignment fields into your own tables
   without also storing the effective date they were taken from.
2. Resolve "where/what was the employee on date D" via `employeeAssignmentAsOf`, salary via
   `salaryAsOf`.
3. Never read the `sensitive*` ciphertext columns directly; use `decryptSensitive()` and audit the access.
4. Add exit/onboarding steps through `registerChecklistHook`, not by editing lifecycle code.
5. Only act on employees in status ACTIVE / ON_NOTICE (ONBOARDING for joining-day flows).

### 9.8 Company mode, employee types, department roles and face punch

- **Organization kind.** `Organization.kind` is `EDUCATION` (default) or `COMPANY`. It is set by the
  platform admin (create / edit organization) and exposed on `/me`. The web `useTerms()` helper
  (`apps/web/src/lib/terms.ts`) and `visibleMenu(items, can, hasFeature, kind)` use it to relabel
  Group → "Head office" and Institution → "Company", hide campus fields, and title the app
  "HRMS & Payroll". Institution types add `COMPANY` and `BRANCH`.
- **Employee types.** `EmployeeType` (org-level, `/employee-types`, `designation.view|manage`) is a
  custom label mapped to a built-in `employmentType` category. Creating an employee with
  `employeeTypeId` derives `employmentType`. A type in use cannot change category or be deleted
  (409).
- **Department roles.** `Designation.departmentId` (optional) ties a designation to a department of
  the same institution (422 otherwise); `GET /designations?departmentId=` returns that department's
  roles plus unscoped ones. The HR → Departments page manages departments and their roles.
- **Profile photo.** `POST /employees/me/photo` and `/employees/:id/photo` (multipart `file` +
  optional `faceDescriptor` JSON of 128 numbers) store the photo as an `employee` document
  (`Employee.photoDocumentId`) and the face descriptor (`Employee.faceDescriptor`).
  `GET …/photo-url` returns a signed URL; `GET /employees/me/face` returns the reference descriptor.
- **Selfie punch.** When `AttendancePolicy.requireFaceMatch` is on, `POST /attendance/me/punch`
  must be multipart with a selfie `file` and `faceDescriptor` (400 `SELFIE_REQUIRED`). The server
  compares Euclidean distance with the stored descriptor (threshold 0.5): no reference →
  409 `PROFILE_PHOTO_REQUIRED`, mismatch → 422 `FACE_MISMATCH`. The selfie is stored as a document
  (`AttendancePunch.selfieDocumentId`, `faceDistance`). Descriptors are computed in the browser with
  `@vladmandic/face-api` (models in `apps/web/public/models`). There is **no liveness detection**,
  so a printed photo can pass; treat this as a deterrent, not strong biometric proof.
  Browsers expose the camera only on HTTPS or localhost; for phones on the LAN run the web dev
  server with `DEV_HTTPS=1` (self-signed certificate, binds all interfaces).
- **Dashboard highlights.** `GET /employees/highlights` (`EmployeeHighlightsDto`) feeds the
  employee, HR, company and head-office dashboards: upcoming holidays (own calendar chain, else
  all visible), own upcoming leave, approved team leave today/upcoming, new joiners (±30 days),
  work anniversaries and birthdays (next 30 days, no birth year). Users with `employee.view`
  see their permission scope; other employees see colleagues of their own company only.

## 10. Attendance, leave, holidays & shifts (Layer 7)

Modules `holidays`, `shifts`, `attendance` and `leave` (all under `/api/v1`, mounted with
`requireFeature('hr')`; no new feature keys). Registrations (workflow entities, events,
notification events, jobs) live in `src/modules/attendance/attendance.registrations.ts`, imported
by `engines.ts`. Dates are `YYYY-MM-DD` strings in the organization's local calendar; minute
values are minutes after midnight.

### 10.1 Data model

| Model                             | Purpose                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HolidayCalendar` / `Holiday`     | Per-year calendar at scope ORGANIZATION / GROUP / INSTITUTION / CAMPUS with optional `weeklyOffs` pattern; holidays typed PUBLIC / RESTRICTED / OPTIONAL; `removed=true` suppresses an inherited holiday.                                                                                  |
| `Shift` / `ShiftAssignment`       | Shift per institution (start/end minute, cross-midnight, grace in/out, half-day & full-day minimum minutes, break, overtime threshold, weekly offs, `isDefault`). Assignments are effective-dated per employee **or** department, optional rotation (`rotationShiftIds`, `rotationDays`).  |
| `AttendancePunch`                 | Raw punches: source WEB / MOBILE / BIOMETRIC / API, direction, device id, geo (lat/lng/accuracy), import job id. Never mutated by computation.                                                                                                                                             |
| `AttendanceRecord`                | One derived row per employee per date: status (PRESENT, ABSENT, HALF_DAY, LATE, ON_LEAVE, HOLIDAY, WEEKLY_OFF, ON_DUTY, LOP), first in / last out, worked / late / early-exit / overtime minutes, shift + institution as of that date, leave link, `manualOverride`.                       |
| `AttendanceRegularization`        | Employee correction requests (workflow `attendance_regularization`).                                                                                                                                                                                                                       |
| `AttendancePeriodLock`            | LOCKED / UNLOCKED per institution + period, with lock/unlock actor + reason.                                                                                                                                                                                                               |
| `AttendancePolicy`                | Per institution: `lateMarksPerHalfDay`, `absentIsLop`, etc.                                                                                                                                                                                                                                |
| `AttendanceImportJob`             | Biometric CSV / API import batches with per-row errors.                                                                                                                                                                                                                                    |
| `LeaveType`                       | Paid/unpaid, half-day allowed, gender & employment-type eligibility, documents required (after N days), sandwich rule, encashable, carry-forward cap, max consecutive days.                                                                                                                |
| `LeavePolicy` / `LeavePolicyRule` | Per institution, group or org-wide and optional employment type; rule per leave type: accrual frequency (MONTHLY / QUARTERLY / YEARLY / NONE), amount, joining pro-rata, carry-forward cap, encash cap, plus optional application rules (§10.5). Most specific policy wins (`pickPolicy`). |
| `LeaveLedgerEntry`                | Append-only ledger: ACCRUAL, CONSUMPTION, ADJUSTMENT, CARRY_FORWARD, LAPSE, ENCASHMENT, REVERSAL. **Balance is always derived** from the ledger (sum of entries effective in the leave year up to the as-of date).                                                                         |
| `LeaveRequest`                    | Leave application with half-day flags, computed day breakdown, workflow `leave_request`.                                                                                                                                                                                                   |

### 10.2 Holiday resolution

`HolidayResolver` (`holidays/holidays.resolver.ts`): for a date the **most specific** calendar
(CAMPUS → INSTITUTION → GROUP → ORGANIZATION) that has an entry for the date wins (so an
institution can override or remove a group/org holiday). The weekly-off pattern comes from the most
specific calendar defining one (default: every Sunday). Weekly-off rules are `{ weekday, weeks? }`,
e.g. Sunday + 2nd/4th Saturday = `[{weekday:0},{weekday:6,weeks:[2,4]}]`. The employee's calendar is
chosen **per date** from `employeeAssignmentAsOf`, so a transferred employee uses the old
institution's calendar before the transfer and the new one after.
`GET /holidays/resolve?employeeId&from&to` exposes this.

### 10.3 Shift resolution

`shifts/shifts.resolver.ts`, per employee + date: (1) the employee's own active assignment (latest
`effectiveFrom`), (2) the assignment of the as-of department, (3) the institution default shift,
(4) none → 4 h / 8 h half / full-day thresholds, no lateness. Rotations cycle every `rotationDays`
from `effectiveFrom`. Cross-midnight shifts (end ≤ start) attribute punches up to 4 h after shift
end to the shift's start date. A shift's own `weeklyOffs` override the calendar pattern.

### 10.4 Daily computation, regularization, locks

`computeAttendance(employeeIds, from, to)` (`attendance.compute.ts`) combines punches + shift +
holidays + approved leave + approved regularizations into `AttendanceRecord`s via the pure
`computeDay`. Precedence: full-day leave → holiday / weekly off → punches (late if first-in >
start + grace; half day below the full-day minimum; absent below the half-day minimum). Only
ACTIVE / ON_NOTICE (and EXITED, up to their exit date) employees are computed; dates outside
employment are skipped. Records with `manualOverride` and dates in a LOCKED period are never
recomputed. Triggers: punch / import (punched days), leave decisions, regularization approval,
`POST /attendance/recompute`, and the recurring `attendance.daily_recompute` job (last 3 days,
`forEachActiveOrganization`).

Regularizations go through `submitWorkflow('attendance_regularization')` (reporting-manager
approval is possible via the workflow definition; auto-approves when no definition exists). On
approval the day is recomputed with the corrected in/out times or status.

**Period lock:** `POST /attendance/locks` (`attendance.lock`) locks an institution + period. Any
punch, override, recompute or regularization touching a locked date fails with
`409 PERIOD_LOCKED`. `POST /attendance/locks/:id/unlock` requires `attendance.unlock` and a reason
and is audited (`attendance.period_unlock`). Payroll should lock the period before finalizing.

### 10.5 Leave

- **Day calculation** (`calculateLeaveDays`): working days count 1 (0.5 for the start/end half);
  holidays / weekly offs count 0 unless the sandwich mode covers their kind and they lie between
  leave days. Uses the employee's as-of calendar and shift per date. `POST /leave/preview` returns
  the breakdown, the effective rules (+ hints) and any rule violations.
- **Policy rules** (`leave.rules.ts`): the applicable policy is the most specific ACTIVE one —
  institution+employment type > institution > group+type > group > org+type > org. Its rule for
  the leave type may override (null = inherit): sandwich mode (NONE / WEEKLY_OFFS / HOLIDAYS /
  BOTH; default from `LeaveType.sandwichRule` → BOTH), sandwich only from N working days, sandwich
  across adjacent requests (Fri + Mon: the gap extends the new request), minimum notice + notice
  tiers by leave length (strictest matching applies), max days ahead, past-dated allowed / window,
  min / max days per request, max requests / days per month, not clubbable with (type codes).
  Violations return 422 (`LEAVE_NOTICE_REQUIRED`, `LEAVE_ADVANCE_LIMIT`, …, details.violations);
  a caller with `leave.manage` on the employee may pass `ruleOverrideReason` (audited as
  `leave.rules_override`).
- **Validation:** eligibility (gender, employment type), half-day allowed, max consecutive days,
  overlap with pending/approved requests, sufficient balance for paid types (unpaid types never
  check balance), documents if required, employee ACTIVE / ON_NOTICE.
- **Workflow** `leave_request` (reporting manager approval via definitions; auto-approve when none).
  Approval posts a CONSUMPTION ledger entry for paid types and recomputes attendance. Cancel /
  withdraw (`POST /leave/requests/:id/cancel`) posts a REVERSAL entry and recomputes.
- **Accrual** (`runAccrual`, job `leave.daily_accrual`, also `POST /leave/accrual/run`):
  idempotent per period key; joining pro-rata in the joining period.
- **Year-end** (`runYearEnd`, `POST /leave/year-end`): per type, encash (capped) and lapse dated
  Dec 31 and carry forward (capped) dated Jan 1 of the next year.

### 10.6 Events, notifications, jobs

Events: `attendance.regularization_requested`, `attendance.regularized`,
`attendance.period_locked`, `attendance.period_unlocked`, `leave.applied`, `leave.approved`,
`leave.rejected`, `leave.cancelled`. Notification events: `leave.applied`, `leave.approved`,
`leave.rejected`, `leave.cancelled`, `attendance.regularization_decided`. Jobs:
`attendance.daily_recompute`, `leave.daily_accrual`, recurring `time_office.daily.schedule`.

### 10.7 Payroll feed (contract for Layer 8)

```ts
// apps/api/src/modules/attendance/attendance.summary.ts
attendanceSummaryForPeriod(
  target: string /* employeeId */ | { employeeIds: string[] } | { institutionId: string; departmentId?: string },
  periodStart: 'YYYY-MM-DD',
  periodEnd: 'YYYY-MM-DD',
): Promise<AttendanceSummaryDto[]>   // type from @erp/shared
```

No authorization (callers run in a tenant context and decide access). Recomputes the non-locked
days first, so it is always consistent with punches / leave / holidays. HTTP:
`GET /attendance/summary?from&to&(employeeId|institutionId[&departmentId])` (`attendance.view`,
scoped). Per employee it returns:

| Field                                                             | Meaning                                                                                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendarDays`, `employedDays`                                    | Days in period / days within employment (join → exit).                                                                                                                          |
| `pendingDays`                                                     | Employed days with no record yet (should be 0 after recompute).                                                                                                                 |
| `presentDays`, `onDutyDays`                                       | Present days (LATE and ON_DUTY count as present; HALF_DAY counts 0.5); `onDutyDays` is the ON_DUTY subset.                                                                      |
| `paidLeaveDays`, `paidLeaveByType[{leaveTypeId, code, days}]`     | Approved paid leave.                                                                                                                                                            |
| `unpaidLeaveDays`, `absentDays`                                   | Approved unpaid leave; absences (incl. the absent half of half days).                                                                                                           |
| `holidays`, `weeklyOffs`                                          | Per as-of calendar / shift.                                                                                                                                                     |
| `lateCount`, `earlyExitCount`, `overtimeMinutes`, `overtimeHours` | From computed records.                                                                                                                                                          |
| `lateDeductionDays`                                               | `floor(lateCount / lateMarksPerHalfDay) × 0.5`, capped at present days (0 when the policy has no rule). Policy = attendance policy of the institution on the last employed day. |
| `lopDays`                                                         | `unpaidLeaveDays + (absentIsLop ? absentDays : 0) + lateDeductionDays`.                                                                                                         |
| `payableDays`                                                     | `presentDays + paidLeaveDays + holidays + weeklyOffs + (absentIsLop ? 0 : absentDays) − lateDeductionDays`.                                                                     |
| `locked`                                                          | Every employed day of the period is in a LOCKED period.                                                                                                                         |
| `institutionDays[{institutionId, days}]`                          | Split per as-of institution (transfers mid-period).                                                                                                                             |

`payableDays + lopDays = employedDays` (when `pendingDays = 0`). Pro-ration for joiners / leavers
should use `employedDays` vs `calendarDays`.

### 10.8 Permissions, roles, web

Permissions: `holiday.view|manage`, `shift.view|manage`,
`attendance.view|manage|import|lock|unlock`, `attendance.view_own|punch_own|regularize_own`,
`leave.view|manage|apply|adjust`, `leave.view_own|apply_own`. HR roles get management permissions;
the employee role gets the `*_own` set. Web: `/hr/attendance`, `/hr/leave`, `/hr/leave-setup`,
`/hr/shifts`, `/hr/holidays`; self-service `/employee/attendance` (punch, calendar, regularize)
and `/employee/leave` (balances, apply with live preview, cancel).

### 10.9 Rules for later layers

1. Payroll must read attendance only through `attendanceSummaryForPeriod`; never re-derive LOP.
2. Lock the attendance period before finalizing payroll; edits after that need explicit unlock.
3. Leave encashment payouts read ENCASHMENT ledger entries; never mutate ledger rows (append
   ADJUSTMENT / REVERSAL instead).
4. Resolve holidays / shifts with the resolvers (per date, per as-of assignment), never by
   institution id alone.

## 11. Payroll rule engine (Layer 8)

Module `apps/api/src/modules/payroll` (`/api/v1/payroll`, `requireFeature('payroll')`, which
depends on `hr`). Registrations (workflows, events, notifications, jobs, PDF templates) live in
`payroll.registrations.ts`, imported by `engines.ts`.

### 11.1 Data model

| Table                                                | Purpose                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `salary_components`                                  | Component master per organization (`institutionId = null`) or institution: type (EARNING, DEDUCTION, EMPLOYER_CONTRIBUTION, REIMBURSEMENT, STATUTORY), calc type (FIXED, PERCENTAGE of CTC/BASIC/GROSS/component, FORMULA, SLAB, STATUTORY), taxable, pro-rated, rounding, display order, payslip visibility |
| `salary_rules`                                       | Effective-dated, versioned calculation overrides (org or institution, optional condition formula). Immutable (trigger) — add a new version instead                                                                                                                                                           |
| `salary_structures` / `salary_structure_versions`    | Templates of component lines per institution / grade / employment type; versions are effective-dated and immutable                                                                                                                                                                                           |
| `payroll_settings`, `statutory_rule_packs`           | Per-institution statutory switches + state; data-driven PF/ESI/PT/TDS/LWF packs versioned by financial year (built-in defaults, custom overrides)                                                                                                                                                            |
| `employee_salaries`                                  | Assignment = one `employee_salary_history` row (Layer 6, immutable) + structure, CTC, FIXED overrides, tax regime                                                                                                                                                                                            |
| `salary_revisions`                                   | Revision requests (workflow `salary_revision`), with arrears for back-dated revisions                                                                                                                                                                                                                        |
| `payroll_batches`, `payroll_runs`                    | Group batch (§53) → one run per institution and period; runs carry `revision` / `previousRunId`                                                                                                                                                                                                              |
| `payroll_run_employees`, `payroll_items`             | Per-employee result (days, totals, calc trace, warnings) and per-component line items                                                                                                                                                                                                                        |
| `payroll_adjustments`                                | One-time earnings / deductions / arrears / loan EMIs / reimbursements / leave encashment                                                                                                                                                                                                                     |
| `payroll_payments`                                   | Net pay per employee, bank file export, payment status                                                                                                                                                                                                                                                       |
| `payslips`, `form16_records`                         | Documents (category `payroll`) stored via the document engine                                                                                                                                                                                                                                                |
| `loans`, `loan_installments`, `reimbursement_claims` | Auto-deducted EMIs; claims via workflow `reimbursement_claim` feeding adjustments                                                                                                                                                                                                                            |

### 11.2 Formula evaluator & dependency graph

`formula.ts` is a hand-written tokenizer + recursive-descent parser (no `eval` / `Function`):
numbers, variables, `+ - * / %`, comparisons, `&& || !`, `?:` and the whitelisted functions
`min max round floor ceil abs if`. Inputs are length-limited and identifiers are validated, so
property access / calls to anything else are rejected. Variables: `CTC` (monthly), `ANNUAL_CTC`,
`GROSS` (full-rate earnings), component codes, `PAYABLE_DAYS`, `CALENDAR_DAYS`, `LOP_DAYS`,
`OT_HOURS`, `PRESENT_DAYS`, `EMPLOYED_DAYS`, `ENCASHMENT_DAYS`, `FACTOR`, `EMPLOYMENT_TYPE`.
`engine.ts` builds the dependency graph across components (percentage bases, formula variables,
slab bases), orders it topologically and rejects cycles / unknown references with
`422 INVALID_SALARY_GRAPH` — at save time (components, rules, structure versions) and at compute
time. Precedence of a component's calculation: structure line → institution rule → org rule →
component default.

### 11.3 Computation

`computeEmployeePayroll` (in `payroll.compute.ts`) resolves `employeeAssignmentAsOf`,
`salaryAsOf` → `employee_salaries`, the structure version effective at period end, rules and
statutory packs, then reads attendance **only** through `attendanceSummaryForPeriod`. Pro-rated
components use `payableDays / calendarDays`; mid-period transfers are split by
`institutionDays` so each institution's run pays its share; joiners / leavers use
`employedDays`. Statutory (`statutory.ts`): PF 12% of basic capped at the wage ceiling (configurable),
ESI by gross threshold, PT by state slab table, TDS (old/new regime annualised estimate,
declarations placeholder), optional LWF. Every amount produces a calc-trace entry and a
human-readable explanation.

### 11.4 Run lifecycle

`DRAFT → (attendance lock check) → COMPUTING → COMPUTED → PENDING_APPROVAL → APPROVED →
FINALIZED`, plus `CANCELLED` and `REOPENED`. Compute fans out `payroll.compute_batch` jobs (50
employees per job); recompute is allowed only before submission. Submission starts the
`payroll_run` workflow when a definition exists, otherwise `POST /runs/:id/decision` applies
maker-checker (the preparer cannot approve unless an org owner). Finalize creates
`payroll_payments`, marks loan installments deducted and enqueues
`payroll.generate_payslips` (branded PDF via `renderPdfTemplate` + `resolveBranding`, attached
with `documentEngine.attach({ authorization: 'caller' })`, employees notified).

**Immutability (acceptance 14–15).** Locked runs are rejected by the service (409) **and** by
MySQL triggers (`payroll_runs_guard_*`, `payroll_items_guard_*`, `payroll_run_employees_guard_*`,
`payroll_adjustments_guard_*`, `payroll_payments_*`). The only path out of FINALIZED is
`POST /runs/:id/reopen` (`payroll.reopen`, reason required, audited, event
`payroll.run_reopened`): it marks the run REOPENED and creates a new DRAFT revision; the
finalized data and payslips remain (payslips are superseded on the next finalize).

### 11.5 Revisions, arrears, loans, reimbursements

Revisions (workflow `salary_revision`) append salary history; a back-dated revision
recomputes every FINALIZED run on/after `effectiveFrom` with the new salary and creates
ARREAR adjustments for the differences in the next run. Loans generate installments deducted
automatically while the run is computed; approved reimbursement claims become adjustments.

### 11.6 Reports, events, web

Reports (`payroll.report`): register, component summary, statutory PF/ESI/PT/TDS/LWF and group
consolidated summary (scoped to institutions where the caller holds `payroll.report`, so
`group_finance` / `group_hr` see their group), each as JSON / CSV / Excel (exceljs) / PDF.
Events / webhooks: `payroll.run_computed|run_approved|run_finalized|run_reopened`,
`payslip.published`. Permissions: `payroll.view|process|manage|approve|lock|reopen|report|disburse`,
`salary.view|update`, `form16.manage`, `payroll.view_own`, `reimbursement.claim_own`; roles
`payroll_manager`, `finance_manager`, `group_finance` (+ reopen), employee self-service.
Web: `/hr/payroll/{runs,components,structures,salary,payslips}`, run wizard
`/hr/payroll/runs/:id` (compute, review with per-employee trace, adjustments, approve,
finalize, payments, reports, reopen), `/employee/payslips` (payslips + Form 16),
`/group/payroll` (consolidated summary).

### 11.7 Rules for later layers

1. Never write `payroll_*` rows of a locked run; reopen creates a new revision.
2. Add statutory changes as new `statutory_rule_packs` versions (per financial year), not code edits.
3. Calculation changes are new rule / structure versions — never update existing versions.

## 12. Frontend (apps/web)

- Vue 3 `<script setup lang="ts">`, Pinia stores, Vue Router, Vuetify 3 (auto-import).
- Layout shells: `PlatformLayout`, `GroupLayout`, `InstitutionLayout`, `EmployeeLayout`
  (Student/Parent/Teacher layouts come later). Sidebar menus are data-driven
  (`src/navigation/menus.ts`) and filtered by the permission codes from `GET /api/v1/me`.
- Auth: `useAuthStore` (`src/stores/auth.ts`) keeps the access token in memory and refreshes
  via the httpOnly cookie (single-flight; the client retries once on `TOKEN_EXPIRED`).
  Routes declare `meta.permission`; the global guard (`navigation/guard.ts`) redirects to
  `/login` or `/forbidden`. Login page handles organization selection and the MFA step.
- API calls go through `src/api/client.ts` (`apiFetch`). The client never sends tenant ids;
  the server is always the authority on tenant, permissions and scopes.
- Shared DTO types/schemas come from `@erp/shared`.
- Layer 5 UI: `NotificationBell` in the app bar (unread count polled every 60 s),
  `/<layout>/notifications` (list + channel preferences), `/<layout>/approvals` (inbox, my
  requests, instance history + actions), `/group|institution/communication` (providers,
  templates, message log) and `/group/integrations` (API clients, webhooks, deliveries/replay).

## 13. Testing & quality

- **Vitest** everywhere; **supertest** for HTTP. API has two projects:
  - `unit` (`src/**/*.test.ts`) — no database required.
  - `integration` (`test/**/*.int.test.ts`) — runs against `TEST_DATABASE_URL`, which is
    **reset** (`prisma migrate reset`) before the run. Skipped locally when unset; required in CI.
- Every module must have isolation tests proving another tenant cannot read/write its data.
- **ESLint** (flat config, typescript-eslint, eslint-plugin-vue) + **Prettier**.
- **CI** (GitHub Actions): install → lint → format check → typecheck → test (MySQL 8.4
  service container) → build.

## 14. Foundation stack

1. Scaffold + multi-tenancy engine + group/institution hierarchy
2. Auth (JWT access/refresh, TOTP MFA, sessions, login history) + RBAC + scope authz + users + audit
3. Module licensing / subscriptions + branding + secret management
4. Cloud file storage + document management
5. Queue + workflow + notification + communication engines + integration framework
6. HR employee master
7. Attendance / leave / holiday / shift
8. Payroll rule engine

## 15. Students, guardians and admissions

Module `apps/api/src/modules/students` is mounted under `/api/v1/students` and `/api/v1/admissions` with `requireFeature('education')`. It follows the same tenant rules as HR: every student, enrollment, guardian link and admission application carries `organizationId` plus hierarchy FKs derived server-side from the class section / program; services use only `tenantDb()` / `withTenant()`, validate parent references through the tenant client, and audit every mutation.

Data model: `Student` (unique `admissionNo` per organization, optional linked student login), `StudentEnrollment` effective-dated history, `Guardian` and `StudentGuardian` sibling-safe parent links, `AdmissionApplication` with staff-managed status transitions and enrollment that creates the student, guardian link and initial enrollment. Student creation consumes the `students` license limit; soft delete releases it. Registrations live in `students.registrations.ts`: domain events, usage recount, and document owner types for `student` and `admission_application`.

Permissions: `student.view|create|update|delete|import|view_own|lifecycle`, `admission.view|manage`, `guardian.manage`, and `ward.view`. Academic administrators and registrars manage students/admissions in scope; teachers view students; student and parent roles get only self-service / ward access. Web pages live in `apps/web/src/pages/students` and the `/portal` layout.

## 16. AI gateway and assistant

The core engine `apps/api/src/core/ai` is provider-agnostic. Modules call `runAi` / `runAiPrompt` and never talk to a vendor SDK directly.

- **Providers.** `openai` is an OpenAI Chat Completions adapter (`fetch`, tool calling) that works with OpenAI, Azure OpenAI and any OpenAI-compatible endpoint. Credentials come **only** from `getSecret({ kind: 'ai.openai', purpose })` (value = API key; metadata `{ model?, baseUrl?, apiVersion? }`); the URL goes through `assertSafeOutboundUrl`. `mock` is deterministic and answers from prompt-specific mocks / tool routing. It is chosen automatically when settings select `mock`, when no `ai.openai` secret exists, when `dataSharing` is off, and in tests (`setAiProviderOverride`).
- **Governance (every call).** The call is refused unless:
  - the `ai` feature is enabled;
  - org settings (`ai_settings`: enabled, provider, default model, max tokens, temperature, enabled features, `dataSharing`) allow the feature.

  `maxTokensPerRequest` is reserved via `consumeLimit('ai_tokens', n)` before the call; the unused part is released afterwards and the whole reservation on failure. An `ai_usage_logs` row records user, feature, prompt key, provider/model, prompt/completion tokens, latency, status (`OK|ERROR|LIMITED`) and a **PII-redacted, truncated** prompt preview (`redactPii`: emails, phones, Aadhaar/PAN/IFSC/card-like ids). Secrets are never logged or returned. Settings changes are audited (`ai.settings.update`).

- **Registries.**
  - `registerAiPrompt({ key, version, system, inputSchema, mock? })` registers a versioned prompt template.
  - `registerAiTool({ name, description, parameters, permission, feature?, execute })` registers a **read-only** tool for the assistant. A tool is offered to the model only when the caller holds its permission (and feature). `execute` runs inside the caller's request context and calls the module services, so tenancy and hierarchy scope (`scopeWhere`) still apply. A tool can never read more than the user could through the UI.

The module `apps/api/src/modules/ai` (mounted at `/api/v1/ai` behind `requireFeature('ai')`) registers its prompts and tools in `ai.registrations.ts`.

Tools: `employee_search`, `employee_headcount`, `leave_balances`, `attendance_summary`, `payroll_run_totals`, `student_counts`.

Features:

- **Assistant chat.** Conversations are private per user and tenant (`ai_conversations`, `ai_messages`; deletion hard-deletes the messages).
- **Drafting** of offer/experience/relieving letters, circulars, notices and parent emails. Results can be saved as a communication template.
- **Payroll anomaly explanation.** Needs `payroll.view`. Compares a run with the previous finalized run for the same institution and flags >20% changes, joiners and leavers, LOP, errors and z-score outliers.
- **Student insight hook.** Needs `student.view`. Uses heuristic signals today; exams/attendance modules can add signals via `registerStudentInsightSource`. Student names are never sent to the model.
- **Resume / JD summarizer.** Text only.
- **Usage.** Dashboard and logs.

Permissions:

| Permission      | Allows                            | Default holders                                        |
| --------------- | --------------------------------- | ------------------------------------------------------ |
| `ai.use`        | Use the AI features               | Admins, HR, payroll, principals and self-service roles |
| `ai.manage`     | Change the AI settings            | Group admin, IT admin                                  |
| `ai.view_usage` | View the usage dashboard and logs | Group admin, IT admin                                  |

Web:

- A floating **Ask AI** panel in `AppShell`, shown when the `ai` feature is on and the user has `ai.use`.
- Pages `/group/ai` (tools), `/group/ai/settings` and `/group/ai/usage`, plus `/hr/ai`.
- A `DraftWithAiButton` in the communication template dialog and the HR letters dialog.

Demo: `node scripts/demo/seed-ai.mjs` (HTTP based, idempotent; `API_URL` env).

To use a real model:

1. In Secrets, add kind `ai.openai` with the API key as the value.
2. Optionally add metadata `{"model":"gpt-4o-mini","baseUrl":"https://…/v1","apiVersion":"…"}`.
3. In AI settings, set provider `openai` and turn on data sharing.

## 17. Library

Module `apps/api/src/modules/library` is mounted under `/api/v1/library` with `requireFeature('library')`. Every row carries `organizationId` plus `groupId`/`institutionId` (and optional `campusId`) derived server-side from the owning institution library; services use only `tenantDb()` / `withTenant()` and audit every mutation (`library_book.created`, `library_loan.issued|returned|renewed`, `library_fine.collected|waived`, …).

Data model (`// ===== Library =====` block in `schema.prisma`, migration `20261007120300_library`): `LibraryBook` (title/ISBN/authors/publisher/category/tags; item types BOOK, JOURNAL, MAGAZINE, E_RESOURCE, …; cover via the `library_book` document owner type), `LibraryCopy` (accession number `<INSTCODE>-000001` doubling as barcode, shelf/rack, status AVAILABLE/ISSUED/RESERVED/LOST/DAMAGED/WITHDRAWN), `LibraryPolicy` (per institution × member type STUDENT/EMPLOYEE: max loans, loan days, renewals, fine per day, max fine, hold days), `LibraryLoan`, `LibraryReservation` (FIFO queue per book; WAITING → READY when a copy returns, copy held as RESERVED until `expiresAt`), `LibraryFine` and `LibraryStockVerification`. Students and employees are members automatically through their enrollment / assignment institution — there is no membership table.

Circulation: `POST /issue`, `POST /return`, `POST /loans/:id/renew`, `/reservations`; fines are calculated on return (`min(daysLate × finePerDay, maxFine)`). Backdated `issuedAt`/`returnedAt` require `library.manage`. Errors: `NOT_A_MEMBER`, `LOAN_LIMIT`, `RENEWAL_LIMIT`, `LOAN_OVERDUE`, `BOOK_RESERVED` (422), `COPY_NOT_AVAILABLE`, `COPY_RESERVED` (409).

Registrations (`library.registrations.ts`): domain events `library.*`; notification events `library.due_reminder`, `library.overdue`, `library.reservation_ready`, `library.fine_assessed` published to the member (students: also guardians); recurring job `library.daily.schedule` → `library.daily_circulation` per active organization (due/overdue reminders, expiry of uncollected holds); PDF templates `library_labels` (QR barcode labels) and `library_report`.

Fees integration hook: fines live in `library_fines` with collect / waive actions. When a fees module provides student charges, it calls `registerLibraryFinePoster(poster)` (from `library.constants.ts`); new student fines are then posted to the fee account and the returned `externalChargeId` is stored on the fine.

Other endpoints: `/opac` (search, `library.view` or `library.view_own`), `/me`, `/me/reservations`, `/me/loans/:id/renew` (self-service), `/books/import` (CSV/XLSX), `/labels` (PDF), `/stock-verifications`, `/reports/:key` (`issued|overdue|most_borrowed|fines`, JSON/CSV/XLSX), `/dashboard`, `/members`.

Permissions: `library.view|manage|circulate|fine|view_own`. New default role `librarian` (library.* plus student/employee view); `institution_admin` gets library.*; `principal` gets `library.view`; student, parent and employee self-service roles get `library.view_own`. Web pages live in `apps/web/src/pages/library` (Library menu in group / institution layouts, “My library” + “Library catalogue” in `/portal` and `/employee`).

## 18. Asset management (feature `assets`)

Module: `apps/api/src/modules/assets` (routes under `/api/v1/assets`, behind
`requireFeature('assets')`). It works the same for education institutions and `COMPANY`
institutions (HR/payroll-only orgs).

**Models** (one `// ===== Assets =====` block in `schema.prisma`, migration
`20261007120500_assets`):

- `AssetCategory`: organization- or institution-scoped. Holds a kind (IT, furniture,
  lab, vehicle, AV, sports…), custom attribute definitions, depreciation (SLM/WDV,
  rate, useful life, residual %) and a tag series (prefix + next number).
- `Asset`: tag (unique per org), make/model/serial, purchase data (vendor, invoice,
  date, cost, warranty and AMC expiry), invoice document (`registerDocumentOwnerType`),
  placement (institution/campus/department + room text), condition and status
  (`IN_STOCK | ASSIGNED | UNDER_REPAIR | LOST | DISPOSED`), and service schedule.
- `AssetAssignment`: custody to an `EMPLOYEE`, `DEPARTMENT` or `LOCATION`, with an
  acknowledgement timestamp and the return condition.
- `AssetTransfer`: moves between institutions/departments through the workflow engine
  (`registerWorkflowEntity('asset_transfer')`).
- `AssetMaintenance`: repair, preventive, AMC and warranty tickets with cost and vendor.
  `IN_PROGRESS` sets the asset to `UNDER_REPAIR`; completing the ticket restores the
  previous status.
- `AssetDisposal`: write-off, sale, scrap, donation or loss, approved through the
  `asset_disposal` workflow. Approval sets the asset to `DISPOSED` or `LOST`.
- `AssetAudit` / `AssetAuditItem`: a verification snapshot. Items are scanned by tag and
  marked verified, missing or condition-mismatched. Completing the audit reports
  discrepancies.
- `InventoryItem` / `InventoryTransaction`: consumables with stock in/out/adjust and a
  reorder-level alert.

**Permissions:** `asset.view`, `asset.manage`, `asset.assign`, `asset.return`,
`asset.maintain`, `asset.dispose`, `asset.audit` and `asset.view_own`.

**Roles:**

- New system role `asset_manager` gets every `asset.*` permission except `view_own`.
- `institution_admin`, `group_admin` and `hr_manager` get view, assign and return.
- `employee` gets `asset.view_own`, for `/assets/my`: list, acknowledge and report an
  issue.

**Engine registrations** (`assets.registrations.ts`):

- Event types `asset.*` (webhook-enabled).
- Notification events: assigned, issue reported, ticket closed, transfer/disposal
  decided, audit discrepancies, inventory low, reminders.
- PDF templates: `asset_labels` (QR + barcode labels), `asset_handover`
  (acknowledgement slip) and `asset_report`.
- The `EXIT` checklist hook `asset_recovery` ("Return assigned assets") completes once
  the employee holds no open assignments.
- Recurring job `assets.reminders`: fanned out per active org, it publishes warranty, AMC
  and service-due reminders to `asset.maintain` holders.

**Reports:** `GET /assets/reports?type=register|depreciation|assignments|maintenance|disposals&format=json|csv|xlsx|pdf`.
Depreciation is computed on the fly from category settings (SLM straight-line on cost
less residual value; WDV declining balance), so there is no stored schedule.

**Web:**

- The `/assets` workspace (`AssetsLayout`) has Dashboard, Assets, Categories,
  Assignments, Maintenance, Inventory, Audit, Disposal and Reports.
- An "Assets" entry appears in the group, institution and HR menus.
- Employees get "My assets" in the employee workspace (`/employee/assets`).

**Demo:** `scripts/demo/seed-assets.mjs` (HTTP, idempotent by tag/code/SKU) seeds ABBS and
Logicmines.

## 19. Academics, timetable, student attendance and exams

Three API modules behind `requireFeature('education')`:

- `modules/academics`: `/subjects`, `/subject-allocations` (teacher allocation, class teacher, `my-classes`, `teacher-options`) and `/student-attendance`.
- `modules/timetable`: `/timetable`, covering the bell schedule, section grids, clashes, substitutions, and the teacher and own views.
- `modules/exams`: `/exams`, covering grading scales, terms, schedules, marks, compute/publish, results and report cards.

Registrations are in `academics.registrations.ts`, which is imported by `engines.ts`. Every tenant row carries `organizationId` plus hierarchy FKs (`groupId`, `institutionId`, `departmentId`). The hierarchy FKs are derived server-side from the program or class section.

Data model:

- `Subject` belongs to a program. It has a type (theory, practical or elective), credits, and max/pass marks.
- `SubjectAllocation` is unique per (section, subject) and points to a teacher user. `ClassTeacher` holds one teacher per section.
- `BellPeriod` is unique per (institution, seq) and has `isBreak`.
- `TimetableEntry` is unique per (section, day, period) and records subject, teacher and room. `TimetableSubstitution` is unique per (entry, date).
- `StudentAttendance` is unique per (student, date, periodKey). Daily attendance uses `periodKey = ''`; period-wise attendance uses the period id as `periodKey`.
- `GradingScale` stores its bands as JSON.
- `ExamTerm` moves through `DRAFT → SCHEDULED → MARKS_ENTRY → RESULTS_COMPUTED → PUBLISHED`.
- `ExamSchedule` is one paper per (term, section, subject), with `marksStatus` set to OPEN or LOCKED.
- `ExamMark` holds one mark per (schedule, student).
- `ExamResult` is unique per (term, student). It stores a subject snapshot JSON, total, %, grade, GPA, rank and pass/fail.

Rules:

- **Scope.** Teachers act only on sections they are allocated to, either as a subject teacher or as class teacher. `assertSectionActor` enforces this; a `*.manage` permission in scope overrides it. Teachers get `student_attendance.mark` and `exam.marks_entry` but not manage. Principals, academic coordinators and institution/group admins manage. Student and parent roles hold `*.view_own` and are resolved through `ownStudents()` (self or wards).
- **Timetable.** Replacing a section's grid validates periods, program subjects and teachers. It returns 409 `TIMETABLE_CLASH` (details `{clashes}`) when a teacher or room is double-booked with another section, unless `allowClashes` is set. Substitutions must match the entry weekday, and the substitute must be free in that period.
- **Attendance.** Non-managers can edit only for 3 days. Newly absent records trigger `publish('student_attendance.absent')` to the guardians' linked users. Percentage counts PRESENT/LATE as 1, HALF_DAY as 0.5, and ABSENT/LEAVE as 0 over all marked days (`attendance.logic.ts`).
- **Exams.**
  - Marks are validated against max marks. The allocated teacher can lock a paper; unlocking needs `exam.publish`.
  - Compute uses `computeStudentResult` and `rankResults` (`exams.logic.ts`, unit-tested). A subject is failed when marks are below pass marks or the student was absent. GPA is the credit-weighted mean of the band points, and ranks are competition style.
  - Publish requires computed results and every paper locked. It notifies students and guardians (`exam.results_published`).
  - Report cards are PDFs rendered with `registerPdfTemplate('report_card')` and tenant branding. They are served to staff (`/exams/terms/:id/report-card/:studentId`) and, once published, to the student or parent (`/exams/my-results/:termId/report-card/:studentId`).

Web: Academics pages are under `apps/web/src/pages/academics`. They include Subjects, Allocation, Timetable, Student attendance, Exams, Marks entry, Results, Report cards, and My classes for teachers. Portal pages (Timetable, Attendance, Results) are under `pages/academics/portal`. Demo data comes from `scripts/demo/seed-academics_exams.mjs`.

## 20. Fees and finance (accounts)

Modules `apps/api/src/modules/fees` (mounted at `/api/v1/fees`) and `apps/api/src/modules/finance` (`/api/v1/finance`) sit behind `requireFeature('finance')`. All 18 models (`FeeHead`, `FeeStructure`/`FeeStructureItem`/`FeeInstallment`, `LateFeeRule`, `FeeConcession`, `FeeInvoice`/`FeeInvoiceLine`, `FeePayment`/`FeePaymentAllocation`, `FeeRefund`, `FeeNumberSeries`, `PaymentOrder`, `Account`, `JournalVoucher`/`JournalVoucherLine`, `Vendor`, `Expense`) are tenant models carrying `organizationId` + `groupId` + `institutionId`. Money is `Decimal(14,2)`; every calculation goes through integer paise in `fees.logic.ts` / `finance.logic.ts` (pure, unit-tested).

**Fee setup.** Fee heads (category, refundable flag, tax %), structures per institution / program / class section / academic year with items and installments (due dates and % split), late-fee rules (`FLAT` or `PER_DAY`, grace days, cap), and concessions (`PERCENT`/`AMOUNT`, per student, per category, or `SIBLING` for second and later wards of a guardian). `POST /fees/invoices/generate` (structure + optional section/program) raises one invoice per student per installment, applying concessions. It is idempotent per (structure, installment, student).

**Charges from other modules.** Transport, hostel, library fines, exams and similar modules post demand through the service API, not the HTTP route:

```ts
import { createStudentCharge, cancelStudentCharge } from '../fees/fees.invoices.service';
await createStudentCharge({
  studentId,
  feeHeadCode: 'TRANSPORT', // institution head first, then organization-wide
  amount: 4500,
  dueDate: new Date('2026-07-10'),
  sourceType: 'TRANSPORT_ALLOCATION', // free text, used for idempotency and reporting
  sourceId: allocation.id, // optional; with it, repeat calls return the existing invoice
  description: 'Bus route 7 — Term 1',
});
await cancelStudentCharge({ sourceType: 'TRANSPORT_ALLOCATION', sourceId: allocation.id, reason });
```

The charge runs as the current principal inside its tenant context: it validates the student and head, creates an `ADHOC` invoice, posts the receivable journal, then audits it and emits `fee.invoice_created`. Staff can call the same operation through `POST /fees/charges` (`fee.manage`). Library fines are already wired up: `fees.registrations.ts` registers `registerLibraryFinePoster()`, so every student fine becomes a `LIBRARY` charge with `sourceType: 'LIBRARY_FINE'` and the fine id as `sourceId`. The fine is stored as `POSTED`, and is then settled through fees rather than at the library desk. When `finance` is disabled for the institution, fines stay `PENDING`.

**Collections.** `POST /fees/payments` records cash, cheque, UPI, card, bank transfer or online payments. It allocates the amount to the given invoices, or to the oldest dues first, and keeps any excess as student advance. Each payment takes a per-institution receipt number from `FeeNumberSeries` (`RECEIPT`, `REFUND`, `INVOICE`), allocated under a row lock. Receipts render through the branded `fee_receipt` PDF template. Refunds (`fee.refund`) and payment or invoice cancellations require a reason; they are audited and reverse their journals.

**Online payment.** The `PaymentGateway` interface in `fees.gateway.ts` defines `createOrder`, `verifyPayment` and `verifyWebhook`. Providers register with `registerPaymentGateway(provider, (secret, config) => gateway)`. `resolveGateway(institutionId)` picks the first registered provider that has an active integration credential with purpose `fees.online_payment` (institution → group → organization). Otherwise it falls back to the built-in HMAC `mock` gateway (credential provider `mock_gateway`; a dev secret is used outside production). The portal calls `POST /fees/checkout` and then `POST /fees/checkout/confirm`. The provider may also call the public `POST /api/v1/fees/webhooks/:provider/:organizationId`; its signature is verified before any tenant work. Both paths settle the order exactly once.

**Dues and reminders.** `GET /fees/defaulters` and `GET /fees/reports/:key` (`collections`, `dues`, `aging` in buckets 0–30/31–60/61–90/90+, `head_wise`, `concessions`). The recurring `fees.daily.schedule` job enqueues `fees.daily_org` per active organization. That job applies late fees, then publishes the `fee.due_reminder` notification to guardians (and student logins) through `publish()`. Staff can trigger them manually with `POST /fees/reminders/send` and `POST /fees/late-fees/apply`.

**Accounts.** `ensureChartOfAccounts()` seeds a default tree per organization: Assets, Liabilities, Funds, Income and Expenses. Well-known ledgers carry a `systemKey`, for example `cash`, `bank`, `fee_receivable`, `gateway_clearing`, `fee_advance`, `salary_payable`, `statutory_payable`, `tax_payable`, `creditors`, `corpus_fund`, `income_<category>`, `late_fee_income`, `concession_expense`, `fee_refunds`, `salary_expense`, `employer_contribution`, `utilities`, `maintenance`, `admin_expense` and `general_expense`. Journal vouchers must balance (Dr = Cr, at least two lines). Manual vouchers can be drafted and then posted (`finance.post`). Postings are automatic with `sourceType` set to `FEE_INVOICE`, `FEE_INVOICE_CANCEL`, `FEE_LATE_FEE`, `FEE_PAYMENT`, `FEE_REFUND`, `EXPENSE` or `PAYROLL`; `sourceKey` makes them idempotent. Payroll runs post a salary journal through `onEvent('payroll.run_finalized')`, and re-finalized revisions supersede earlier journals. `GET /finance/reports/:key` serves `day_book`, `ledger`, `trial_balance` and `income_expenditure` as JSON, or as CSV, XLSX or PDF with `?format=`, using the shared report helpers.

**Registrations.** Both live in `fees.registrations.ts` and `finance.registrations.ts`:

- Events: `fee.invoice_created`, `fee.invoices_generated`, `fee.invoice_cancelled`, `fee.payment_received`, `fee.payment_cancelled`, `fee.refund_issued`, `finance.voucher_posted` and `finance.expense_recorded`.
- Notifications: `fee.payment_received` and `fee.due_reminder`.
- The PDF template `fee_receipt` and the daily job.

**Permissions.** The fee and finance keys are `fee.view|manage|collect|refund|concession|view_own` and `finance.view|manage|post`. Institution admins and `finance_manager` get everything except `view_own`. The `accountant` role gets view, manage, collect and post. Principals get view only. Student and parent roles get `fee.view_own`; with it they can use `/fees/me` and `/fees/my-wards`, pay online and download their own receipts. Web pages are in `apps/web/src/pages/fees`, `pages/finance` and `pages/fees/MyFeesPage.vue` (portal). Routes and menus are in `router/fees-finance-routes.ts` and `navigation/fees-finance-menu.ts`. Demo data comes from `scripts/demo/seed-fees_finance.mjs`.

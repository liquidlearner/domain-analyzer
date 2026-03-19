# agents.md — Build Plan for pd-migration-analyzer

> Agent-scoped task breakdown for building the PagerDuty Migration Analyzer.
> Each agent represents an isolated unit of work that can be assigned to a Claude Code subagent or developer.
> Agents are ordered by dependency — earlier agents produce foundations that later agents build on.

---

## Phase 1: Scaffold & Foundation (Week 1–2)

### Agent 1: Project Bootstrap

**Goal:** Initialize the Next.js project with all core dependencies, tooling, and project structure.

**Tasks:**
- Initialize Next.js 14+ with App Router, TypeScript, Tailwind CSS, ESLint, Prettier
- Install and configure: `prisma`, `@trpc/server`, `@trpc/client`, `@trpc/next`, `next-auth`, `zod`, `shadcn/ui`
- Install background job tooling: `inngest`
- Set up project directory structure:
  ```
  src/
    app/              # Next.js App Router pages & layouts
    server/
      db/             # Prisma client, encryption helpers
      trpc/           # tRPC router, context, procedures
      jobs/           # Inngest function definitions
      services/       # Business logic (PD client, analysis engine, TF runner)
    lib/              # Shared utilities, constants, types
    components/       # React components (ui/, layout/, features/)
  prisma/
    schema.prisma
    migrations/
  ```
- Create `.env.example` with all variables from spec §11
- Configure `tsconfig.json` path aliases (`@/` → `src/`)
- Add a root layout with Tailwind and a placeholder landing page to verify the app runs

**Outputs:** A bootable `next dev` project with all dependencies installed and the directory skeleton in place.

**Dependencies:** None — this is the starting point.

---

### Agent 2: Database Schema & Prisma

**Goal:** Define the full Prisma schema, generate migrations, and build the encryption utility layer.

**Tasks:**
- Translate the data model from spec §4 into `prisma/schema.prisma`:
  - `User` (id, email, name, role enum: ADMIN | SA_SE | VIEWER, createdAt, updatedAt)
  - `Customer` (id, name, industry, pdContractRenewal, notes, createdById FK, timestamps)
  - `PdDomain` (id, customerId FK, subdomain, apiTokenEnc bytes, tokenLast4, connectedAt, lastValidated, status enum, timestamps)
  - `ConfigSnapshot` (id, domainId FK, capturedAt, terraformState bytes, resourcesJson bytes, resourceCounts json, staleResources json, status enum)
  - `PdResource` (id, snapshotId FK, pdType enum, pdId, name, teamIds string[], configJson bytes, isStale, lastActivity, dependencies string[])
  - `Evaluation` (id, domainId FK, createdById FK, status enum, configSnapshotId FK, scopeType enum: TEAM | SERVICE, scopeIds string[], startedAt, completedAt, timestamps)
  - `IncidentAnalysis` (id, evaluationId FK, serviceId, teamId, periodStart, periodEnd, incidentCount, alertCount, noiseRatio, mttrP50, mttrP95, sourcesJson bytes, patternsJson bytes, shadowSignals string[])
  - `MigrationMapping` (id, evaluationId FK, pdResourceId FK, ioResourceType, conversionStatus enum: AUTO | MANUAL | SKIP | UNSUPPORTED, effortEstimate, notes, ioTfSnippet)
  - `AuditLog` (id, userId FK, action, entityType, entityId, metadataJson json, ipAddress, createdAt)
- Create `src/server/db/client.ts` — Prisma client singleton
- Create `src/server/db/encryption.ts`:
  - `encrypt(plaintext: string, key: Buffer): { ciphertext: Buffer, iv: Buffer, tag: Buffer }`
  - `decrypt(ciphertext: Buffer, iv: Buffer, tag: Buffer, key: Buffer): string`
  - Uses AES-256-GCM via Node.js `crypto` module
  - Key sourced from `ENCRYPTION_KEY` env var
  - Helper wrappers: `encryptToken(token: string): string` and `decryptToken(encrypted: string): string` that handle serialization
- Create `src/server/db/seed.ts` — seed script with a dev admin user and one sample customer
- Generate and run initial migration

**Outputs:** A working database schema with migrations, a Prisma client, and encryption utilities.

**Dependencies:** Agent 1 (project structure exists).

---

### Agent 3: Authentication

**Goal:** Implement NextAuth.js with Google OAuth (domain-restricted) and a dev login bypass.

**Tasks:**
- Configure NextAuth.js in `src/app/api/auth/[...nextauth]/route.ts`:
  - Google OAuth provider restricted to `@incident.io` domain
  - JWT session strategy stored in httpOnly cookie
  - Callbacks: on sign-in, upsert user in DB; attach role to JWT token
- Create `src/app/login/page.tsx`:
  - Google OAuth sign-in button
  - Dev Login button (conditionally rendered when `NODE_ENV === 'development'` AND `NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true'`)
- Implement dev bypass API route `src/app/api/auth/dev-login/route.ts`:
  - Only functional when both env conditions met
  - Creates a session as `dev@incident.io` with ADMIN role
  - Build-time dead code elimination: wrap entire handler in `if (process.env.NODE_ENV !== 'development') return NextResponse.json({ error: 'Not available' }, { status: 404 })`
- Create auth middleware `src/middleware.ts`:
  - Protect all routes except `/login` and `/api/auth/*`
  - Redirect unauthenticated users to `/login`
- Create `src/lib/auth.ts`:
  - `getServerSession()` helper
  - `requireRole(role: Role)` guard for use in tRPC procedures
  - `getCurrentUser()` helper returning typed user with role

**Outputs:** Working auth flow — Google OAuth in production mode, dev bypass in development. Protected routes.

**Dependencies:** Agent 2 (User model exists in DB).

---

### Agent 4: tRPC Setup & Customer CRUD

**Goal:** Set up the tRPC layer and implement the first set of CRUD operations for Customers.

**Tasks:**
- Create tRPC infrastructure:
  - `src/server/trpc/trpc.ts` — init tRPC with context (session, db, user)
  - `src/server/trpc/context.ts` — create context from request (session + prisma)
  - `src/server/trpc/routers/_app.ts` — root app router merging all sub-routers
  - `src/app/api/trpc/[trpc]/route.ts` — Next.js API route handler
  - `src/lib/trpc.ts` — client-side tRPC hooks (`createTRPCReact`)
  - `src/components/providers/trpc-provider.tsx` — React Query + tRPC provider wrapper
- Define auth-aware middleware procedures:
  - `publicProcedure` — no auth required
  - `protectedProcedure` — requires valid session
  - `adminProcedure` — requires ADMIN role
  - `saProcedure` — requires ADMIN or SA_SE role
- Create `src/server/trpc/routers/customer.ts`:
  - `list` — paginated list with search, accessible to all authenticated users (filtered by createdBy for non-admins)
  - `getById` — single customer with domains, with row-level access check
  - `create` — input: `{ name, industry?, pdContractRenewal?, notes? }`, requires SA_SE+
  - `update` — partial update, requires SA_SE+ and ownership or ADMIN
  - `delete` — soft delete, requires ADMIN
- Create Zod schemas for all inputs in `src/lib/validators/customer.ts`
- Write `src/server/trpc/routers/audit.ts` — reusable `logAudit(action, entityType, entityId, metadata)` helper that inserts into AuditLog

**Outputs:** Fully typed tRPC API with customer CRUD and audit logging foundation.

**Dependencies:** Agent 2, Agent 3.

---

## Phase 1 Continued: Module 1 — Config Export (Week 3–4)

### Agent 5: PD Domain Management

**Goal:** Implement PD domain connection, token validation, and management.

**Tasks:**
- Create `src/server/services/pd-client.ts`:
  - `PagerDutyClient` class wrapping the PD REST API
  - Constructor takes decrypted API token + subdomain
  - Methods: `validateToken()`, `getAbilities()`, `listServices()`, `listTeams()`, `listSchedules()`, `listEscalationPolicies()`, `listIncidents(params)`, `getServiceIntegrations(serviceId)`, `getLogEntries(params)`, `getAnalyticsIncidents(params)`
  - Built-in rate limiting: track request count per minute, queue/delay when approaching 900/min
  - Exponential backoff on 429 responses
  - All methods paginate automatically and return full result sets
- Create `src/server/trpc/routers/domain.ts`:
  - `connect` — input: `{ customerId, subdomain, apiToken }`. Validates token (calls PD API), encrypts token, stores domain, auto-triggers config export job. Requires SA_SE+
  - `list` — domains for a customer
  - `getById` — domain detail with latest config snapshot summary
  - `updateToken` — validates new token, re-encrypts, replaces. Requires SA_SE+
  - `validateConnection` — tests existing token still works
  - `disconnect` — soft-removes domain. Requires ADMIN
- Audit log all domain operations (connect, disconnect, token update, validate)

**Outputs:** PD domain lifecycle fully managed. PD API client ready for use by background jobs.

**Dependencies:** Agent 2 (PdDomain model), Agent 3 (auth), Agent 4 (tRPC infra, audit helper).

---

### Agent 6: Background Job Infrastructure & Config Export

**Goal:** Set up Inngest, implement the config export pipeline (Terraformer integration), and the conversion analysis job.

**Tasks:**
- Configure Inngest:
  - `src/server/jobs/inngest.ts` — Inngest client init
  - `src/app/api/inngest/route.ts` — Inngest serve endpoint
  - Event types: `domain/config-export.requested`, `config/conversion-analysis.requested`, `evaluation/incident-pull.requested`, `evaluation/analysis.requested`
- Implement `src/server/jobs/config-export.ts` — `config_export` function:
  - Receives `{ domainId }` event
  - Decrypts PD API token in memory
  - Shells out to Terraformer in a temp directory:
    ```
    terraformer import pagerduty -r business_service,escalation_policy,ruleset,schedule,service,team,user -o /tmp/export-{id}/
    ```
  - Parses generated `.tf` files and `terraform.tfstate`
  - Builds resource list with types, IDs, names, team associations
  - Cross-references resources to build dependency graph (service → escalation_policy → schedule → team → user)
  - Detects stale resources (services with no incidents >90d, single-target escalation policies, schedules with no overrides)
  - Encrypts and stores as ConfigSnapshot + PdResource records
  - Cleans up temp directory
  - Emits `config/conversion-analysis.requested` on success
  - Retry: 3x with exponential backoff
- Implement `src/server/jobs/conversion-analysis.ts` — `conversion_analysis` function:
  - Receives `{ snapshotId }` event
  - Loads PdResource records for the snapshot
  - Applies conversion mapping table from spec §5:
    - schedule → AUTO (incident_schedule)
    - escalation_policy → AUTO (incident_escalation_path)
    - team → AUTO (incident_catalog_entry)
    - user → SKIP (SSO/SCIM)
    - service → MANUAL (catalog + alert routes)
    - business_service → MANUAL (catalog type mapping)
    - ruleset → UNSUPPORTED (workflow translation needed)
  - Generates draft `io_tf_snippet` for AUTO resources
  - Stores MigrationMapping records
  - Updates ConfigSnapshot status to `completed`
- Implement job progress tracking:
  - `src/server/services/job-progress.ts` — stores progress in a lightweight mechanism (DB row or in-memory map) with `{ jobId, status, progress, message, etaSeconds }`
  - `src/app/api/jobs/[jobId]/progress/route.ts` — SSE endpoint for real-time progress

**Outputs:** Config export pipeline runs end-to-end. Terraformer output parsed and stored. Conversion mappings generated.

**Dependencies:** Agent 4 (tRPC infra), Agent 5 (PD client, domain connection triggers export).

---

## Phase 1 Continued: Module 2 — Incident Analysis (Week 5–6)

### Agent 7: Incident Data Pull Job

**Goal:** Implement the background job that pulls incident data from PD's API for a scoped evaluation.

**Tasks:**
- Implement `src/server/jobs/incident-data-pull.ts` — `incident_data_pull` function:
  - Receives `{ evaluationId }` event
  - Loads evaluation scope (team IDs or service IDs) and time range
  - Decrypts PD API token
  - Paginated API calls:
    1. `GET /incidents` filtered by team_ids[] or service_ids[], date_range, include first_trigger_log_entries (100/page)
    2. `GET /services/{id}` with integrations for each in-scope service
    3. `GET /log_entries` for sampled incidents (identify API-created actions, webhooks, automation)
    4. `GET /analytics/raw/incidents` for MTTR and engagement metrics
  - Rate limiting: respect 900 req/min with backoff, pre-calculate total calls, report progress with ETA
  - Store raw pulled data in evaluation-associated temp storage (encrypted JSON columns)
  - Emit `evaluation/analysis.requested` on completion
  - Support cancellation (check for cancelled status between pages)
- Create `src/server/trpc/routers/evaluation.ts`:
  - `create` — input: `{ domainId, scopeType, scopeIds[], timeRange }`. Creates evaluation record, triggers incident_data_pull job. Requires SA_SE+
  - `list` — evaluations for a domain or across all (filtered by access)
  - `getById` — full evaluation with analysis results
  - `cancel` — sets status to `cancelled`, job checks on next iteration
  - `retry` — retries from the failed step
  - `delete` — requires ADMIN

**Outputs:** Incident data pulled from PD and stored. Evaluation lifecycle managed via tRPC.

**Dependencies:** Agent 5 (PD client), Agent 6 (Inngest infra, job progress).

---

### Agent 8: Analysis Engine

**Goal:** Implement the five analysis modules that process pulled incident data into actionable insights.

**Tasks:**
- Implement `src/server/jobs/analysis-engine.ts` — `analysis_engine` function:
  - Receives `{ evaluationId }` event
  - Loads pulled incident data for the evaluation
  - Runs each analysis module and stores results as IncidentAnalysis records:

- **Module A — Volume & Distribution** (`src/server/services/analysis/volume.ts`):
  - Incidents/alerts per service
  - Time-of-day / day-of-week distribution (for heatmap data)
  - Severity distribution
  - Top 10 noisiest services

- **Module B — Noise Analysis** (`src/server/services/analysis/noise.ts`):
  - Auto-resolved % (no human acknowledgment)
  - Acknowledged-but-no-action %
  - Escalated %
  - Mean time to ack / resolve
  - Transient alert patterns (fire-then-resolve within N minutes)
  - Compute overall noise ratio

- **Module C — Source Identification** (`src/server/services/analysis/sources.ts`):
  - Map integration types → alert source names (Datadog, CloudWatch, custom API, email, etc.)
  - Volume per source
  - Pre-filtered vs. raw assessment (compare event count vs incident count where available)
  - "Critical only" detection heuristic

- **Module D — Shadow Stack Detection** (`src/server/services/analysis/shadow-stack.ts`):
  - Log entries with `agent.type = 'api_token_reference'` → custom API integration
  - Webhook destinations on services → outbound data flow
  - Incidents created via API (not monitoring integration) → custom tooling
  - Auto-ack within seconds pattern → auto-responder script
  - Incident notes added by API → enrichment middleware
  - Extensions (Slack, custom webhooks)
  - Return array of `ShadowSignal` objects with type, evidence, confidence, and description

- **Module E — Migration Risk Signals** (`src/server/services/analysis/risk.ts`):
  - Services >100 incidents/month → high volume flag
  - Services with complex EO rules → manual workflow translation
  - Services with custom webhooks → shadow stack dependency
  - Teams with unique schedule patterns → validate carefully
  - Produce overall migration complexity rating (LOW / MEDIUM / HIGH / VERY_HIGH)

- After all modules complete, update evaluation status to `completed`

**Outputs:** Full analysis pipeline producing structured results. All five analysis dimensions populated.

**Dependencies:** Agent 7 (incident data available), Agent 6 (job infra).

---

## Phase 1: UI (Parallel with Weeks 3–6)

### Agent 9: Layout Shell & Dashboard

**Goal:** Build the app shell (navigation, layout, auth state) and the dashboard page.

**Tasks:**
- Create `src/components/layout/app-shell.tsx`:
  - Sidebar navigation: Dashboard, Customers, Admin (admin-only)
  - Top bar: user avatar, role badge, sign-out
  - Responsive — sidebar collapses on mobile
- Create `src/app/(app)/layout.tsx` — wraps all authenticated pages with the shell
- Create `src/app/(app)/page.tsx` — Dashboard:
  - Recent evaluations across all customers (table with status, date, customer name)
  - Quick stats cards: total customers, active evaluations, domains connected
  - "New Customer" and "New Evaluation" quick-action buttons
  - Uses tRPC queries to fetch data
- Create shared UI components:
  - `src/components/ui/data-table.tsx` — reusable sortable/filterable table (built on shadcn Table)
  - `src/components/ui/status-badge.tsx` — colored badges for evaluation/domain status
  - `src/components/ui/page-header.tsx` — consistent page title + breadcrumb + actions layout
  - `src/components/ui/progress-bar.tsx` — job progress indicator with ETA

**Outputs:** Navigable app shell with a functional dashboard.

**Dependencies:** Agent 1 (project runs), Agent 3 (auth), Agent 4 (tRPC client hooks).

---

### Agent 10: Customer & Domain UI

**Goal:** Build the customer management and PD domain connection pages.

**Tasks:**
- Create `src/app/(app)/customers/page.tsx`:
  - Searchable customer list table
  - "Add Customer" button → modal or inline form
- Create `src/app/(app)/customers/[id]/page.tsx`:
  - Customer detail: editable fields (name, industry, PD renewal date, notes)
  - PD Domains section: list of connected domains with status indicators
  - "Connect New Domain" button → domain connection flow
- Create `src/components/features/domain-connect-form.tsx`:
  - Step 1: Enter PD subdomain
  - Step 2: Enter read-only API key (masked input)
  - Step 3: Validate (calls tRPC `domain.connect`, shows spinner, displays success/failure)
  - On success: shows domain card with token last-4 display ("••••a1b2"), triggers config export automatically
  - On failure: specific error message (invalid key, wrong permissions, wrong subdomain)
- Create `src/app/(app)/domains/[id]/page.tsx`:
  - Domain detail: connection status, last validated timestamp
  - Config snapshot summary: resource counts by type
  - Resource inventory table (from PdResource): type, name, stale flag, dependencies
  - "Update Token" and "Validate Connection" action buttons
  - "Run Detailed Analysis" button → navigates to scope selector
- Create `src/components/features/dependency-graph.tsx`:
  - Visual dependency graph: service → escalation_policy → schedule → team
  - Use a lightweight graph library (e.g., `dagre` + SVG rendering, or `reactflow`)

**Outputs:** Full customer and domain management UI. Domain connection flow end-to-end.

**Dependencies:** Agent 4 (customer tRPC), Agent 5 (domain tRPC), Agent 9 (layout shell).

---

### Agent 11: Evaluation UI — Scope Selector & Results

**Goal:** Build the evaluation creation flow and the tabbed results view (the primary deliverable screen).

**Tasks:**
- Create `src/app/(app)/domains/[id]/evaluate/page.tsx` — Scope Selector:
  - Toggle: "By Team" or "By Service"
  - Multi-select list populated from the config snapshot's PdResource records
  - Time range picker: 30 days / 90 days / 12 months (default 90d)
  - "Analyze" button → calls tRPC `evaluation.create`, navigates to results page with progress
- Create `src/app/(app)/evaluations/[id]/page.tsx` — Evaluation Results:
  - While running: progress bar with live status via SSE subscription
  - When complete: tabbed interface with these tabs:

  **Tab: Overview**
  - Executive summary cards: total services, total incidents, noise ratio, migration complexity rating
  - Risk score visualization

  **Tab: Config Map**
  - Filterable table of all PD resources with columns: type, name, conversion status (AUTO/MANUAL/UNSUPPORTED), effort estimate, incident.io equivalent
  - Color-coded status badges
  - Expandable rows showing draft TF snippet for AUTO resources

  **Tab: Volume & Noise**
  - Line chart: incident volume over time
  - Bar chart: top 10 noisiest services
  - Heatmap: incidents by day-of-week × hour-of-day
  - Pie chart: severity distribution
  - Noise ratio breakdown (auto-resolved, ack-no-action, escalated)

  **Tab: Alert Sources**
  - Horizontal bar chart: volume per monitoring source
  - Table: source name, integration type, incident count, % of total
  - Pre-filtered vs. raw assessment display

  **Tab: Shadow Stack**
  - Card-based layout: each detected shadow signal as a card
  - Signal type icon, confidence level, evidence summary
  - Expandable detail with raw evidence data

  **Tab: Migration Plan**
  - Three-phase breakdown:
    - Phase 1 (Auto-convert): resource count, draft TF code preview
    - Phase 2 (Manual effort): resource list with effort estimates, total hours
    - Phase 3 (Skip/Cleanup): stale resources to decommission
  - Timeline estimate
  - Risk factors specific to this evaluation

- Use `recharts` for all charts (already available in the stack)

**Outputs:** The core analysis experience — from scope selection through full results display.

**Dependencies:** Agent 7 (evaluation tRPC), Agent 8 (analysis data), Agent 9 (layout), Agent 10 (navigation from domain page).

---

## Phase 2: Polish (Weeks 7–8)

### Agent 12: Report Generation

**Goal:** Implement the shareable/printable migration report and PDF export.

**Tasks:**
- Create `src/app/(app)/evaluations/[id]/report/page.tsx`:
  - Standalone, printable page (no app shell, clean layout)
  - Sections per spec §12: Executive Summary, Configuration Inventory, Operational Reality, Shadow Stack Detection, Migration Plan, Recommendations
  - Print-optimized CSS (`@media print` styles)
  - Customer logo placeholder, incident.io branding
- Implement `src/server/jobs/report-generation.ts`:
  - Generates a PDF version using a headless browser (Puppeteer) or a library like `@react-pdf/renderer`
  - Stores PDF as a downloadable asset
- Add tRPC endpoint `evaluation.generateReport` — triggers the report generation job
- Add tRPC endpoint `evaluation.downloadReport` — returns the generated PDF

**Outputs:** Shareable report page and downloadable PDF.

**Dependencies:** Agent 8 (analysis data), Agent 11 (evaluation results as data source).

---

### Agent 13: Admin Features & Audit Log

**Goal:** Implement admin-only user management and the audit log viewer.

**Tasks:**
- Create `src/app/(app)/admin/users/page.tsx`:
  - User list table: email, name, role, last sign-in
  - Role assignment dropdown (admin-only action)
  - Invite flow or just document that users auto-provision on first Google OAuth sign-in
- Create `src/app/(app)/admin/audit/page.tsx`:
  - Filterable audit log table: timestamp, user, action, entity type, entity ID, IP
  - Date range filter, action type filter, user filter
  - Expandable rows showing metadata JSON
- Create `src/server/trpc/routers/admin.ts`:
  - `listUsers` — admin only
  - `updateUserRole` — admin only, audit logged
  - `listAuditLogs` — admin only, paginated with filters
- Ensure all existing tRPC mutations call `logAudit()` — review and add any missing audit calls across all routers

**Outputs:** Admin panel with user management and audit log visibility.

**Dependencies:** Agent 4 (tRPC infra, audit helper), Agent 9 (layout shell).

---

### Agent 14: Real-Time Progress & Polish

**Goal:** Wire up real-time job progress throughout the UI and polish the overall experience.

**Tasks:**
- Implement SSE client hook `src/lib/hooks/use-job-progress.ts`:
  - Subscribes to `/api/jobs/[jobId]/progress` SSE endpoint
  - Returns `{ status, progress, message, etaSeconds }` as reactive state
- Wire progress into:
  - Domain detail page (config export progress)
  - Evaluation page (incident pull + analysis progress)
  - Dashboard (show running jobs)
- Add cancel button for running evaluations
- Add retry button for failed evaluations/exports
- Polish:
  - Loading skeletons for all data-fetching pages
  - Empty states for lists (no customers yet, no evaluations yet)
  - Error boundaries with user-friendly messages
  - Toast notifications for async operation completion (job finished, token validated, etc.)
  - Responsive layout testing and fixes

**Outputs:** Polished, real-time-aware UI with proper loading/error/empty states.

**Dependencies:** Agent 6 (SSE endpoint), Agent 9–11 (UI pages to enhance).

---

## Agent Dependency Graph

```
Agent 1 (Bootstrap)
  └─► Agent 2 (Database & Prisma)
        ├─► Agent 3 (Auth)
        │     └─► Agent 4 (tRPC & Customer CRUD)
        │           ├─► Agent 5 (PD Domain Management)
        │           │     └─► Agent 6 (Jobs & Config Export)
        │           │           ├─► Agent 7 (Incident Data Pull)
        │           │           │     └─► Agent 8 (Analysis Engine)
        │           │           │           └─► Agent 12 (Reports)
        │           │           └─► Agent 14 (Progress & Polish)
        │           ├─► Agent 9 (Layout & Dashboard)
        │           │     ├─► Agent 10 (Customer & Domain UI)
        │           │     │     └─► Agent 11 (Evaluation UI)
        │           │     └─► Agent 13 (Admin & Audit)
        │           └─► Agent 13 (Admin & Audit)
        └─► Agent 3 (Auth)
```

### Parallelization Opportunities

Once Agents 1–4 are complete (foundation), significant parallelism is possible:

- **Backend track** (Agents 5 → 6 → 7 → 8) can proceed in sequence
- **UI track** (Agents 9 → 10 → 11) can proceed in parallel with the backend track, using mocked data initially
- **Agent 12** (Reports) and **Agent 13** (Admin) can start as soon as their data dependencies exist
- **Agent 14** (Polish) runs last as it touches all surfaces

---

## Notes for Agent Execution

1. **Each agent should write tests.** At minimum, unit tests for business logic (encryption, analysis modules, conversion mappings) and integration tests for tRPC routers.

2. **Use the spec as the source of truth.** When an agent needs detailed requirements (e.g., the conversion mapping table, PD API rate limits, encryption strategy), reference the corresponding section in `SPEC.md`.

3. **Environment setup matters.** Agents 1–4 should produce a working dev environment with `docker-compose.yml` for PostgreSQL and a documented `npm run dev` flow.

4. **Terraformer is an external binary.** Agent 6 needs to handle the case where Terraformer is not installed — provide setup instructions and graceful error handling. Consider a Docker-based approach for consistent Terraformer execution.

5. **Encryption is non-negotiable.** Any agent writing or reading PD tokens or PD data must use the encryption utilities from Agent 2. Never store plaintext tokens. Never log tokens.

6. **Row-level access control is pervasive.** Every tRPC query must respect the access rules: non-admin users only see their own customers/evaluations unless explicitly shared. Agents 4, 5, 7, and 13 must implement this consistently.

---

## Development Status (as of 2026-03-17)

### Completed

| Agent | Status | Notes |
|-------|--------|-------|
| 1 (Bootstrap) | Done | Next.js 15, Prisma, tRPC, Tailwind, shadcn/ui, Inngest |
| 2 (Database) | Done | Full schema, migrations, encryption utils |
| 3 (Auth) | Done | Dev bypass mode (Google OAuth deferred) |
| 4 (tRPC + CRUD) | Done | Customer, Domain, Evaluation routers |
| 5 (PD Client) | Done | Full PD REST API client with rate limiting, pagination, retry |
| 6 (Config Export) | Done | Direct PD API config sync (no Terraformer — uses PD REST API directly). Fetches services, teams, schedules, EPs, users, business services, extensions, webhooks, workflows, event orchestrations with router rules |
| 7 (Incident Pull) | Done | Scoped by Team or Service, chunked 179-day windows, include[]=first_trigger_log_entry for source detection, maxEntries cap for log entries |
| 8 (Analysis Engine) | Done | All 6 modules: volume, noise, sources, shadow-stack (tool stack), risk, project-plan |
| 9 (Layout + Dashboard) | Done | App shell, dashboard, incident.io orange brand |
| 10 (Customer + Domain UI) | Done | Customer list, domain detail, config sync flow |
| 11 (Evaluation UI) | Done | Scope selector, 6-tab results view (Overview, Config Map, Volume & Noise, Alert Sources, Tool Stack, Migration Plan) |
| 12 (Report) | Done | Printable report page, print-button component |

### Key Deviations from Original Spec

1. **No Terraformer**: Config export uses PD REST API directly instead of shelling out to Terraformer. More portable, no binary dependency, and gives us richer config data (EO router rules, integration details).
2. **No Inngest for evaluation runs**: Evaluations run directly in the tRPC mutation handler with SSE progress tracking via `jobProgress` service. Inngest is available but not required.
3. **Next.js 15 (not 14)**: Using App Router with async params (`params: Promise<{id: string}>`).
4. **"Shadow Stack" renamed to "Tool Stack"**: User-facing terminology. Internal types (`ShadowStackAnalysis`, `ShadowSignal`) retain original names for backward compat with stored data.
5. **Compression utility**: `src/lib/compression.ts` provides gzip compression for Bytes fields with backward-compatible decompression fallback.
6. **Project Plan module**: Added `src/server/services/analysis/project-plan.ts` — generates phased migration timeline with pilot recommendations, effort estimates, and wave assignments.

### Current Issues (Open)

#### Source Detection — Still Ambiguous
The source detection pipeline was overhauled to read `first_trigger_log_entry.channel.cef_details.source_component` (the actual monitoring tool name from the incident payload). However, results still show generic "Monitoring Integration" for all 1,298 incidents in the OrbitPay test domain. The PD API may not be returning expanded channel data despite `include[]=first_trigger_log_entry`, or the OrbitPay demo data may not have `cef_details` populated (synthetic/simulated events).

**Priority chain (current)**:
1. Channel source (`cef_details.source_component`, `channel.source`, `channel.details.source`)
2. EO-routed service (with EO name annotation)
3. API channel type
4. Email channel type
5. Events API v2/v1 channel type + vendor integration lookup
6. Fallback: "Monitoring Integration"

**Next steps**: Inspect raw incident payloads from a real PD account to verify what fields are populated. The `first_trigger_log_entry` may need a separate GET call to `/log_entries/{id}` for full channel expansion (the `include[]` on `/incidents` may only embed a reference, not the full object).

#### Tool Stack — Missing Integration Detection
The Tool Stack tab detects signals from:
- Log entries (API consumers, auto-ack/resolve patterns, enrichment middleware)
- Config snapshot (extensions, webhooks, workflows, EO routing)

But it does NOT currently detect:
- **ServiceNow** (V2 extensions or OAuth-based integrations)
- **Slack** (native PD Slack integration, not always an "extension")
- **Microsoft Teams** (native PD Teams integration)
- **Salesforce** (custom integration, usually API-based)
- **JIRA** (V2 extension or Events API integration)

These integrations are configured in PD differently depending on the vendor — some are V2 extensions with `extension_schema`, some are OAuth apps, some are native integrations that don't show up as classic extensions. Research needed on the best PD API endpoints to identify these (possibly `/services/{id}/integrations` vendor data, or `/extensions` with schema filtering).

**Deferred**: User is researching PD integration detection patterns separately before building this.

#### API-Resolved Incidents — New Signal
Added `apiResolvedPercent` tracking to noise analysis. Detects when `last_status_change_by.type` is `service_reference`, `integration_reference`, or `api_token_reference`. High API-resolve % (>50%) indicates external automation handling the incident lifecycle — a strong shadow tool stack signal.

Needs validation against real PD account data to confirm the `last_status_change_by.type` values are correct.

### Enterprise Scalability (Phase done)

Performance optimizations implemented:
- Database indexes on PdResource, Evaluation, MigrationMapping, ConfigSnapshot
- Selective configJson loading (omit from main resource query, load separately for analysis types)
- Log entry cap (`maxEntries: 50000`) to prevent OOM
- Compression utility for Bytes fields (gzip with backward-compat fallback)
- Hardened configJson parsing (Buffer/null/undefined safety in risk.ts)

Still planned:
- Batch `createMany()` for config resources and migration mappings
- tRPC response trimming (cap incidentAnalyses, exclude configJson from listings)
- Streaming/chunked analysis for 200K+ incident evaluations (deferred until needed)

### Git History

| Commit | Description |
|--------|-------------|
| `b229912` | Initial commit |
| `73d9459` | Direct PD config sync (no Inngest) |
| `af0357c` | Redesign config sync, add Event Orchestrations |
| `08e7abf` | Fix PdResource insert batching |
| `52cc82f` | incident.io orange brand theme |
| `07f4d99` | Fix button visibility, CSS theme, evaluation create |
| `69bbb84` | Scope-aware evaluation runner with EO routing detection |
| `602796d` | Fix 365-day incident pull (179-day chunking) |
| `0b797b4` | Fix source detection, noise ratio, tool stack rename, enterprise scalability |
| `c9f01e1` | Read real alert source from incident channel data, track API-resolved % |

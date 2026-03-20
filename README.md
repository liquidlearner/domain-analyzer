# PagerDuty Migration Analyzer

Automated PagerDuty migration assessment tool for incident.io enterprise engagements. Connects to a customer's PagerDuty domain (read-only), exports full configuration, analyzes real incident data, detects integrations and shadow tooling, and generates actionable migration reports.

Built for incident.io Solution Architects, Solution Engineers, and Customer Success Managers running enterprise evaluations and migration planning.

## What It Does

**Module 1 — Configuration Export:** Inventories all PagerDuty resources (services, teams, schedules, escalation policies, event orchestrations, incident workflows, automation actions, extensions, webhooks) and maps each to its incident.io equivalent with conversion status (auto/manual/unsupported) and draft Terraform snippets.

**Module 2 — Incident Analysis:** Pulls real incident data scoped by team or service selection and analyzes:

- **Volume & Distribution** — Incident/alert counts, severity breakdown, top noisiest services
- **Noise Analysis** — Auto-resolved %, noise ratio, MTTR, API-resolved % (automation signal)
- **Alert Sources** — 3-layer detection model (extensions, service integrations, incident workflows) identifying monitoring tools sending events
- **Tool Stack (Shadow Stack)** — 6-layer integration fingerprinting detecting custom API consumers, auto-ack/resolve patterns, enrichment middleware, webhook destinations, workflow-based integrations (ServiceNow, Slack, Teams, Zoom), event orchestration routing, and automation actions
- **Migration Risk** — Complexity scoring based on integration depth, noise levels, and custom tooling
- **Project Plan** — Phased migration timeline with pilot recommendations and effort estimates

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS 4, shadcn/ui, Radix UI |
| API Layer | tRPC 11 (type-safe RPC) |
| Database | PostgreSQL 16, Prisma 6 ORM |
| Auth | NextAuth.js 5 (Google OAuth, dev bypass) |
| Encryption | AES-256-GCM (column-level for tokens/PII) |
| Background Jobs | Inngest |
| Charts | Recharts |
| Validation | Zod |
| Containerization | Docker (multi-stage builds) |

## Prerequisites

- **Node.js** 20+
- **Docker** (for PostgreSQL)
- **npm** 9+

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/liquidlearner/domain-analyzer.git
cd domain-analyzer
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Database — start PostgreSQL first (step 3), then this works as-is
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pd_migration_analyzer

# Encryption — generate a 256-bit key
ENCRYPTION_KEY=$(openssl rand -hex 32)
ENCRYPTION_KEY_ID=v1

# Auth — dev bypass for local development
NEXT_PUBLIC_DEV_AUTH_BYPASS=true
NEXTAUTH_SECRET=$(openssl rand -base64 32)
NEXTAUTH_URL=http://localhost:3000
AUTH_TRUST_HOST=true

# Google OAuth (production only — not needed for local dev)
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=

# Inngest (optional for local dev — evaluations run inline)
# INNGEST_EVENT_KEY=
# INNGEST_SIGNING_KEY=
```

### 3. Start the database

```bash
docker compose -f docker-compose.dev.yml up -d
```

### 4. Initialize the database

```bash
npx prisma migrate deploy
npx prisma db seed        # Creates a dev admin user
```

### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Click "Dev Login" to authenticate.

## Usage Workflow

1. **Add a Customer** — Create a customer record (name, industry, PD contract renewal date)
2. **Connect a PD Domain** — Enter the PagerDuty subdomain and a read-only API token. The app validates the token and auto-exports the full configuration.
3. **Review Config Inventory** — Browse the domain detail page to see all PD resources, resource counts, and dependencies.
4. **Run an Evaluation** — Select teams or services to analyze, choose a time range (1–365 days), and run the analysis.
5. **Review Results** — The evaluation page shows six tabs: Overview, Config Map, Volume & Noise, Alert Sources, Tool Stack, and Migration Plan.
6. **Generate Report** — Use the printable report view for customer-facing deliverables.

## PagerDuty API Token

The app requires a **read-only** PagerDuty API token. It never writes to or modifies anything in the customer's PagerDuty account.

**Required permissions** (all covered by a standard read-only key):
- `services.read`, `teams.read`, `schedules.read`, `escalation_policies.read`
- `extensions.read`, `vendors.read`
- `incident_workflows.read`, `incidents.read`
- `event_orchestrations.read`
- `analytics.read`

**Security:**
- Tokens are encrypted at rest with AES-256-GCM (application-level encryption)
- Tokens are decrypted only in memory during API calls
- Only the last 4 characters are visible in the UI
- All access is audit-logged

## Project Structure

```
src/
├── app/                          # Next.js App Router
│   ├── (app)/                    # Protected routes
│   │   ├── page.tsx              # Dashboard
│   │   ├── customers/            # Customer management
│   │   ├── domains/[id]/         # Domain detail + evaluate
│   │   ├── evaluations/[id]/     # Evaluation results (6-tab view)
│   │   │   ├── tabs/             # Tab components (overview, config-map, etc.)
│   │   │   └── report/           # Printable migration report
│   │   └── admin/                # User management, audit logs
│   ├── api/
│   │   ├── trpc/[trpc]/          # tRPC API handler
│   │   ├── auth/                 # NextAuth + dev bypass
│   │   └── inngest/              # Background job webhook
│   └── login/                    # Login page
│
├── server/
│   ├── db/
│   │   ├── client.ts             # Prisma client singleton
│   │   └── encryption.ts         # AES-256-GCM encrypt/decrypt
│   ├── services/
│   │   ├── pd/
│   │   │   ├── client.ts         # PagerDuty API client (rate limiting, retry, pagination)
│   │   │   └── types.ts          # PD API response types
│   │   ├── analysis/
│   │   │   ├── volume.ts         # Incident volume trends
│   │   │   ├── noise.ts          # Noise ratio, auto-resolve detection
│   │   │   ├── sources.ts        # 3-layer alert source identification
│   │   │   ├── shadow-stack.ts   # 6-layer integration fingerprinting
│   │   │   ├── risk.ts           # Migration risk scoring
│   │   │   └── project-plan.ts   # Phased migration timeline
│   │   └── evaluation-runner.ts  # Evaluation orchestrator
│   ├── trpc/
│   │   └── routers/              # customer, domain, evaluation, admin
│   └── jobs/                     # Inngest background functions
│
├── components/
│   ├── ui/                       # shadcn/ui base components
│   ├── features/                 # Domain-specific components
│   ├── layout/                   # App shell, navigation
│   └── providers/                # Auth + tRPC providers
│
└── lib/
    ├── auth.ts                   # NextAuth config
    ├── trpc.ts                   # tRPC client
    ├── compression.ts            # gzip for large Bytes fields
    └── validators/               # Zod input schemas
```

## Database Commands

```bash
npm run db:generate     # Regenerate Prisma client after schema changes
npm run db:migrate      # Create + apply a new migration
npm run db:push         # Sync schema to DB without migration file
npm run db:seed         # Seed initial data
npm run db:reset        # Drop + recreate database
npm run db:studio       # Open Prisma Studio (visual DB browser)
```

## Docker (Production)

```bash
# Build and run the full stack (app + PostgreSQL)
docker compose up -d

# Apply migrations inside the container
docker compose exec app npx prisma migrate deploy
```

The `Dockerfile` uses a multi-stage build (deps → build → runner) with `output: "standalone"` for minimal image size. The `docker-entrypoint.sh` runs migrations before starting the server.

## Architecture

### Authentication & Authorization

- **Production:** Google OAuth restricted to the incident.io domain
- **Development:** Env-gated bypass login (`NEXT_PUBLIC_DEV_AUTH_BYPASS=true`)
- **Roles:** ADMIN (full access), SA_SE (create/analyze), VIEWER (read-only)

### Integration Detection Model

The tool uses a 6-layer detection model to identify all PagerDuty integrations:

| Layer | Source | What It Catches |
|-------|--------|----------------|
| 1 | Extensions API | Bidirectional syncs (ServiceNow, JIRA, Zendesk) |
| 2 | Service Integrations | Inbound event sources with vendor metadata |
| 3 | Incident Workflows | Action-based integrations (ServiceNow, Slack, Teams, Zoom, Lambda) |
| 4 | Alert Payloads | Ground-truth source when vendor metadata is null |
| 5 | Event Orchestrations | Dynamic routing patterns, global ingest funnels |
| 6 | Automation Actions | Process automation, script runners, execution history |

### Data Flow

```
Connect Domain → Config Export (PD REST API) → Store Resources
                                                      ↓
Select Scope (Teams/Services) + Time Range → Pull Incidents → Run Analysis
                                                                    ↓
                                              Volume · Noise · Sources · Tool Stack · Risk · Plan
                                                                    ↓
                                                            Evaluation Results → Report
```

### Key Design Decisions

- **No Terraformer dependency** — Config export uses PD REST API directly for portability
- **Evaluations run inline** — No Inngest dependency for analysis; runs in the tRPC mutation handler
- **Scope-aware analysis** — All analysis engines respect team/service scope selection
- **POST method override** — tRPC uses POST for all requests to avoid URI length limits with large payloads
- **Compression** — Large JSON fields are gzip-compressed with backward-compatible decompression

## Specifications

Detailed design documents are in the repo:

- **[SPEC.md](./SPEC.md)** — Original application specification (data model, security, modules, UI architecture)
- **[INTEGRATION-DETECTION-SPEC.md](./INTEGRATION-DETECTION-SPEC.md)** — 6-layer integration detection model with PD API patterns
- **[agents.md](./agents.md)** — Build plan and agent task breakdown with development history

## License

Private — internal tool for incident.io enterprise engagements.

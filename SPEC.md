# pd-migration-analyzer — Application Specification

> Automated PagerDuty migration assessment tool for incident.io enterprise engagements.
> Internal tool, multi-user, multi-customer.

## 1. Overview

### What It Does

Connects to a customer's PagerDuty domain(s), extracts full configuration and incident data, and generates a migration assessment report showing:

- **Module 1 (Config):** What PD resources exist, what converts to incident.io Terraform automatically, and what requires manual effort.
- **Module 2 (Incident Data):** What's actually happening — alert volume, noise patterns, source distribution, shadow stack fingerprints — scoped by Team or Service selection.

### Who Uses It

incident.io SAs, SEs, and CSMs running enterprise evaluations and migration planning. Multi-user with role-based access.

### Design Principles

- **Read-only.** Never writes to or modifies anything in PagerDuty. Customers provide a read-only API key.
- **Self-service ready.** Architected from Day 1 so Phase 2 (customer-facing self-service) requires adding an auth flow, not a rewrite.
- **Secure by default.** PD API tokens encrypted at rest. Customer data isolated. Audit trail on all access.
- **Team/Service scoped.** Full config export happens once; detailed analysis is scoped by team or service selection to keep results actionable.

---

## 2. Tech Stack

### Recommended Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Frontend                          │
│              Next.js 14+ (App Router)                    │
│         React · Tailwind CSS · shadcn/ui                 │
│                                                          │
│  Dashboard │ Customer Mgmt │ Analysis Views │ Reports    │
└──────────────────────┬──────────────────────────────────┘
                       │ tRPC / API Routes
┌──────────────────────┴──────────────────────────────────┐
│                     Backend (Next.js)                     │
│                                                          │
│  Auth (NextAuth.js)  │  PD API Client  │  TF Runner     │
│  Customer CRUD       │  Analysis Engine │  Report Gen    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│                    Background Jobs                        │
│              Inngest (or BullMQ + Redis)                  │
│                                                          │
│  PD Config Export  │  Incident Data Pull  │  Analysis    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│                     Data Layer                            │
│                                                          │
│  PostgreSQL (primary)    │  Encrypted at rest (AES-256)  │
│  Prisma ORM              │  Column-level encryption for  │
│                          │  API tokens & PII             │
└─────────────────────────────────────────────────────────┘
```

### Why This Stack

| Choice | Rationale |
|--------|-----------|
| **Next.js (full-stack TypeScript)** | Single language across frontend and backend. App Router for server components. API routes for backend logic. Aligns with incident.io's engineering culture (TypeScript-heavy). |
| **tRPC** | Type-safe API layer between frontend and backend. No API schema maintenance. Auto-complete from DB to UI. |
| **PostgreSQL + Prisma** | Relational data (customers → domains → evaluations → resources). Prisma for type-safe queries, migrations, and schema management. |
| **Inngest** | Background job orchestration for long-running PD API pulls and analysis. Built-in retry, rate limiting, and observability. Alternatively BullMQ + Redis if self-hosting preferred. |
| **NextAuth.js** | Google OAuth out of the box. Dev bypass trivial to add. Supports restricting to incident.io domain. |
| **Terraformer CLI** | Already supports PD provider with 7 resource types. Shells out to Terraformer for Module 1 config export rather than rebuilding. |

---

## 3. Authentication & Authorization

### Google OAuth (Production)

```
Provider: Google
Restriction: @incident.io domain only
Session: JWT stored in httpOnly cookie
Refresh: Silent refresh via NextAuth
```

All users must authenticate with their incident.io Google Workspace account. No self-registration — domain-restricted at the OAuth level.

### Dev Login Bypass

```typescript
// .env.local
NEXT_PUBLIC_DEV_AUTH_BYPASS=true

// Only available when:
// 1. NODE_ENV === 'development'
// 2. NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true'
// Creates a session as: dev@incident.io (role: admin)
```

A "Dev Login" button appears on the login page in development mode. Bypasses Google OAuth entirely. Creates a mock session with admin privileges. **Must not be deployable** — build process strips the bypass code in production builds via environment check.

### Roles

| Role | Permissions |
|------|------------|
| **Admin** | Full access. Manage users, customers, domains. Delete evaluations. View audit log. |
| **SA/SE** | Create customers, connect PD domains, run evaluations, view reports. Cannot manage other users. |
| **Viewer** | Read-only access to evaluation reports. Cannot connect domains or trigger data pulls. For CSMs and AEs. |

Role assignment managed by admins in the app UI. Stored in the `users` table.

---

## 4. Data Model

### Core Entities

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Customer   │────<│    PD Domain      │────<│   Evaluation     │
│              │     │                    │     │                  │
│ id           │     │ id                 │     │ id               │
│ name         │     │ customer_id (FK)   │     │ domain_id (FK)   │
│ industry     │     │ subdomain          │     │ created_by (FK)  │
│ pd_contract_ │     │ api_token_enc      │     │ status           │
│   renewal    │     │ token_last4        │     │ config_snapshot  │
│ notes        │     │ connected_at       │     │   _id (FK)       │
│ created_by   │     │ last_validated     │     │ scope_type       │
│ created_at   │     │ status             │     │ scope_ids[]      │
│ updated_at   │     │ created_at         │     │ started_at       │
└──────────────┘     └──────────────────┘     │ completed_at     │
                                                │ created_at       │
                                                └────────┬─────────┘
                                                         │
                                          ┌──────────────┴──────────┐
                                          │                         │
                                ┌─────────┴────────┐  ┌─────────────┴──────┐
                                │  Config Snapshot  │  │  Incident Analysis │
                                │                   │  │                    │
                                │  id               │  │  id                │
                                │  domain_id (FK)   │  │  evaluation_id(FK) │
                                │  captured_at      │  │  service_id        │
                                │  terraform_state  │  │  team_id           │
                                │  resources_json   │  │  period_start      │
                                │  resource_counts  │  │  period_end        │
                                │  stale_resources  │  │  incident_count    │
                                │  status           │  │  alert_count       │
                                └──────────────────┘  │  noise_ratio       │
                                                       │  mttr_p50          │
                                                       │  mttr_p95          │
                                                       │  sources_json      │
                                                       │  patterns_json     │
                                                       │  shadow_signals[]  │
                                                       └────────────────────┘
```

### Supporting Entities

```
┌──────────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│  PD Resource     │     │  Migration Mapping    │     │  Audit Log       │
│                  │     │                       │     │                  │
│  id              │     │  id                   │     │  id              │
│  snapshot_id(FK) │     │  evaluation_id (FK)   │     │  user_id (FK)    │
│  pd_type         │     │  pd_resource_id (FK)  │     │  action          │
│  pd_id           │     │  io_resource_type     │     │  entity_type     │
│  name            │     │  conversion_status    │     │  entity_id       │
│  team_ids[]      │     │    (auto|manual|skip  │     │  metadata_json   │
│  config_json     │     │     |unsupported)     │     │  ip_address      │
│  is_stale        │     │  effort_estimate      │     │  created_at      │
│  last_activity   │     │  notes                │     │                  │
│  dependencies[]  │     │  io_tf_snippet        │     └──────────────────┘
└──────────────────┘     └───────────────────────┘
```

### Encryption Strategy

| Field | Encryption | Rationale |
|-------|-----------|-----------|
| `pd_domain.api_token_enc` | AES-256-GCM, application-level | PD API tokens are the most sensitive data. Encrypted before storage, decrypted only in memory during API calls. |
| `config_snapshot.terraform_state` | AES-256-GCM, application-level | TF state may contain sensitive resource details. |
| `config_snapshot.resources_json` | AES-256-GCM, application-level | Contains full PD config metadata. |
| `incident_analysis.*_json` | AES-256-GCM, application-level | Incident data, alert sources, patterns. |
| All other fields | PostgreSQL TDE (Transparent Data Encryption) | Defense in depth. Encrypt the full database volume at rest. |

**Key management:** Application encryption keys stored in environment variables (dev) or a secrets manager (Vault, AWS Secrets Manager, GCP Secret Manager) in production. Keys are **never** stored in the database or source code.

---

## 5. Module 1: Config Export & Analysis

### Process Flow

```
User clicks "Export Config" on a PD Domain
        │
        ▼
  ┌─────────────────────────────────────┐
  │  Background Job: config_export      │
  │                                     │
  │  1. Validate PD API token           │
  │  2. Run Terraformer against PD      │
  │     domain for all resource types:  │
  │     - business_service              │
  │     - escalation_policy             │
  │     - ruleset (Event Orchestration) │
  │     - schedule                      │
  │     - service                       │
  │     - team                          │
  │     - user                          │
  │  3. Parse TF output → resource list │
  │  4. Enrich: cross-reference         │
  │     resources to build dependency   │
  │     graph (service → escalation →   │
  │     schedule → team → user)         │
  │  5. Detect stale resources:         │
  │     - Services with no recent       │
  │       incidents (>90 days)          │
  │     - Schedules with no overrides   │
  │     - Escalation policies with      │
  │       single targets                │
  │  6. Store as ConfigSnapshot         │
  └─────────────────────┬───────────────┘
                        │
                        ▼
  ┌─────────────────────────────────────┐
  │  Background Job: conversion_analysis│
  │                                     │
  │  For each PD resource, determine    │
  │  incident.io conversion status:     │
  │                                     │
  │  AUTO:                              │
  │  - schedule → incident_schedule     │
  │  - escalation_policy →              │
  │      incident_escalation_path       │
  │  - team → incident_catalog_entry    │
  │      (Team type)                    │
  │  - user → SCIM/SSO (not TF)        │
  │                                     │
  │  MANUAL:                            │
  │  - service → incident_catalog_entry │
  │      + alert routing rules          │
  │  - business_service → catalog type  │
  │      mapping (custom)               │
  │                                     │
  │  UNSUPPORTED (flag for review):     │
  │  - ruleset → no direct equivalent   │
  │      (needs workflow translation)   │
  │  - Complex EO rules → manual        │
  │      workflow design required       │
  │                                     │
  │  Generate: io_tf_snippet for each   │
  │  AUTO resource (draft TF code)      │
  └─────────────────────────────────────┘
```

### Terraformer Integration

Terraformer runs as a subprocess. The app shells out to it with the customer's PD token:

```bash
# Executed in a temporary directory per export
export PAGERDUTY_TOKEN="<decrypted_token>"
terraformer import pagerduty \
  -r business_service,escalation_policy,ruleset,schedule,service,team,user \
  -o /tmp/export-{evaluation_id}/
```

The output is parsed from the generated `.tf` files and `terraform.tfstate`. After parsing, the temp directory is deleted and the structured data is stored encrypted in the database.

**Security note:** The PD token is decrypted in memory, passed as an environment variable to the subprocess, and the environment is cleared immediately after. The token never hits disk.

### Conversion Mapping Table

| PD Resource | incident.io Resource | Conversion | Effort | Notes |
|-------------|---------------------|------------|--------|-------|
| `pagerduty_schedule` | `incident_schedule` | Auto | Low | Rotation layers, handoff times map cleanly. Multi-timezone schedules need validation. |
| `pagerduty_escalation_policy` | `incident_escalation_path` | Auto | Low | Up to 3 nesting levels supported. Repeat/loop behavior may differ. |
| `pagerduty_team` | `incident_catalog_entry` (Team) | Auto | Low | Team membership from SSO/SCIM. Catalog entry for metadata. |
| `pagerduty_user` | SSO/SCIM provisioned | Skip | None | Users come from IdP, not Terraform. Flag for SSO config. |
| `pagerduty_service` | `incident_catalog_entry` (Service) + alert routes | Manual | Medium | Service metadata maps to catalog. Integrations need manual repointing. |
| `pagerduty_business_service` | `incident_catalog_entry` (custom type) | Manual | Medium | Business service graph maps to catalog relationships. |
| `pagerduty_ruleset` | `incident_workflow` (partial) | Manual | High | Event Orchestration rules need manual translation to incident.io workflows. No 1:1 mapping. |

---

## 6. Module 2: Incident Data Analysis

### Process Flow

```
User selects Teams or Services to analyze → sets time range
        │
        ▼
  ┌─────────────────────────────────────┐
  │  Background Job: incident_pull      │
  │                                     │
  │  PD API calls (paginated):          │
  │                                     │
  │  1. GET /incidents                  │
  │     - filter: team_ids[] or         │
  │       service_ids[]                 │
  │     - date_range: user-selected     │
  │     - include[]: first_trigger_     │
  │       log_entries                   │
  │     - Paginate (100/page, PD max)   │
  │                                     │
  │  2. GET /services/{id}              │
  │     - include[]: integrations       │
  │     - Map: integration type →       │
  │       alert source identification   │
  │                                     │
  │  3. GET /log_entries                │
  │     - For sampled incidents         │
  │     - Identify: API-created actions,│
  │       webhook triggers, automation  │
  │       agent actions                 │
  │                                     │
  │  4. GET /analytics/raw/incidents    │
  │     - MTTR, engagement metrics      │
  │     - Limited to 1yr lookback       │
  │                                     │
  │  Rate limiting: respect PD's        │
  │  900 req/min (REST) with backoff    │
  └─────────────────────┬───────────────┘
                        │
                        ▼
  ┌─────────────────────────────────────┐
  │  Analysis Engine                    │
  │                                     │
  │  A. Volume & Distribution           │
  │  - Incidents/alerts per service     │
  │  - Time-of-day / day-of-week heat  │
  │  - Severity distribution            │
  │  - Top 10 noisiest services         │
  │                                     │
  │  B. Noise Analysis                  │
  │  - Auto-resolved % (no human ack)  │
  │  - Acknowledged but no action %    │
  │  - Escalated %                      │
  │  - Mean time to ack / resolve      │
  │  - Transient alert patterns         │
  │    (fire-resolve within N minutes)  │
  │                                     │
  │  C. Source Identification           │
  │  - Integration types sending events │
  │  - Volume per source (Datadog,      │
  │    CloudWatch, custom API, email)   │
  │  - Pre-filtered vs. raw assessment: │
  │    compare event count (if avail)   │
  │    vs. incident count               │
  │  - "Critical only" detection:       │
  │    are non-critical events being    │
  │    filtered before PD, or is PD     │
  │    receiving everything?            │
  │                                     │
  │  D. Shadow Stack Detection          │
  │  - Log entries with agent.type =    │
  │    'api_token_reference' → custom   │
  │    API integration                  │
  │  - Webhook destinations configured  │
  │    on services → outbound data flow │
  │  - Incidents created via API (not   │
  │    from monitoring integration) →   │
  │    custom tooling                   │
  │  - Patterns: auto-ack within        │
  │    seconds → auto-responder script  │
  │  - Patterns: incident notes added   │
  │    by API → enrichment middleware   │
  │  - Extensions configured (Slack,    │
  │    custom webhooks, etc.)           │
  │                                     │
  │  E. Migration Risk Signals          │
  │  - Services with >100 incidents/mo  │
  │    → high-volume, test carefully    │
  │  - Services with complex EO rules   │
  │    → manual workflow translation    │
  │  - Services with custom webhooks    │
  │    → shadow stack dependency        │
  │  - Teams with unique schedule       │
  │    patterns → validate carefully    │
  └─────────────────────────────────────┘
```

### PD API Rate Limiting Strategy

PagerDuty REST API allows 900 requests per minute (account-wide, not per-key).

```
Strategy:
1. Pre-calculate total API calls needed based on resource counts
2. Estimate time to completion, show progress bar
3. Use exponential backoff on 429 responses
4. Batch related requests (e.g., pull all services in one paginated call)
5. Cache: don't re-pull data that hasn't changed (use PD ETags where supported)
6. Allow user to cancel long-running pulls
```

### Analysis Time Ranges

| Range | Use Case |
|-------|----------|
| Last 30 days | Quick assessment. Good for initial meeting prep. |
| Last 90 days | Standard evaluation depth. Captures seasonal patterns. |
| Last 12 months | Full migration planning. Identifies yearly trends. Max depth for analytics API. |

User selects range when creating an evaluation. Default: 90 days.

---

## 7. UI Architecture

### Page Structure

```
/                        → Dashboard (recent evaluations, quick stats)
/login                   → Google OAuth + dev bypass
/customers               → Customer list
/customers/[id]          → Customer detail + PD domains
/customers/[id]/domains  → Domain management
/domains/[id]            → Domain detail: config snapshot, team/service list
/domains/[id]/evaluate   → Create new evaluation (select scope)
/evaluations/[id]        → Evaluation results (main analysis view)
/evaluations/[id]/report → Shareable report (printable/PDF)
/admin/users             → User management (admin only)
/admin/audit             → Audit log (admin only)
```

### Key Views

#### Dashboard
- Recent evaluations across all customers
- Quick stats: total customers, active evaluations, domains connected
- "New Customer" and "New Evaluation" quick actions

#### Customer Detail
- Customer info (name, industry, PD renewal date, notes)
- List of PD domains with connection status
- "Connect New Domain" flow: enter subdomain + API token → validate → save

#### Domain Detail (after config export)
- Resource inventory: services, teams, schedules, escalation policies (counts + list)
- Dependency graph visualization (service → escalation → schedule → team)
- Stale resource flags
- "Run Detailed Analysis" button → opens scope selector

#### Scope Selector
- Two modes: **By Team** or **By Service**
- Multi-select from the imported resource list
- Time range picker (30d / 90d / 12mo)
- "Analyze" kicks off the Module 2 background job

#### Evaluation Results (main deliverable)
Tabbed view:

| Tab | Content |
|-----|---------|
| **Overview** | Executive summary: key metrics, risk score, migration complexity rating |
| **Config Map** | Full resource inventory with conversion status (auto/manual/unsupported). Filterable table. |
| **Volume & Noise** | Charts: incident volume over time, noise ratio by service, severity distribution, time-of-day heatmap |
| **Alert Sources** | What monitoring tools send events, volume per source, pre-filtered vs. raw assessment |
| **Shadow Stack** | Detected shadow stack signals with evidence (API consumers, auto-ack patterns, webhook destinations, enrichment patterns) |
| **Migration Plan** | Auto-generated phased plan: what converts automatically (with draft TF), what needs manual effort, estimated timeline |
| **Report** | Printable/PDF summary for sharing with customer stakeholders |

---

## 8. Domain Connection Flow

### Adding a PD Domain

```
1. User enters PD subdomain (e.g., "acme" for acme.pagerduty.com)
2. User enters a read-only PD API key
3. App validates:
   a. API key works (GET /abilities)
   b. Key has read access to services, teams, incidents
   c. Subdomain matches the account on the key
4. On success:
   a. Encrypt API token with AES-256-GCM
   b. Store token_last4 for display ("••••a1b2")
   c. Store connection metadata
   d. Auto-trigger Module 1 config export
5. On failure:
   a. Show specific error (invalid key, insufficient permissions, wrong subdomain)
   b. Do not store anything
```

### Token Rotation

Customers may rotate their PD API keys. The app supports:
- "Update Token" action on a domain (validates new key, re-encrypts, replaces)
- "Validate Connection" action (tests existing key still works)
- Automatic validation check before any data pull (fail fast with clear error)

---

## 9. Background Job Architecture

### Job Types

| Job | Trigger | Duration | Retry | Priority |
|-----|---------|----------|-------|----------|
| `config_export` | User clicks "Export Config" or on domain connection | 2-10 min | 3x with backoff | Normal |
| `conversion_analysis` | Auto after config_export completes | 30-60 sec | 3x | Normal |
| `incident_data_pull` | User starts evaluation | 5-30 min (depends on volume + time range) | 3x with backoff | Normal |
| `analysis_engine` | Auto after incident_data_pull completes | 1-5 min | 3x | Normal |
| `report_generation` | User requests PDF/printable report | 10-30 sec | 2x | Low |
| `token_validation` | Daily cron + before any data pull | 5 sec | 1x | Low |

### Job Pipeline

```
config_export → conversion_analysis → (evaluation created) →
incident_data_pull → analysis_engine → report_generation
```

Each step stores its output. If a step fails, the pipeline stops and the evaluation shows the error state. Users can retry from the failed step.

### Progress Tracking

Jobs emit progress events via WebSocket (or SSE):
```typescript
// Frontend subscribes to evaluation progress
{
  job: "incident_data_pull",
  status: "running",
  progress: 45,           // percentage
  message: "Pulling incidents for service 12 of 28...",
  eta_seconds: 180
}
```

The UI shows a progress bar with ETA during long-running pulls.

---

## 10. Security

### Data Classification

| Data | Classification | Handling |
|------|---------------|----------|
| PD API tokens | **Critical** | AES-256-GCM app-level encryption. Never logged. Never in URLs. Decrypted only in memory for API calls. |
| PD incident data | **Confidential** | Encrypted columns. Contains alert titles, service names, team names — potentially sensitive operational data. |
| PD config data | **Confidential** | Encrypted columns. Contains service architecture, escalation paths — sensitive organizational data. |
| Analysis results | **Internal** | Standard DB storage with TDE. Derived data, less sensitive than source. |
| User sessions | **Internal** | JWT in httpOnly, secure, sameSite cookies. Short-lived (1hr) with refresh. |
| Audit logs | **Internal** | Append-only. Retained 2 years minimum. |

### Access Controls

- **Row-level security:** Users can only see customers/evaluations they created or that are assigned to their team. Admins see all.
- **API token access:** Only the background job worker decrypts tokens. The web UI never sees or returns decrypted tokens.
- **Audit trail:** Every data pull, evaluation creation, token access, and user action is logged with timestamp, user, IP, and action details.

### Data Retention

| Data | Retention | Rationale |
|------|-----------|-----------|
| PD API tokens | Until domain disconnected or customer deleted | Needed for re-pulls. Customer controls lifecycle. |
| Config snapshots | 12 months | Historical comparison across snapshots. |
| Incident analysis data | 12 months | Deal cycles can be long. Need historical evals. |
| Audit logs | 24 months | Compliance and security investigation. |
| Deleted customer data | Hard delete after 30-day soft delete | GDPR-style right to deletion. |

### Network Security

- HTTPS only. HSTS enabled.
- PD API calls made server-side only (never from browser).
- Database not publicly accessible. VPC/private network only.
- No PD data ever sent to third-party services (analytics, logging, etc.) without scrubbing.

---

## 11. Deployment

### Environments

| Environment | Purpose | Auth |
|-------------|---------|------|
| `local` | Developer workstation | Dev bypass enabled |
| `staging` | Pre-production testing | Google OAuth (incident.io domain) |
| `production` | Live tool | Google OAuth (incident.io domain) |

### Infrastructure (Recommended)

```
Hosting:      Vercel (Next.js native) or Railway/Render
Database:     Neon (serverless Postgres) or Supabase
Background:   Inngest (managed) or Railway worker + BullMQ + Redis
Secrets:      Vercel environment variables (dev) → Vault/AWS SM (prod)
Monitoring:   Sentry (errors) + Axiom (logs)
```

Alternatively, if incident.io prefers to self-host: Docker Compose for local dev, Kubernetes for production.

### Environment Variables

```bash
# Auth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=

# Database
DATABASE_URL=postgresql://...

# Encryption
ENCRYPTION_KEY=          # 256-bit key for AES-256-GCM
ENCRYPTION_KEY_ID=       # Key rotation support

# Background Jobs
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# Dev only
NEXT_PUBLIC_DEV_AUTH_BYPASS=false

# Optional
SENTRY_DSN=
```

---

## 12. Migration Report Output

The report generated by an evaluation is the primary deliverable. It should be shareable with customer stakeholders (exported as PDF or standalone HTML).

### Report Sections

1. **Executive Summary**
   - Customer name, PD domain, analysis date, scope
   - Key metrics: total services, total incidents (period), noise ratio, estimated migration complexity
   - Go/no-go migration readiness score

2. **Configuration Inventory**
   - Resource counts by type
   - Conversion status breakdown (auto / manual / unsupported)
   - Stale resources flagged for cleanup (don't migrate dead config)

3. **Operational Reality**
   - Top 10 services by incident volume
   - Alert source distribution (which monitoring tools, how much from each)
   - Noise analysis: what percentage of alerts are noise, what's actionable
   - Time-of-day patterns (when do incidents happen)

4. **Shadow Stack Detection**
   - Detected custom integrations (with evidence)
   - API consumers identified
   - Automation patterns found
   - Estimated maintenance burden of shadow stack

5. **Migration Plan**
   - Phase 1 (auto-convert): Resources with draft TF code ready
   - Phase 2 (manual effort): Resources needing human review with effort estimates
   - Phase 3 (skip/cleanup): Stale resources to decommission
   - Estimated timeline aligned to the 7-month migration playbook
   - Risk factors specific to this customer

6. **Recommendations**
   - Prioritized actions
   - Quick wins vs. heavy lifts
   - Shadow stack components to address first
   - Suggested pilot teams (based on complexity + volume data)

---

## 13. Phase 2: Customer Self-Service (Future)

The architecture supports eventual self-service with these additions:

| Current (Phase 1) | Addition for Phase 2 |
|-------------------|---------------------|
| Google OAuth (incident.io only) | Add customer OAuth flow (Google/GitHub/email magic link) |
| Internal users manage customers | Customers create their own accounts |
| SA triggers evaluations | Customer triggers evaluations with guided flow |
| Full analysis access | Gated report: summary free, detailed analysis requires incident.io contact |
| N/A | Lead capture: customer email + company → CRM integration |
| Internal database | Multi-tenant data isolation (schema-per-customer or row-level) |

The self-service version becomes a **lead generation engine**: customer runs their own assessment, sees the executive summary, and contacts incident.io for the detailed migration plan.

---

## 14. Development Phases

### Phase 1: MVP (4-6 weeks)

| Week | Deliverable |
|------|-------------|
| 1-2 | Project scaffold: Next.js + Prisma + NextAuth (Google + dev bypass). Customer CRUD. PD domain connection + token validation. |
| 3 | Module 1: Terraformer integration. Config export job. Resource parsing + storage. |
| 4 | Module 1: Conversion analysis engine. Config Map UI with auto/manual/unsupported status. |
| 5 | Module 2: PD API incident data pull. Basic volume + noise analysis. Alert source identification. |
| 6 | Module 2: Shadow stack detection. Evaluation results UI. Basic report generation. |

### Phase 2: Polish (2-3 weeks)

- Dependency graph visualization
- Time-of-day heatmaps and charts
- PDF report export
- Audit logging
- Admin user management
- Progress tracking WebSocket

### Phase 3: Self-Service Architecture (future)

- Customer auth flow
- Guided onboarding wizard
- Gated report with lead capture
- CRM integration (Salesforce/HubSpot)
- Usage analytics

---

## 15. Open Questions

| Question | Context | Decision Needed By |
|----------|---------|-------------------|
| Hosting preference? | Vercel/Railway (managed) vs. self-hosted (Docker/K8s). Affects deployment pipeline. | Before dev starts |
| Terraformer vs. direct API? | Terraformer is convenient but adds a binary dependency. Direct PD API calls give more control. Could do both: Terraformer for initial export, API for incremental updates. | Week 1 |
| incident.io TF provider access? | Need to test conversion mapping against actual provider. Do we have a test instance? | Week 3 |
| Data residency requirements? | If incident.io has EU customers, PD data may need to stay in-region. Affects DB hosting choice. | Before prod deploy |
| Branding for self-service? | Will this be an incident.io branded tool or a separate product? Affects domain, design system. | Phase 2 planning |
| PD API key scope guidance? | What's the minimum PD permission set needed? Need to document for customers. | Week 1 |

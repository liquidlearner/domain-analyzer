# PagerDuty Integration Detection — Implementation Spec v2

**For: Coding Agent Building Enterprise Integration Discovery Tool**
**Updated:** March 18, 2026
**Based on:** Live audit of pdt-orbitpay.pagerduty.com + revised detection model

---

## Critical Finding: The Three-Layer Integration Model

The original reference doc covered two layers: inbound integrations (per-service) and outbound extensions. A live audit revealed a **third layer that is arguably the most important in enterprise domains**: Incident Workflows.

| Layer | API Endpoint | What It Catches | Speed |
|---|---|---|---|
| **1. Extensions** | `GET /extensions` | Bidirectional syncs (ServiceNow, JIRA, Zendesk, etc.) | Instant |
| **2. Service Integrations** | `GET /services?includes=integrations` | Inbound event sources with vendor metadata | Fast |
| **3. Incident Workflows** | `GET /incident_workflows/{id}` | ServiceNow ticket creation, Slack channel creation, Zoom meetings, MS Teams chats, AWS Lambda invocations, Status Page updates | Fast but requires per-workflow detail fetch |
| **4. Alert Payload Inspection** | `GET /incidents/{id}/alerts` | Ground-truth source identification when vendor metadata is null | Slow, requires sampling |
| **5. Event Orchestrations** | `GET /event_orchestrations/{id}/router` | Dynamic routing patterns, global ingest funnels | Fast |

**In the OrbitPay domain, Layer 1 returned zero results. Layer 3 (Workflows) is where ServiceNow, Slack, MS Teams, Zoom, and AWS Lambda integrations actually live.**

---

## Layer 1: Extensions (unchanged)

```
GET /extensions?limit=100
```

Paginate. Classify by `extension_schema.id` / `extension_schema.summary`. This catches traditional bidirectional syncs. May return zero in workflow-driven domains.

---

## Layer 2: Service Integrations (unchanged, with caveat)

```
GET /services?includes=integrations&limit=100
```

Paginate. Classify by `vendor.id` / `vendor.summary`.

**Caveat:** In Terraform-provisioned domains, 60%+ of integrations may have `vendor: null`. These are typically Events API v2 integrations where vendor metadata was never set. You cannot identify the source from this metadata alone — fall through to Layer 4.

---

## Layer 3: Incident Workflows (NEW — CRITICAL)

This is the biggest gap in the original spec. PagerDuty's **Incident Workflows** engine can trigger actions in external systems without using the Extensions framework at all. In enterprise domains, this is often how ServiceNow, Slack, Zoom, and MS Teams are integrated.

### API Calls

```
# Step 1: List all workflows
GET /incident_workflows?limit=100

# Step 2: For each workflow, get full detail (steps and triggers)
GET /incident_workflows/{workflow_id}
```

The list endpoint returns workflow names and IDs but **does not return steps or triggers** — you must fetch each workflow individually to see its action configuration.

### What to Parse

Each workflow contains:

**`triggers[]`** — When the workflow runs:
- `trigger_type: "conditional"` — Auto-fires based on a condition (e.g., `incident.priority matches 'P1'`)
- `trigger_type: "manual"` — User-initiated
- `condition` field contains the CEL expression

**`steps[]`** — What the workflow does. Each step has:
- `name` — Human-readable step name
- `action_configuration.action_id` — **The key field for integration detection**

### action_id Patterns for Target Integrations

The `action_id` follows the pattern `pagerduty.com:{vendor}:{action}:{version}`. Parse the vendor segment to identify the integration:

| action_id Pattern | Integration | Example |
|---|---|---|
| `pagerduty.com:servicenow:*` | **ServiceNow** | `pagerduty.com:servicenow:create-incident:3` |
| `pagerduty.com:slack:*` | **Slack** | `pagerduty.com:slack:create-a-channel:4` |
| `pagerduty.com:microsoft-teams:*` | **MS Teams** | `pagerduty.com:microsoft-teams:create-ms-teams-chat:1` |
| `pagerduty.com:zoom:*` | **Zoom** | `pagerduty.com:zoom:create-zoom-meeting:1` |
| `pagerduty.com:jira:*` | **JIRA** | (not present in this domain, but expected pattern) |
| `pagerduty.com:salesforce:*` | **Salesforce** | (not present in this domain, but expected pattern) |
| `pagerduty.com:zendesk:*` | **Zendesk** | (not present in this domain, but expected pattern) |
| `pagerduty.com:logic:*` | **PD Native** | Loop/conditional logic steps |
| `pagerduty.com:incident-workflows:*` | **PD Native** | Built-in actions (add responders, etc.) |
| `pagerduty.com:roles:*` | **PD Native** | Role assignment |
| `pagerduty.com:tasks:*` | **PD Native** | Task creation |

### Additional Data in Workflow Steps

The `inputs[]` array on each step contains connection details:

- **ServiceNow:** `"name": "ServiceNow Connection", "value": "{connection_uuid}"` — Identifies which ServiceNow instance is connected
- **Slack:** `"name": "Workspace", "value": "{slack_workspace_id}"` — Identifies the Slack workspace (e.g., `T06SKEHEV7A`)
- **MS Teams:** `"name": "Microsoft Teams Organization", "value": "{org_uuid}"` — Identifies the Teams tenant (e.g., `dd649b90-2b30-45cb-a264-1130134c625e`)
- **Zoom:** No connection input — uses account-level OAuth

### What We Found in OrbitPay (Live Data)

| Workflow | Trigger | External Integrations Used |
|---|---|---|
| **ServiceNOW INC for P1 and P2** | Auto: `incident.priority matches 'P1' or 'P2'` + Manual | ServiceNow (create incident) |
| **.Declare Major Incident** | Auto: `incident.priority matches 'P1'` + Manual | Slack (channel, topic, messages, broadcast, link), Zoom (meeting), MS Teams (chat), Status Page |
| **Declare Major Incident - ops-srmr** | Auto: `incident.priority matches 'P1'` + Manual | Slack (channel, topic, messages, broadcast), MS Teams (chat), Status Page |
| **Add (Teams/slack) channel to incidents** | Manual + Conditional (empty) | MS Teams (conference bridge + chat) |
| **Create Incident Slack Channel** | (detail not fetched) | Slack |
| **Rename Incident Dedicated Slack Channel** | (detail not fetched) | Slack |
| **Log Creation AWS Lambda** (x2) | Manual + Auto | AWS Lambda |
| **SSL certificate auto-check** | (detail not fetched) | Unknown |
| **Grafana Test** | (detail not fetched) | Grafana |

**Revised Integration Status:**

| Integration | Found? | How |
|---|---|---|
| **ServiceNow** | **YES** | Workflow step `pagerduty.com:servicenow:create-incident:3` — auto-fires on P1/P2 |
| **Slack** | **YES** | Multiple workflow steps: channel creation, messaging, broadcasting, topic setting |
| **MS Teams** | **YES** | Workflow steps: dedicated chat, conference bridge |
| **Zoom** | **YES** | Workflow step `pagerduty.com:zoom:create-zoom-meeting:1` |
| **JIRA** | **NOT FOUND** | Not in extensions or workflows |
| **Salesforce** | **NOT FOUND** | Not in extensions or workflows |
| **Zendesk** | **NOT FOUND** | Not in extensions or workflows |

---

## Layer 4: Alert Payload Sampling (for source identification)

When service integrations have null vendor metadata, the only way to identify what's generating events is to inspect alert payloads.

### Smart Sampling Strategy for Large Domains

**Problem:** A large enterprise domain might have 1,000+ services, 100,000+ incidents, and multiple alerts per incident. You cannot inspect all of them.

**Key insight:** This is a *set discovery* problem, not a counting problem. You're identifying *which* sources exist, not how many events each sends. The set of unique sources converges rapidly.

### Algorithm

```
Phase 1: Bulk title scan (fast, broad coverage)
─────────────────────────────────────────────
GET /incidents?limit=100&sort_by=created_at:desc
  → Parse incident title for [Source] prefix pattern
  → Many monitoring tools (Datadog, CloudWatch, Splunk, NewRelic)
    inject a bracketed source name into the title
  → Build initial source set from title patterns
  → This one call covers 100 incidents instantly

Phase 2: Per-service targeted sampling (fills gaps)
───────────────────────────────────────────────────
For each service with null-vendor integrations:
  GET /incidents?service_ids[]={id}&limit=3&sort_by=created_at:desc
  For each incident:
    GET /incidents/{id}/alerts?limit=1
    Read: body.cef_details.source_origin
    Cache result keyed by integration_id
    → Once an integration_id is seen, skip all future alerts from it

Phase 3: Early termination
──────────────────────────
  - Stop sampling a service once ALL its integration_ids are mapped
  - Stop sampling the domain once no new sources have been found
    in the last N services (suggest N=20)
```

### Convergence Estimate

For a 672-service domain (like OrbitPay):
- Phase 1: 1 API call, covers ~100 incidents
- Phase 2: ~672 services × 3 incidents × (1 list + 1 alert) = ~4,000 calls worst case
- With integration_id caching + early termination: ~500–1,000 calls in practice
- Total runtime estimate: 2–4 minutes at PagerDuty's rate limits

### Fields to Extract from Alerts

```json
{
  "body.cef_details.source_origin": "datadoghq.com",
  "body.cef_details.source_component": "My Service",
  "body.cef_details.event_class": "",
  "integration.summary": "Events API v1",
  "integration.id": "PXXXXXX",
  "alert_key": "uuid-or-dedup-key"
}
```

---

## Layer 5: Event Orchestrations

### Global Dynamic Routing Detection

```
GET /event_orchestrations?limit=100
For each orchestration:
  GET /event_orchestrations/{id}/router
  GET /event_orchestrations/{id}/unrouted
```

### What to Detect

**Dynamic routing pattern** (seen in OrbitPay):
```json
{
  "actions": {
    "dynamic_route_to": {
      "lookup_by": "service_name",
      "regex": ".*",
      "source": "event.custom_details.service_name"
    }
  }
}
```

When you see `dynamic_route_to`, flag this as a **global ingest funnel**. It means:
- Events enter through one orchestration integration key
- They're fanned out to services based on a payload field
- Individual service integrations are just routing targets, not source identifiers
- **You must use alert payload inspection (Layer 4) to identify actual sources**

**Static routing with conditions:**
```json
{
  "conditions": [{"expression": "event.summary matches part '\"KYO\"'"}],
  "actions": {"route_to": "P3LFHFA"}
}
```

The condition expressions can reveal source identification patterns (e.g., routing based on event source names).

**Service-level orchestration rules:**
```
GET /event_orchestrations/services/{service_id}
```

These can contain event transformation rules, severity mapping, and additional routing. In OrbitPay, all Biz Ops services have empty service-level rules — all logic lives at the global orchestration layer.

---

## Layer 6: Slack Connections (Account-Level)

```
GET /slack_connections
```

This is the dedicated endpoint for account-level Slack integration. **May return 404** if the Slack integration is managed entirely through Incident Workflows rather than the traditional Slack connection model. In OrbitPay, this returns 404, but Slack is deeply integrated via workflows.

**Detection logic:** If `/slack_connections` returns 404, check Incident Workflows for `pagerduty.com:slack:*` action_ids before concluding Slack is not integrated.

---

## Complete Detection Algorithm

```
function detectIntegrations(apiKey):

  found = {}

  // Layer 1: Extensions (instant)
  extensions = GET /extensions (paginate)
  for each extension:
    classify by extension_schema.summary
    found[vendor] = {source: "extension", details: ...}

  // Layer 2: Slack connections (instant)
  try:
    slack = GET /slack_connections
    if slack.connections.length > 0:
      found["Slack"] = {source: "slack_connections", details: ...}
  catch 404:
    // Will check workflows in Layer 3

  // Layer 3: Incident Workflows (fast, critical)
  workflows = GET /incident_workflows (paginate)
  for each workflow:
    detail = GET /incident_workflows/{id}
    for each step in detail.steps:
      action_id = step.action_configuration.action_id
      vendor = action_id.split(":")[1]  // e.g., "servicenow", "slack", "microsoft-teams"
      if vendor not in PD_NATIVE_VENDORS:
        found[vendor] = {source: "workflow", workflow_name: ..., trigger: ..., details: ...}

  // Layer 4: Service integration vendor metadata (fast)
  services = GET /services?includes=integrations (paginate)
  null_vendor_services = []
  for each service:
    for each integration:
      if integration.vendor is not null:
        found[vendor.summary] = {source: "service_integration", ...}
      else:
        null_vendor_services.append(service)

  // Layer 5: Event orchestrations (fast)
  orchestrations = GET /event_orchestrations (paginate)
  for each orchestration:
    router = GET /event_orchestrations/{id}/router
    if router contains dynamic_route_to:
      flag as "global ingest funnel"
    else:
      extract source hints from routing conditions

  // Layer 6: Alert sampling for null-vendor services (slower, sampled)
  // Only run if there are unidentified services
  seen_integration_ids = set()
  for each service in null_vendor_services:
    incidents = GET /incidents?service_ids[]={id}&limit=3
    for each incident:
      alerts = GET /incidents/{id}/alerts?limit=1
      for each alert:
        if alert.integration.id not in seen_integration_ids:
          source = alert.body.cef_details.source_origin
          found[source] = {source: "alert_payload", ...}
          seen_integration_ids.add(alert.integration.id)

  return found
```

### PD Native Vendor Strings to Exclude

These `action_id` vendor segments are PagerDuty-native and should not be counted as external integrations:

```
pagerduty_native_vendors = {
  "incident-workflows",  // Built-in actions (add responders, etc.)
  "logic",               // Loop/conditional logic
  "roles",               // Role assignment
  "tasks",               // Task creation
  "status-pages",        // Status page posting (could be flagged separately)
}
```

---

## Required API Permissions

| Scope | Used For |
|---|---|
| `services.read` | List services and integrations |
| `extensions.read` | List extensions and extension schemas |
| `vendors.read` | Vendor lookup table |
| `incident_workflows.read` | List and inspect workflows |
| `incidents.read` | Incident listing and alert inspection |
| `event_orchestrations.read` | Orchestration rules and routing |

A **read-only API key** covers all of the above.

---

## API Rate Limiting Considerations

PagerDuty's REST API has rate limits (typically 900 requests/minute for full accounts). Our client enforces a conservative **500 requests/minute** limit to avoid impacting the customer's account. For the recommended algorithm:

- Layers 1–3, 5: ~50–100 API calls total. Negligible.
- Layer 4 (alert sampling): Up to ~4,000 calls for a 672-service domain. At our 500 req/min limit, this takes ~8 minutes worst case. With early termination and caching, expect 2–4 minutes.

**Recommendation:** Implement Layer 4 with a configurable concurrency limit (suggest 10 concurrent requests) and respect `429 Too Many Requests` responses with exponential backoff.

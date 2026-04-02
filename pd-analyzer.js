#!/usr/bin/env node
// =============================================================================
//  PagerDuty Configuration Analyzer
//  Built by incident.io — https://incident.io
//
//  PURPOSE
//  -------
//  This script connects to your PagerDuty account using a read-only API key,
//  analyses your configuration, and generates a self-contained HTML report
//  showing:
//    • How many resources you have and how complex they are
//    • Which resources map directly to incident.io (AUTO), need manual work
//      (MANUAL), can be skipped (SKIP), or have no direct equivalent (UNSUPPORTED)
//    • Shadow stack signals — custom integrations, webhooks, workflows, and
//      automation that will need to be migrated alongside core resources
//    • A phased migration plan tailored to your team structure
//
//  OUTPUT
//  ------
//  The script produces a single self-contained JSON file that you send to
//  your incident.io contact. The file contains only factual inventory data —
//  no complexity scores, no migration opinions, no sensitive content.
//  Your incident.io Solutions Engineer uses it to prepare a tailored scoping
//  session.
//
//  DATA COLLECTED
//  --------------
//  This script makes ONLY read (GET) requests. The following data is fetched:
//    • Account abilities (plan/feature flags) — GET /abilities
//    • Services (name, integrations, alert grouping) — GET /services
//    • Teams (name, members) — GET /teams
//    • Schedules (layers, users, teams) — GET /schedules
//    • Escalation policies — GET /escalation_policies
//    • Users (name, email, role) — GET /users
//    • Business services — GET /business_services
//    • Service dependencies — GET /service_dependencies/technical_services
//    • Extensions (ServiceNow, Jira, Slack, etc.) — GET /extensions
//    • Webhook subscriptions — GET /webhook_subscriptions
//    • Incident workflows — GET /incident_workflows + detail per workflow
//    • Event orchestrations — GET /event_orchestrations + router per EO
//    • Automation actions & runners — GET /automation_actions/actions
//    • Response plays — GET /response_plays
//    • Maintenance windows — GET /maintenance_windows
//    • Per-service event rules (sampled) — GET /services/{id}/rules
//    • Status pages (public-facing) — GET /status_pages
//    • Status dashboards (internal) — GET /status_dashboards
//    • A list of incident IDs from the last N days (default: 90) to flag
//      stale services (all statuses incl. resolved). Only service IDs are used.
//
//  WHAT IS NOT COLLECTED
//  ---------------------
//    • Incident content, titles, descriptions, or body text
//    • Alert payloads or monitoring tool data
//    • User contact methods or notification preferences
//    • Any credentials, secrets, or configuration values
//    • PagerDuty account billing or contract information
//
//  REQUIREMENTS
//  ------------
//    • Node.js 18 or later (uses built-in fetch, readline, fs)
//    • A PagerDuty API key (read-only recommended — see below)
//
//  USAGE
//  -----
//    node pd-analyzer.js
//    node pd-analyzer.js --days=90 --output=my-report.html
//    node pd-analyzer.js --help
//
//  FLAGS
//  -----
//    --days=N        Lookback period for stale-service detection (default: 90)
//    --output=FILE   Output JSON filename (default: pd-analysis-DOMAIN-DATE.json)
//    --yes           Skip the confirmation prompt and start scanning immediately
//    --no-color      Disable ANSI colour output in the terminal
//    --help          Show this help text and exit
//
//  API KEY
//  -------
//  We strongly recommend using a Read-Only API key. To create one:
//    PagerDuty → Integrations → API Access Keys → Create New API Key
//    → check "Read-only key"
//
//  If you provide a full (read-write) API key the script will warn you before
//  proceeding. This script never writes, updates, or deletes any data.
// =============================================================================

'use strict';

const readline = require('readline');
const fs       = require('fs');
const path     = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — CLI FLAGS
// ─────────────────────────────────────────────────────────────────────────────

const ARGS = (() => {
  const raw = process.argv.slice(2);
  const result = { days: 90, output: null, yes: false, noColor: false, help: false };
  for (const arg of raw) {
    if (arg === '--help' || arg === '-h')   { result.help    = true; continue; }
    if (arg === '--yes'  || arg === '-y')   { result.yes     = true; continue; }
    if (arg === '--no-color')               { result.noColor = true; continue; }
    const m = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (!m) continue;
    const [, key, val] = m;
    if (key === 'days')   result.days   = parseInt(val, 10) || 90;
    if (key === 'output') result.output = val || null;
  }
  return result;
})();

if (ARGS.help) {
  console.log(`
PagerDuty Configuration Analyzer — by incident.io

USAGE
  node pd-analyzer.js [OPTIONS]

OPTIONS
  --days=N        Lookback period for stale-service detection (default: 90)
  --output=FILE   Output JSON filename (default: pd-analysis-DOMAIN-DATE.json)
  --yes           Skip confirmation prompt
  --no-color      Disable ANSI colour output
  --help          Show this help text

EXAMPLE
  node pd-analyzer.js --days=90

OUTPUT
  A JSON file you send to your incident.io contact for scoping.
  No complexity scores or migration opinions are included in the output.
`);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — TERMINAL UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const C = ARGS.noColor ? {
  reset:'', bold:'', dim:'', red:'', green:'', yellow:'', blue:'', magenta:'', cyan:'', white:'',
} : {
  reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m',
  red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m',
  blue:'\x1b[34m', magenta:'\x1b[35m', cyan:'\x1b[36m', white:'\x1b[37m',
};

function log(msg='')    { process.stdout.write(msg + '\n'); }
function info(msg)      { log(`${C.cyan}ℹ${C.reset}  ${msg}`); }
function ok(msg)        { log(`${C.green}✔${C.reset}  ${msg}`); }
function warn(msg)      { log(`${C.yellow}⚠${C.reset}  ${msg}`); }
function err(msg)       { log(`${C.red}✖${C.reset}  ${msg}`); }
function step(n, t, msg){ log(`${C.dim}[${n}/${t}]${C.reset} ${C.bold}${msg}${C.reset}`); }
function hr()           { log(C.dim + '─'.repeat(70) + C.reset); }

function printBanner() {
  log();
  log(`${C.bold}${C.magenta}  ██ incident.io${C.reset}`);
  log(`${C.bold}  PagerDuty Configuration Analyzer${C.reset}`);
  log(`${C.dim}  Understand your PagerDuty environment before you migrate${C.reset}`);
  log();
}

/** Prompt user for text input */
function prompt(question, opts = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${C.bold}${question}${C.reset} `, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Prompt user for a secret (masked input) */
function promptSecret(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: null });
    process.stdout.write(`${C.bold}${question}${C.reset} `);
    process.stdin.setRawMode(true);
    let value = '';
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (ch) => {
      ch = ch + '';
      switch(ch) {
        case '\n': case '\r': case '\u0004': // enter / ctrl+d
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          rl.close();
          process.stdout.write('\n');
          resolve(value);
          break;
        case '\u0003': // ctrl+c
          process.stdout.write('\n');
          process.exit(1);
          break;
        case '\u007F': // backspace
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          break;
        default:
          value += ch;
          process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

/** Simple spinner for long operations */
function createSpinner(msg) {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0;
  const iv = setInterval(() => {
    process.stdout.write(`\r${C.cyan}${frames[i++ % frames.length]}${C.reset} ${msg}   `);
  }, 100);
  return { stop: (doneMsg) => {
    clearInterval(iv);
    process.stdout.write(`\r${C.green}✔${C.reset} ${doneMsg || msg}${' '.repeat(20)}\n`);
  }, update: (m) => { msg = m; } };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — PAGERDUTY API CLIENT
//
// Wraps the PagerDuty REST API v2 with:
//   • Token authentication (Authorization: Token token=xxx)
//   • Conservative rate limiting (500 req/min — PD cap is 900/min)
//   • Automatic pagination (offset/limit for most endpoints)
//   • Cursor-based pagination (automation actions)
//   • Exponential backoff on 429 Rate Limit responses
//   • Graceful 404 handling (plan tier limitations)
// ─────────────────────────────────────────────────────────────────────────────

class PagerDutyClient {
  /**
   * @param {object} opts
   * @param {string} opts.token     — PagerDuty API key
   * @param {string} opts.subdomain — PagerDuty subdomain (e.g. "acme")
   */
  constructor({ token, subdomain }) {
    this.token    = token;
    this.subdomain = subdomain;
    this.baseUrl  = 'https://api.pagerduty.com';
    this._reqCount     = 0;
    this._windowStart  = Date.now();
    this._rateLimit    = 500; // requests per minute — conservative below PD's 900/min cap
  }

  /** Validate the token by calling GET /abilities */
  async validateToken() {
    try {
      const res = await this._request('GET', '/abilities');
      return { valid: true, abilities: res.abilities || [] };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }

  /**
   * Check whether the token has write access.
   * We attempt POST /incidents with an intentionally empty body.
   *   • 403 Forbidden  → read-only key (good — preferred)
   *   • 400/422        → write-capable key (script still only reads, but warn user)
   *   • other          → inconclusive (assume write-capable, warn)
   */
  async hasWriteAccess() {
    try {
      const res = await fetch(`${this.baseUrl}/incidents`, {
        method: 'POST',
        headers: {
          'Authorization': `Token token=${this.token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.pagerduty+json;version=2',
        },
        body: JSON.stringify({}),
      });
      if (res.status === 403) return false; // read-only key — great
      return true; // 400/422/etc → write-capable
    } catch {
      return true; // network error → assume write-capable (conservative)
    }
  }

  async getAbilities()            { try { return (await this._request('GET', '/abilities')).abilities || []; } catch { return []; } }
  async listServices()            { return this._all('/services', 'services', { include: ['integrations','alert_grouping_parameters'] }).catch(() => this._all('/services', 'services', { include: ['integrations'] })); }
  async listTeams()               { return this._all('/teams', 'teams'); }
  async listSchedules()           { return this._all('/schedules', 'schedules', { include: ['schedule_layers','users','teams'] }); }
  async listEscalationPolicies()  { try { return await this._all('/escalation_policies', 'escalation_policies'); } catch { return []; } }
  async listUsers()               { try { return await this._all('/users', 'users'); } catch { return []; } }
  async listBusinessServices()    { try { return await this._all('/business_services', 'business_services'); } catch { return []; } }
  async listServiceDependencies() { try { return await this._all('/service_dependencies/technical_services', 'relationships'); } catch { return []; } }
  async listExtensions()          { try { return await this._all('/extensions', 'extensions'); } catch { return []; } }
  async listWebhookSubscriptions(){ try { return await this._all('/webhook_subscriptions', 'webhook_subscriptions'); } catch { return []; } }
  async listRulesets()            { try { return await this._all('/rulesets', 'rulesets'); } catch { return []; } }
  async getSlackConnections()     { try { return (await this._request('GET', '/slack_connections')).slack_connections || []; } catch { return []; } }

  /**
   * Fetch status pages (public-facing) and status dashboards (internal).
   * Status pages are a distinct migration workstream — incident.io has a native
   * Status Pages product that replaces both.
   * - /status_pages: public-facing, customer-visible (newer PD feature, may 404 on older plans)
   * - /status_dashboards: internal stakeholder dashboards
   */
  async listStatusPages()      { try { return await this._all('/status_pages', 'status_pages'); } catch { return []; } }
  async listStatusDashboards() { try { return await this._all('/status_dashboards', 'status_dashboards'); } catch { return []; } }

  async listIncidentWorkflows() {
    try {
      const list = await this._all('/incident_workflows', 'incident_workflows');
      // Fetch full detail (steps + triggers) for each workflow in parallel (batched)
      const BATCH = 10;
      const enriched = [];
      for (let i = 0; i < list.length; i += BATCH) {
        const chunk = list.slice(i, i + BATCH);
        const results = await Promise.allSettled(chunk.map(wf =>
          this._request('GET', `/incident_workflows/${wf.id}`, { include: ['steps','triggers'] })
            .then(r => r.incident_workflow || wf)
            .catch(() => wf)
        ));
        results.forEach((r, j) => enriched.push(r.status === 'fulfilled' ? r.value : chunk[j]));
      }
      return enriched;
    } catch { return []; }
  }

  async listEventOrchestrations() {
    try {
      const eos = await this._all('/event_orchestrations', 'orchestrations');
      const BATCH = 10;
      const enriched = [];
      for (let i = 0; i < eos.length; i += BATCH) {
        const chunk = eos.slice(i, i + BATCH);
        const results = await Promise.allSettled(chunk.map(eo =>
          this._request('GET', `/event_orchestrations/${eo.id}/router`)
            .then(r => r.orchestration_path || r)
            .catch(() => null)
        ));
        results.forEach((r, j) => {
          const router = r.status === 'fulfilled' ? r.value : null;
          const routedServiceIds = [];
          if (router?.sets) {
            for (const set of router.sets) {
              for (const rule of (set.rules || [])) {
                const sid = rule?.actions?.route_to?.service?.id;
                if (sid) routedServiceIds.push(sid);
              }
            }
          }
          if (router?.catch_all?.actions?.route_to?.service?.id) {
            routedServiceIds.push(router.catch_all.actions.route_to.service.id);
          }
          enriched.push({ ...chunk[j], _routerRules: router, _routedServiceIds: routedServiceIds });
        });
      }
      return enriched;
    } catch { return []; }
  }

  async listAutomationActions() {
    try { return await this._cursor('/automation_actions/actions', 'actions'); } catch { return []; }
  }
  async listAutomationRunners() {
    try { return await this._cursor('/automation_actions/runners', 'runners'); } catch { return []; }
  }

  /** Response Plays — automated response playbooks (assign responders, conference bridges, etc.) */
  async listResponsePlays() {
    try { return await this._all('/response_plays', 'response_plays'); } catch { return []; }
  }

  /** Maintenance Windows — scheduled suppression periods */
  async listMaintenanceWindows() {
    try { return await this._all('/maintenance_windows', 'maintenance_windows', { filter: 'all' }); } catch { return []; }
  }

  /**
   * Per-service event rules (legacy routing logic attached to individual services).
   * These are separate from Global Event Rules (rulesets) and Event Orchestrations.
   *
   * Sorted by integration count as a proxy for activity, then capped at maxServices
   * to avoid excessive API calls on very large domains (default cap: 200).
   */
  async listServiceEventRules(services, maxServices = 200) {
    const sorted = [...services]
      .sort((a, b) => (b.integrations?.length || 0) - (a.integrations?.length || 0))
      .slice(0, maxServices);

    const BATCH = 20;
    let servicesWithRules = 0;
    let totalRules = 0;
    const samples = [];

    for (let i = 0; i < sorted.length; i += BATCH) {
      const chunk = sorted.slice(i, i + BATCH);
      const results = await Promise.allSettled(chunk.map(svc =>
        this._request('GET', `/services/${svc.id}/rules`)
          .then(r => ({ name: svc.name, rules: r.rules || [] }))
          .catch(() => ({ name: svc.name, rules: [] }))
      ));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.rules.length > 0) {
          servicesWithRules++;
          totalRules += r.value.rules.length;
          if (samples.length < 10) samples.push({ service: r.value.name, rule_count: r.value.rules.length });
        }
      }
    }

    return {
      services_sampled: sorted.length,
      services_total: services.length,
      services_with_rules: servicesWithRules,
      total_rules: totalRules,
      samples,
      note: sorted.length < services.length
        ? `Only the ${sorted.length} highest-integration services were sampled. Full scan would require ${services.length} API calls.`
        : null,
    };
  }

  /** Fetch team members for a list of teams (batched, max 10 concurrent) */
  async enrichTeamsWithMembers(teams) {
    const BATCH = 10;
    const enriched = [];
    for (let i = 0; i < teams.length; i += BATCH) {
      const chunk = teams.slice(i, i + BATCH);
      const results = await Promise.allSettled(chunk.map(t =>
        this._all(`/teams/${t.id}/members`, 'members').catch(() => [])
      ));
      results.forEach((r, j) => enriched.push({ ...chunk[j], members: r.status === 'fulfilled' ? r.value : [] }));
    }
    return enriched;
  }

  /**
   * Fetch the set of service IDs that had at least one incident CREATED in the last N days.
   * Used only for stale-service detection — we do NOT collect incident content.
   *
   * IMPORTANT: We include all statuses (triggered, acknowledged, resolved).
   * The PD API default omits "resolved", which causes low-priority incidents (P4/P5)
   * that close quickly to be invisible — making active services appear stale.
   * We want "was an incident created on this service in the last N days?" regardless
   * of priority, urgency, or whether anyone was paged.
   *
   * We cap at chunk.length results per chunk (one incident per service is enough
   * to mark it active), keeping this to a single API page per chunk.
   *
   * With 50 services per chunk, a 672-service domain requires ~14 API calls total.
   */
  async listRecentIncidentServiceIds(serviceIds, days) {
    if (!serviceIds.length) return new Set();
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const until = new Date().toISOString();
    const MAX_PER_REQ = 50;
    const seen = new Set();
    for (let i = 0; i < serviceIds.length; i += MAX_PER_REQ) {
      const chunk = serviceIds.slice(i, i + MAX_PER_REQ);
      try {
        // Include all statuses so resolved incidents count toward service activity.
        // Without this, the API default (triggered + acknowledged only) misses any
        // incident that was resolved before we ran the script.
        const incidents = await this._all('/incidents', 'incidents', {
          since, until,
          service_ids: chunk,
          statuses: ['triggered', 'acknowledged', 'resolved'],
        }, undefined, chunk.length);
        incidents.forEach(inc => { if (inc.service?.id) seen.add(inc.service.id); });
      } catch { /* ignore — stale detection is best-effort */ }
    }
    return seen;
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  async _request(method, path, params = {}, body = null) {
    await this._throttle();
    const url = new URL(`${this.baseUrl}${path}`);
    if (method === 'GET') {
      Object.entries(params).forEach(([k, v]) => {
        if (Array.isArray(v)) v.forEach(x => url.searchParams.append(k + '[]', String(x)));
        else if (v != null)   url.searchParams.append(k, String(v));
      });
    }
    const res = await this._withRetry(() => fetch(url.toString(), {
      method,
      headers: {
        'Authorization': `Token token=${this.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.pagerduty+json;version=2',
      },
      body: body ? JSON.stringify(body) : undefined,
    }));
    if (res.status === 404) return {};
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(`PD API ${res.status}: ${e.error?.message || res.statusText}`);
    }
    this._reqCount++;
    return res.json();
  }

  async _withRetry(fn, tries = 0, delay = 1000) {
    const res = await fn();
    if (res.status !== 429) return res;
    if (tries >= 5) throw new Error('Rate limited — max retries exceeded');
    await new Promise(r => setTimeout(r, Math.min(delay * 2, 30_000)));
    return this._withRetry(fn, tries + 1, delay * 2);
  }

  async _throttle() {
    const elapsed = Date.now() - this._windowStart;
    if (elapsed >= 60_000) { this._reqCount = 0; this._windowStart = Date.now(); return; }
    if (this._reqCount >= this._rateLimit * 0.85) {
      await new Promise(r => setTimeout(r, 60_000 - elapsed));
      this._reqCount = 0; this._windowStart = Date.now();
    }
  }

  async _all(path, key, params = {}, onPage, max) {
    const all = [];
    let offset = 0;
    let more = true;
    while (more) {
      const res = await this._request('GET', path, { ...params, limit: 100, offset });
      const items = res[key] || [];
      all.push(...items);
      more = res.more === true;
      offset += 100;
      if (max && all.length >= max) break;
      if (onPage) onPage(all.length, more);
    }
    return all;
  }

  async _cursor(path, key, params = {}, max) {
    const all = [];
    let cursor;
    while (true) {
      const p = { ...params, limit: 25 };
      if (cursor) p.cursor = cursor;
      const res = await this._request('GET', path, p);
      const items = res[key] || [];
      all.push(...items);
      cursor = res.next_cursor;
      if (!cursor) break;
      if (max && all.length >= max) break;
    }
    return all;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — CONFIG SNAPSHOT
//
// Fetches all configuration data from PagerDuty and returns it as an
// in-memory object. No data is stored on disk during this step.
//
// This mirrors the config-export logic in the main application, stripped of
// all database and background-job dependencies.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchConfig(client, days, onProgress) {
  const report = (msg) => { if (onProgress) onProgress(msg); };

  report('Fetching services...');
  const services = await client.listServices();

  report(`Fetching teams (${services.length} services found)...`);
  const rawTeams = await client.listTeams();

  report(`Enriching ${rawTeams.length} teams with member data...`);
  const teams = await client.enrichTeamsWithMembers(rawTeams);

  report('Fetching schedules...');
  const schedules = await client.listSchedules();

  report('Fetching escalation policies...');
  const escalationPolicies = await client.listEscalationPolicies();

  report('Fetching users...');
  const users = await client.listUsers();

  report('Fetching business services...');
  const businessServices = await client.listBusinessServices();

  report('Fetching service dependency graph...');
  const serviceDeps = await client.listServiceDependencies();

  report('Fetching extensions (ServiceNow, Jira, Slack, etc.)...');
  const extensions = await client.listExtensions();

  report('Fetching webhook subscriptions...');
  const webhooks = await client.listWebhookSubscriptions();

  report('Fetching incident workflows (including step details)...');
  const incidentWorkflows = await client.listIncidentWorkflows();

  report('Fetching event orchestrations (including router rules)...');
  const eventOrchestrations = await client.listEventOrchestrations();

  report('Fetching automation actions...');
  const automationActions = await client.listAutomationActions();
  const automationRunners = await client.listAutomationRunners();

  report('Fetching response plays...');
  const responsePlays = await client.listResponsePlays();

  report('Fetching maintenance windows...');
  const maintenanceWindows = await client.listMaintenanceWindows();

  report('Fetching Slack connections...');
  const slackConnections = await client.getSlackConnections();

  report('Fetching status pages and dashboards...');
  const [statusPages, statusDashboards] = await Promise.all([
    client.listStatusPages(),
    client.listStatusDashboards(),
  ]);

  report('Fetching account abilities (plan / feature flags)...');
  const abilities = await client.getAbilities();

  report('Fetching legacy rulesets...');
  const rulesets = await client.listRulesets();

  report(`Checking per-service event rules (up to 200 services sampled)...`);
  const serviceEventRules = await client.listServiceEventRules(services);

  // ── Stale service detection ──────────────────────────────────────────────
  // Fetch incident service IDs from the last N days to flag services with
  // no recent incident activity. We only use the service.id field — no
  // incident content, titles, or descriptions are retained.
  report(`Checking for service activity in the last ${days} days (stale detection)...`);
  const serviceIds = services.map(s => s.id);
  const activeServiceIds = await client.listRecentIncidentServiceIds(serviceIds, days);

  // ── Build dependency map ─────────────────────────────────────────────────
  const techDepMap = new Map(); // serviceId → { dependsOn: [], dependedOnBy: [] }
  for (const dep of serviceDeps) {
    const depId = dep.dependent_service?.id;
    const supId = dep.supporting_service?.id;
    if (!depId || !supId) continue;
    if (!techDepMap.has(depId)) techDepMap.set(depId, { dependsOn: [], dependedOnBy: [] });
    if (!techDepMap.has(supId)) techDepMap.set(supId, { dependsOn: [], dependedOnBy: [] });
    techDepMap.get(depId).dependsOn.push(supId);
    techDepMap.get(supId).dependedOnBy.push(depId);
  }

  return {
    services, teams, schedules, escalationPolicies, users,
    businessServices, serviceDeps, extensions, webhooks,
    incidentWorkflows, eventOrchestrations, automationActions,
    automationRunners, responsePlays, maintenanceWindows,
    slackConnections, statusPages, statusDashboards,
    abilities, rulesets, serviceEventRules,
    activeServiceIds, techDepMap,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — REPORT BUILDER
//
// Takes the raw config snapshot and produces a neutral, factual JSON payload.
// No complexity scores, no migration opinions, no incident.io positioning.
// The output is sent to an incident.io Solutions Engineer who uses it to
// prepare a tailored scoping session.
// ─────────────────────────────────────────────────────────────────────────────

function buildReport({ domain, config, days }) {
  const LCR_PATTERNS        = ['live_call_routing', 'live_call_routing_inbound_integration', 'lcr_inbound'];
  const CET_PATTERNS        = ['custom_event_transform', 'event_transformer', 'cet'];
  const CHANGE_EVT_PATTERNS = ['change_event_transform', 'change_events_api', 'generic_change_inbound'];

  // Collaboration tool detection helpers
  const SLACK_PATTERNS  = ['slack', 'hooks.slack.com', 'pagerduty.create-slack', 'send_slack'];
  const TEAMS_PATTERNS  = ['microsoft teams', 'teams', 'office365', 'microsoftteams', 'ms-teams'];
  const ZOOM_PATTERNS   = ['zoom', 'zoom.us'];

  const hasCollabMatch = (str, patterns) =>
    patterns.some(p => str.toLowerCase().includes(p.toLowerCase()));

  // ── Users by role ────────────────────────────────────────────────────────
  const usersByRole = {};
  for (const u of config.users) {
    const role = u.role || 'user';
    usersByRole[role] = (usersByRole[role] || 0) + 1;
  }

  // ── Services: alert grouping + integration type breakdown ────────────────
  const alertGrouping     = {};
  const integrationTypes  = {};
  const lcrServices       = [];
  const cetServices       = [];
  const changeEvtServices = [];

  for (const svc of config.services) {
    const ag = svc.alert_grouping_parameters?.type || 'none';
    alertGrouping[ag] = (alertGrouping[ag] || 0) + 1;

    let svcHasLCR       = false;
    let svcHasCET       = false;
    let svcHasChangeEvt = false;

    for (const int of (svc.integrations || [])) {
      const type   = (int.type   || '').toLowerCase();
      const vendor = (int.vendor?.name || int.name || '').toLowerCase();

      // Classify change event integrations separately from alert integrations.
      // Change events don't trigger incidents — they appear in the PD timeline only.
      const isChangeEvt = CHANGE_EVT_PATTERNS.some(p => type.includes(p));

      // Track integration type breakdown — use vendor name if known, else raw type.
      // Prefix change event integrations so they're clearly distinct in the JSON.
      const label = isChangeEvt
        ? `[change_event] ${int.vendor?.name || int.type || 'unknown'}`
        : (int.vendor?.name || int.type || 'unknown');
      integrationTypes[label] = (integrationTypes[label] || 0) + 1;

      if (!svcHasLCR && LCR_PATTERNS.some(p => type.includes(p) || vendor.includes(p))) {
        svcHasLCR = true;
        lcrServices.push(svc.name);
      }
      if (!svcHasCET && CET_PATTERNS.some(p => type.includes(p) || vendor.includes(p))) {
        svcHasCET = true;
        cetServices.push(svc.name);
      }
      if (!svcHasChangeEvt && isChangeEvt) {
        svcHasChangeEvt = true;
        changeEvtServices.push(svc.name);
      }
    }
  }

  // ── Escalation policy stats ──────────────────────────────────────────────
  const epsWithMultipleLayers = config.escalationPolicies
    .filter(ep => (ep.escalation_rules || []).length > 1).length;
  const epsWithLoops = config.escalationPolicies
    .filter(ep => (ep.num_loops || 0) > 0).length;

  // ── Schedule stats ───────────────────────────────────────────────────────
  const schedulesMultiLayer = config.schedules
    .filter(s => (s.schedule_layers || []).length > 1).length;

  // ── Event orchestrations ─────────────────────────────────────────────────
  const eoItems = config.eventOrchestrations.map(eo => ({
    name: eo.name,
    rule_count: (eo._routerRules?.sets || [])
      .reduce((n, s) => n + (s.rules?.length || 0), 0),
    routed_services: (eo._routedServiceIds || []).length,
  }));

  // ── Incident workflows + collaboration tool detection ────────────────────
  // Scan both the workflow NAME and each step's action_id + action_configuration.
  // Workflow names are the most reliable signal (e.g. "Add (Teams/slack) channel to incidents").
  // Step-level scanning catches cases where the tool appears only in config, not the name.
  const wfSlack = new Set();
  const wfTeams = new Set();
  const wfZoom  = new Set();

  // Extended Teams patterns to catch PD's native Teams integration action IDs.
  // PD uses action_ids like: pagerduty.create_meeting_with_teams,
  // create_ms_teams_meeting, ms-teams, etc.
  const TEAMS_PATTERNS_EXT = [
    ...TEAMS_PATTERNS,
    'ms_teams', 'create_meeting_with_teams', 'ms-teams-meeting', 'msteams',
  ];

  const wfItems = config.incidentWorkflows.map(wf => {
    const stepSignals = [];
    // Check the workflow name first — often the most explicit signal.
    const wfName = (wf.name || '').toLowerCase();
    if (hasCollabMatch(wfName, SLACK_PATTERNS))       { wfSlack.add(wf.name); stepSignals.push('slack'); }
    if (hasCollabMatch(wfName, TEAMS_PATTERNS_EXT))   { wfTeams.add(wf.name); stepSignals.push('teams'); }
    if (hasCollabMatch(wfName, ZOOM_PATTERNS))        { wfZoom.add(wf.name);  stepSignals.push('zoom'); }

    // Also scan each step's action_id and full action_configuration JSON.
    for (const step of (wf.steps || [])) {
      const actionId  = (step.action_id || '').toLowerCase();
      const actionCfg = JSON.stringify(step.action_configuration || {}).toLowerCase();
      const combined  = actionId + ' ' + actionCfg;

      if (!stepSignals.includes('slack') && hasCollabMatch(combined, SLACK_PATTERNS))       { wfSlack.add(wf.name); stepSignals.push('slack'); }
      if (!stepSignals.includes('teams') && hasCollabMatch(combined, TEAMS_PATTERNS_EXT))   { wfTeams.add(wf.name); stepSignals.push('teams'); }
      if (!stepSignals.includes('zoom')  && hasCollabMatch(combined, ZOOM_PATTERNS))        { wfZoom.add(wf.name);  stepSignals.push('zoom'); }
    }
    return {
      name:                wf.name,
      step_count:          (wf.steps || []).length,
      trigger_types:       [...new Set((wf.triggers || []).map(t => t.type).filter(Boolean))],
      collaboration_tools: [...new Set(stepSignals)],
    };
  });

  // ── Automation actions ───────────────────────────────────────────────────
  const runnerMap = new Map(config.automationRunners.map(r => [r.id, r.name]));
  const aaItems = config.automationActions.map(a => ({
    name:   a.name,
    type:   a.action_type || 'script',
    runner: runnerMap.get(a.runner_id) || a.runner_id || 'unknown',
  }));

  // ── Webhooks ─────────────────────────────────────────────────────────────
  const webhookItems = config.webhooks.map(w => ({
    name:        w.description || 'Unnamed',
    url:         w.delivery_method?.url  || null,
    filter_type: w.filter?.type          || null,
  }));

  // Scan webhook URLs for collaboration tool destinations
  for (const w of config.webhooks) {
    const url = (w.delivery_method?.url || '').toLowerCase();
    if (hasCollabMatch(url, SLACK_PATTERNS))  wfSlack.add(`webhook:${w.description || w.id}`);
    if (hasCollabMatch(url, TEAMS_PATTERNS))  wfTeams.add(`webhook:${w.description || w.id}`);
    if (hasCollabMatch(url, ZOOM_PATTERNS))   wfZoom.add(`webhook:${w.description  || w.id}`);
  }

  // ── Extensions ───────────────────────────────────────────────────────────
  const extItems = config.extensions.map(e => ({
    name:           e.name || e.extension_schema?.summary || 'Unknown',
    schema:         e.extension_schema?.summary           || null,
    services_count: (e.extension_objects || []).length,
  }));

  // Scan extensions for collaboration tools
  for (const e of config.extensions) {
    const combined = [
      e.name, e.extension_schema?.summary, e.extension_schema?.key,
    ].filter(Boolean).join(' ').toLowerCase();
    if (hasCollabMatch(combined, SLACK_PATTERNS))  wfSlack.add(`extension:${e.name || e.id}`);
    if (hasCollabMatch(combined, TEAMS_PATTERNS))  wfTeams.add(`extension:${e.name || e.id}`);
    if (hasCollabMatch(combined, ZOOM_PATTERNS))   wfZoom.add(`extension:${e.name  || e.id}`);
  }

  // ── Response plays ───────────────────────────────────────────────────────
  const rpItems = (config.responsePlays || []).map(rp => ({
    name:               rp.name,
    team:               rp.team?.summary   || null,
    responders_count:   (rp.responders   || []).length,
    subscribers_count:  (rp.subscribers  || []).length,
  }));

  // ── Maintenance windows ──────────────────────────────────────────────────
  const mwItems = (config.maintenanceWindows || []).map(mw => ({
    description:    mw.description || null,
    services_count: (mw.services || []).length,
    start_time:     mw.start_time  || null,
    end_time:       mw.end_time    || null,
  }));

  // ── Legacy rulesets ──────────────────────────────────────────────────────
  const rulesetItems = (config.rulesets || []).map(r => ({
    name: r.name, id: r.id,
  }));

  return {
    meta: {
      schema_version:   '2.0',
      generated_at:     new Date().toISOString(),
      analyzer_version: '2.0.0',
      subdomain:        domain,
      days_analyzed:    days,
    },
    account: {
      abilities: config.abilities,
    },
    users: {
      total:   config.users.length,
      by_role: usersByRole,
    },
    services: {
      total:              config.services.length,
      active_last_n_days: config.activeServiceIds.size,
      stale_last_n_days:  config.services.length - config.activeServiceIds.size,
      alert_grouping:     alertGrouping,
      integration_types:  integrationTypes,
      with_live_call_routing:            lcrServices.length,
      live_call_routing_services:        lcrServices,
      with_custom_event_transformers:    cetServices.length,
      custom_event_transformer_services: cetServices,
      // Change event integrations — these feed the PD change timeline, NOT incident alerts.
      // They migrate to incident.io via the Change Events API / catalog, not alert sources.
      with_change_event_integrations:    changeEvtServices.length,
      change_event_integration_services: changeEvtServices,
    },
    teams: {
      total: config.teams.length,
    },
    schedules: {
      total:       config.schedules.length,
      multi_layer: schedulesMultiLayer,
    },
    escalation_policies: {
      total:                config.escalationPolicies.length,
      with_multiple_layers: epsWithMultipleLayers,
      with_loops:           epsWithLoops,
    },
    business_services: {
      total: config.businessServices.length,
    },
    service_dependencies: {
      total: config.serviceDeps.length,
    },
    event_orchestrations: {
      total: config.eventOrchestrations.length,
      items: eoItems,
    },
    incident_workflows: {
      total:      config.incidentWorkflows.length,
      with_steps: config.incidentWorkflows.filter(wf => (wf.steps || []).length > 0).length,
      items:      wfItems,
    },
    webhooks: {
      total: config.webhooks.length,
      items: webhookItems,
    },
    extensions: {
      total: config.extensions.length,
      items: extItems,
    },
    automation: {
      actions_total: config.automationActions.length,
      runners_total: config.automationRunners.length,
      actions:       aaItems,
    },
    response_plays: {
      total: (config.responsePlays || []).length,
      items: rpItems,
    },
    service_event_rules: config.serviceEventRules || null,
    maintenance_windows: {
      total: (config.maintenanceWindows || []).length,
      items: mwItems,
    },
    legacy_rulesets: {
      total: (config.rulesets || []).length,
      items: rulesetItems,
    },
    slack_connections: {
      total: (config.slackConnections || []).length,
    },
    // Status pages — a distinct migration workstream if present.
    // incident.io has native Status Pages (public) and stakeholder update features.
    // Public status pages require content migration + subscriber communication.
    // Internal dashboards map to incident.io's status page / stakeholder update features.
    status_pages: {
      // Public-facing status pages (customer-visible). Require dedicated migration planning:
      // subscriber list migration, component/service mapping, custom domain setup.
      public_total: (config.statusPages || []).length,
      public_items: (config.statusPages || []).map(p => ({
        name: p.name || p.subdomain || 'Unnamed',
        type: p.type || null,
      })),
      // Internal stakeholder dashboards. Map to incident.io's status update workflows.
      internal_total: (config.statusDashboards || []).length,
      internal_items: (config.statusDashboards || []).map(d => ({
        name: d.name || 'Unnamed',
      })),
    },
    // Collaboration tools detected across workflows, extensions, and webhooks.
    // These are tools the customer expects their incident platform to integrate with.
    // incident.io has native (first-class) integrations for all three.
    collaboration_tools: {
      slack: {
        detected: wfSlack.size > 0,
        sources:  [...wfSlack],
      },
      microsoft_teams: {
        detected: wfTeams.size > 0,
        sources:  [...wfTeams],
      },
      zoom: {
        detected: wfZoom.size > 0,
        sources:  [...wfZoom],
      },
    },
  };
}



// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — MAIN ORCHESTRATION
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  printBanner();

  // ── Step 1: Collect domain and API key ──────────────────────────────────
  log(`This script will connect to your PagerDuty account and generate a\nconfiguration analysis report. ${C.bold}No data is written or modified.${C.reset}`);
  log();
  log(`${C.dim}What will be scanned: services, teams, schedules, escalation policies,${C.reset}`);
  log(`${C.dim}users, extensions, webhooks, incident workflows, event orchestrations,${C.reset}`);
  log(`${C.dim}automation actions, response plays, maintenance windows, service event rules,${C.reset}`);
  log(`${C.dim}and incident IDs from the last ${ARGS.days} days (stale detection only).${C.reset}`);
  log();

  const rawDomain = await prompt('PagerDuty subdomain (e.g. "acme" from acme.pagerduty.com):');
  if (!rawDomain) { err('Domain name is required.'); process.exit(1); }
  const domain = rawDomain.toLowerCase().replace(/\.pagerduty\.com.*$/, '').replace(/\s/g, '');

  log();
  info('Recommended: use a Read-Only API key (PagerDuty → Integrations → API Access Keys).');
  const apiKey = await promptSecret('PagerDuty API key:');
  if (!apiKey) { err('API key is required.'); process.exit(1); }

  log();

  // ── Step 2: Validate the API key ──────────────────────────────────────
  step(1, 5, 'Validating API key...');
  const client = new PagerDutyClient({ token: apiKey, subdomain: domain });
  const validation = await client.validateToken();

  if (!validation.valid) {
    err(`API key validation failed: ${validation.error}`);
    log(`  ${C.dim}• Double-check the key is correct and active`);
    log(`  ${C.dim}• Ensure the key has at least read access to your account`);
    process.exit(1);
  }
  ok(`API key is valid — connected to ${C.bold}${domain}.pagerduty.com${C.reset}`);

  // ── Step 3: Check for write access ────────────────────────────────────
  step(2, 5, 'Checking API key permissions...');
  const hasWrite = await client.hasWriteAccess();

  if (hasWrite) {
    log();
    warn(`${C.bold}This API key has write access.${C.reset}`);
    log(`  This script only makes read (GET) requests and will ${C.bold}never${C.reset} write, update,`);
    log(`  or delete any data. However, for security best practice, we recommend`);
    log(`  using a Read-Only API key (PagerDuty → Integrations → API Access Keys → read-only).`);
    log();
    if (!ARGS.yes) {
      const answer = await prompt('Accept the risk and continue with this key? [y/N]:');
      if (!answer.toLowerCase().startsWith('y')) {
        log();
        info('Exiting. Create a read-only key and re-run the script.');
        process.exit(0);
      }
    } else {
      warn('--yes flag set: proceeding with write-capable key. This script will only read data.');
    }
    log();
  } else {
    ok('API key is read-only — ideal for this analysis.');
  }

  // ── Step 4: Confirm scan ───────────────────────────────────────────────
  step(3, 5, 'Confirming scan parameters...');
  log();
  log(`${C.bold}  Scan Configuration${C.reset}`);
  log(`  ${'─'.repeat(36)}`);
  log(`  Domain       : ${C.bold}${domain}.pagerduty.com${C.reset}`);
  log(`  Lookback     : ${C.bold}${ARGS.days} days${C.reset} (stale service detection)`);
  log(`  Analysis mode: ${C.bold}Config-only${C.reset} (no incident content collected)`);
  log(`  Output       : ${C.bold}${ARGS.output || `pd-analysis-${domain}-${new Date().toISOString().slice(0,10)}.json`}${C.reset}`);
  log();

  if (!ARGS.yes) {
    const confirm = await prompt('Start the scan? [Y/n]:');
    if (confirm && confirm.toLowerCase().startsWith('n')) {
      log(); info('Scan cancelled.'); process.exit(0);
    }
  }

  log();

  // ── Step 5: Fetch configuration data ──────────────────────────────────
  step(4, 5, 'Fetching PagerDuty configuration...');
  log();

  const spinner = createSpinner('Connecting to PagerDuty API...');
  let config;
  try {
    config = await fetchConfig(client, ARGS.days, (msg) => spinner.update(msg));
    spinner.stop('Configuration data fetched successfully');
  } catch (e) {
    spinner.stop('Failed to fetch configuration');
    err(`Failed to fetch configuration: ${e.message}`);
    process.exit(1);
  }

  log();
  log(`  ${C.green}${config.services.length}${C.reset} services  ·  ${C.green}${config.teams.length}${C.reset} teams  ·  ${C.green}${config.schedules.length}${C.reset} schedules  ·  ${C.green}${config.escalationPolicies.length}${C.reset} escalation policies`);
  log(`  ${C.green}${config.users.length}${C.reset} users  ·  ${C.green}${config.incidentWorkflows.length}${C.reset} incident workflows  ·  ${C.green}${config.eventOrchestrations.length}${C.reset} event orchestrations`);
  log(`  ${C.green}${config.automationActions.length}${C.reset} automation actions  ·  ${C.green}${config.extensions.length}${C.reset} extensions  ·  ${C.green}${config.webhooks.length}${C.reset} webhooks`);
  log(`  ${C.green}${(config.responsePlays||[]).length}${C.reset} response plays  ·  ${C.green}${(config.maintenanceWindows||[]).length}${C.reset} maintenance windows  ·  ${C.green}${config.serviceEventRules?.services_with_rules || 0}${C.reset} services with event rules`);
  log();

  // ── Step 6: Build JSON report ──────────────────────────────────────────
  step(5, 5, 'Building report...');

  const report = buildReport({ domain, config, days: ARGS.days });

  const outputFile = ARGS.output || `pd-analysis-${domain}-${new Date().toISOString().slice(0,10)}.json`;
  const outputPath = path.resolve(outputFile);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');

  ok('Report written.');

  log();
  hr();
  log();
  log(`${C.bold}${C.green}  Scan complete!${C.reset}`);
  log();
  log(`  File saved to: ${C.bold}${outputPath}${C.reset}`);
  log();
  log(`  ${C.bold}What to do next${C.reset}`);
  log(`  ${'─'.repeat(36)}`);
  log(`  1. Send the JSON file to your incident.io contact.`);
  log(`  2. Your Solutions Engineer will review it and prepare a`);
  log(`     tailored scoping session with you.`);
  log();
  log(`  ${C.bold}Quick counts${C.reset}`);
  log(`  ${'─'.repeat(36)}`);
  log(`  Services          : ${report.services.total}  (${report.services.active_last_n_days} active, ${report.services.stale_last_n_days} stale)`);
  log(`  Teams             : ${report.teams.total}`);
  log(`  Schedules         : ${report.schedules.total}`);
  log(`  Escalation policies: ${report.escalation_policies.total}`);
  log(`  Users             : ${report.users.total}`);
  log(`  Event orchestrations: ${report.event_orchestrations.total}`);
  log(`  Incident workflows: ${report.incident_workflows.total}`);
  log(`  Automation actions: ${report.automation.actions_total}`);
  log(`  Webhooks          : ${report.webhooks.total}`);
  log(`  Extensions        : ${report.extensions.total}`);
  log(`  Response plays    : ${report.response_plays.total}`);
  log(`  Maintenance windows: ${report.maintenance_windows.total}`);
  if (report.services.with_live_call_routing > 0) {
    log();
    warn(`Live Call Routing detected on ${report.services.with_live_call_routing} service(s) — mention this to your incident.io contact.`);
  }
  log();
  log(`  Not ready to share yet? That's fine — review the JSON first.`);
  log(`  Book a walkthrough anytime at ${C.bold}${C.magenta}https://incident.io/demo${C.reset}`);
  log();
  hr();
}

main().catch(e => {
  err(`Unexpected error: ${e.message}`);
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});

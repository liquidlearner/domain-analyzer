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
//    --days=N          Lookback period for stale-service detection (default: 90)
//    --output=FILE     Output JSON filename (default: pd-analysis-DOMAIN-DATE.json)
//    --rate-limit=N    Max API requests per minute (default: 300, range: 50–900)
//                      PagerDuty's hard cap is 900/min. The default 300 leaves
//                      ample headroom for concurrent production API traffic.
//                      Use 150 or lower for large enterprise accounts where
//                      scan safety matters more than speed.
//    --token=KEY       PagerDuty API key (skips interactive prompt, useful for CI/scripting)
//    --subdomain=S     PagerDuty subdomain (skips interactive prompt, useful for CI/scripting)
//    --yes             Skip the confirmation prompt and start scanning immediately
//    --no-color        Disable ANSI colour output in the terminal
//    --help            Show this help text and exit
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
  const result = { days: 90, output: null, yes: false, noColor: false, help: false, token: null, subdomain: null, rateLimit: 300 };
  for (const arg of raw) {
    if (arg === '--help' || arg === '-h')   { result.help    = true; continue; }
    if (arg === '--yes'  || arg === '-y')   { result.yes     = true; continue; }
    if (arg === '--no-color')               { result.noColor = true; continue; }
    const m = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (!m) continue;
    const [, key, val] = m;
    if (key === 'days')        result.days       = parseInt(val, 10) || 90;
    if (key === 'output')      result.output     = val || null;
    if (key === 'token')       result.token      = val || null;
    if (key === 'subdomain')   result.subdomain  = val || null;
    if (key === 'rate-limit') {
      const n = parseInt(val, 10);
      // Accept any value between 50 and 900 (PD's hard cap is 900/min).
      // Default 300 — leaves ample headroom for concurrent production traffic.
      if (n >= 50 && n <= 900) result.rateLimit = n;
      else { console.error(`--rate-limit must be between 50 and 900 (got ${val}). Using default 300.`); }
    }
  }
  return result;
})();

if (ARGS.help) {
  console.log(`
PagerDuty Configuration Analyzer — by incident.io

USAGE
  node pd-analyzer.js [OPTIONS]

OPTIONS
  --days=N          Lookback period for stale-service detection (default: 90)
  --output=FILE     Output JSON filename (default: pd-analysis-DOMAIN-DATE.json)
  --rate-limit=N    Max API requests per minute (default: 300, max: 900)
  --yes             Skip confirmation prompt
  --no-color        Disable ANSI colour output
  --help            Show this help text

EXAMPLE
  node pd-analyzer.js --days=90
  node pd-analyzer.js --rate-limit=150   # extra conservative for large enterprise

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
  constructor({ token, subdomain, rateLimit = 300 }) {
    this.token    = token;
    this.subdomain = subdomain;
    this.baseUrl  = 'https://api.pagerduty.com';
    this._reqCount     = 0;
    this._windowStart  = Date.now();
    // Default 300 req/min — well below PD's hard cap of 900/min.
    // Leaves headroom for concurrent production traffic on the customer's account.
    // Override with --rate-limit=N (50–900).
    this._rateLimit    = Math.min(Math.max(rateLimit, 50), 900);
    this._callLog      = []; // audit log for data-access explainer output
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
  async listServices()            { return this._all('/services', 'services', { include: ['integrations','alert_grouping_parameters','teams'] }).catch(() => this._all('/services', 'services', { include: ['integrations'] })); }
  async listTeams()               { return this._all('/teams', 'teams'); }
  async listSchedules()           { return this._all('/schedules', 'schedules', { include: ['schedule_layers','users','teams'] }); }
  async listEscalationPolicies()  { try { return await this._all('/escalation_policies', 'escalation_policies'); } catch { return []; } }
  async listUsers()               { try { return await this._all('/users', 'users'); } catch { return []; } }
  async listBusinessServices()    { try { return await this._all('/business_services', 'business_services'); } catch { return []; } }
  async listServiceDependencies() { try { return await this._all('/service_dependencies/technical_services', 'relationships'); } catch { return []; } }

  /**
   * For each business service, fetch which technical services support it.
   * Uses GET /service_dependencies/business_services/{id}.
   * Capped at 50 business services to keep API calls reasonable.
   */
  async enrichBusinessServicesWithDeps(businessServices) {
    const BATCH = 10;
    const capped = businessServices.slice(0, 50);
    const result = [];
    for (let i = 0; i < capped.length; i += BATCH) {
      const chunk = capped.slice(i, i + BATCH);
      const enriched = await Promise.allSettled(chunk.map(async bs => {
        try {
          const res = await this._request('GET', `/service_dependencies/business_services/${bs.id}`);
          const deps = (res.relationships || []).map(r => ({
            id:   r.supporting_service?.id,
            name: r.supporting_service?.summary,
          })).filter(d => d.id);
          return { ...bs, supporting_services: deps };
        } catch {
          return { ...bs, supporting_services: [] };
        }
      }));
      enriched.forEach((r, j) => result.push(r.status === 'fulfilled' ? r.value : { ...chunk[j], supporting_services: [] }));
    }
    return result;
  }
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
   * We query each service individually with limit=1. This is the only reliable approach:
   * the batch method (many service_ids in one query) fails because PD returns incidents
   * newest-first across all services, so a handful of busy services can fill the entire
   * result page, leaving quieter services — even ones with real incidents — invisible.
   *
   * Live diagnostic confirmed: 3 busy services claimed all 50 slots in a batch of 50,
   * missing 8 other services that actually had incidents (11 active, not 3).
   *
   * We include ALL statuses (triggered, acknowledged, resolved) and ALL urgencies so
   * low-priority P4/P5 incidents (which may never page anyone) still count a service
   * as active. The question is "was any incident created on this service?" not "did
   * anyone get paged?"
   *
   * With 672 services at 20 concurrent = ~34 batches. Each call returns at most 1
   * record, so this is fast despite the higher call count.
   */
  async listRecentIncidentServiceIds(serviceIds, days) {
    if (!serviceIds.length) return new Set();
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const until = new Date().toISOString();
    const CONCURRENT = 20;
    const seen = new Set();
    for (let i = 0; i < serviceIds.length; i += CONCURRENT) {
      const batch = serviceIds.slice(i, i + CONCURRENT);
      await Promise.allSettled(batch.map(async id => {
        try {
          const res = await this._request('GET', '/incidents', {
            since, until,
            service_ids: [id],
            statuses: ['triggered', 'acknowledged', 'resolved'],
            limit: 1,
          });
          if ((res.incidents || []).length > 0) seen.add(id);
        } catch { /* ignore — stale detection is best-effort */ }
      }));
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
    if (res.status === 404) {
      // Log 404s separately — they indicate plan-tier limitations, not errors
      this._callLog.push({ method, path, params: this._sanitizeLogParams(params), status: 404, ts: new Date().toISOString() });
      return {};
    }
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(`PD API ${res.status}: ${e.error?.message || res.statusText}`);
    }
    this._reqCount++;
    const data = await res.json();
    // Record every successful call to the audit log.
    // Params are sanitized — we strip nothing (no secrets in params; token is in headers only).
    this._callLog.push({ method, path, params: this._sanitizeLogParams(params), status: res.status, ts: new Date().toISOString() });
    return data;
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

  /**
   * Sanitize params for the call log.
   * The API token is always in the Authorization header, never in params,
   * so there are no secrets to strip. We just normalize arrays for readability.
   */
  _sanitizeLogParams(params) {
    if (!params || Object.keys(params).length === 0) return null;
    const out = {};
    for (const [k, v] of Object.entries(params)) {
      if (k === 'limit' || k === 'offset' || k === 'cursor') continue; // pagination noise
      out[k] = Array.isArray(v) ? v.join(',') : v;
    }
    return Object.keys(out).length > 0 ? out : null;
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

  report('Fetching business services (with technical service dependencies)...');
  const rawBusinessServices = await client.listBusinessServices();
  const businessServices = rawBusinessServices.length
    ? await client.enrichBusinessServicesWithDeps(rawBusinessServices)
    : [];

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
  // Extended Teams patterns covering PD native Teams action IDs
  const TEAMS_PATTERNS_EXT = [
    ...TEAMS_PATTERNS,
    'ms_teams', 'create_meeting_with_teams', 'ms-teams-meeting', 'msteams',
  ];

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

  // ── Active service list with team ownership ──────────────────────────────
  // Build a lookup from team ID → team name (from the enriched teams list)
  const teamNameById = new Map(config.teams.map(t => [t.id, t.name]));

  const activeServicesList = config.services
    .filter(svc => config.activeServiceIds.has(svc.id))
    .map(svc => {
      const teams = (svc.teams || []).map(t => t.summary || teamNameById.get(t.id) || t.id);
      return {
        name:              svc.name,
        id:                svc.id,
        teams,
        primary_team:      teams[0] || null,
        integration_count: (svc.integrations || []).length,
        alert_grouping:    svc.alert_grouping_parameters?.type || 'none',
      };
    })
    .sort((a, b) => b.integration_count - a.integration_count);

  // Active service count grouped by owning team — useful for wave sizing
  const activeByTeam = {};
  for (const svc of config.services) {
    const isActive = config.activeServiceIds.has(svc.id);
    for (const t of (svc.teams || [])) {
      const name = t.summary || teamNameById.get(t.id) || t.id;
      if (!activeByTeam[name]) activeByTeam[name] = { active: 0, stale: 0 };
      if (isActive) activeByTeam[name].active++;
      else          activeByTeam[name].stale++;
    }
  }
  const activeByTeamSorted = Object.entries(activeByTeam)
    .map(([team, counts]) => ({ team, ...counts }))
    .sort((a, b) => b.active - a.active);

  // ── Teams with member counts and service ownership ────────────────────────
  const teamItems = config.teams.map(t => {
    const entry = activeByTeam[t.name] || { active: 0, stale: 0 };
    return {
      name:           t.name,
      id:             t.id,
      member_count:   (t.members || []).length,
      active_services: entry.active,
      stale_services:  entry.stale,
    };
  }).sort((a, b) => b.active_services - a.active_services);

  // ── Business services with supporting technical services ──────────────────
  const bizSvcItems = config.businessServices.map(bs => ({
    name:               bs.name,
    id:                 bs.id,
    description:        bs.description || null,
    owner_team:         bs.team?.summary || null,
    point_of_contact:   bs.point_of_contact?.summary || null,
    supporting_services: (bs.supporting_services || []).map(s => ({
      name: s.name,
      id:   s.id,
      active: config.activeServiceIds.has(s.id),
    })),
  }));

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

  // ── Webhooks with destination classification ─────────────────────────────
  // Classify each webhook destination into a known SaaS category or "unknown".
  // Unknown destinations are the main driver of the investigation sprint.
  const WEBHOOK_CLASSIFIERS = [
    { key: 'servicenow',  patterns: ['service-now.com', 'servicenow.com'] },
    { key: 'splunk',      patterns: ['splunk.com', 'splunkcloud.com', 'hec.splunk'] },
    { key: 'datadog',     patterns: ['datadog.com', 'datadoghq.com'] },
    { key: 'slack',       patterns: ['hooks.slack.com'] },
    { key: 'teams',       patterns: ['office365.com', 'microsoftteams', 'webhook.office.com'] },
    { key: 'jira',        patterns: ['atlassian.net', 'jira.com'] },
    { key: 'statuspage',  patterns: ['statuspage.io', 'status.io'] },
    { key: 'pagerduty',   patterns: ['pagerduty.com', 'events.pagerduty.com'] },
    { key: 'opsgenie',    patterns: ['opsgenie.com', 'atlassian.com/opsgenie'] },
    { key: 'aws',         patterns: ['amazonaws.com', 'aws.amazon.com'] },
    { key: 'gchat',       patterns: ['chat.googleapis.com'] },
    { key: 'zapier',      patterns: ['zapier.com', 'hooks.zapier.com'] },
  ];

  const webhookDestinations = {};
  const unknownWebhooks = [];

  const webhookItems = config.webhooks.map(w => {
    const url = (w.delivery_method?.url || '').toLowerCase();
    let classified = null;
    for (const cls of WEBHOOK_CLASSIFIERS) {
      if (cls.patterns.some(p => url.includes(p))) {
        classified = cls.key;
        break;
      }
    }
    if (classified) {
      if (!webhookDestinations[classified]) {
        webhookDestinations[classified] = { count: 0, hostnames: new Set() };
      }
      webhookDestinations[classified].count++;
      try {
        const hostname = new URL(w.delivery_method.url).hostname;
        webhookDestinations[classified].hostnames.add(hostname);
      } catch { /* invalid URL */ }
    } else if (url) {
      unknownWebhooks.push({
        name: w.description || 'Unnamed',
        url:  w.delivery_method?.url || null,
        filter_type: w.filter?.type || null,
      });
    }
    return {
      name:        w.description || 'Unnamed',
      url:         w.delivery_method?.url  || null,
      filter_type: w.filter?.type          || null,
      destination: classified || 'unknown',
    };
  });

  // Serialize Set → Array for JSON output
  const webhookDestinationsSerialized = Object.fromEntries(
    Object.entries(webhookDestinations).map(([k, v]) => [k, { count: v.count, hostnames: [...v.hostnames] }])
  );

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

  // ── Shadow stack pre-digested signals ────────────────────────────────────
  // Identify the ServiceNow integration mode:
  //   workflow_driven → a workflow step calls SN (conditional, per-incident)
  //   native          → native PD-SN extension detected
  //   webhook_only    → SN appears only as a webhook destination
  //   none            → no SN signals found
  const snWorkflows = config.incidentWorkflows.filter(wf =>
    (wf.name || '').toLowerCase().includes('servicenow') ||
    (wf.name || '').toLowerCase().includes('servicenow') ||
    (wf.name || '').toLowerCase().replace(/\s/g, '').includes('servicenow') ||
    (wf.steps || []).some(s =>
      JSON.stringify(s.action_configuration || {}).toLowerCase().includes('servicenow') ||
      (s.action_id || '').toLowerCase().includes('servicenow')
    )
  );
  const snExtension = config.extensions.some(e =>
    (e.name || '').toLowerCase().includes('servicenow') ||
    (e.extension_schema?.summary || '').toLowerCase().includes('servicenow')
  );
  const snWebhookCount = (webhookDestinations['servicenow'] || {}).count || 0;
  const serviceNowMode =
    snWorkflows.length > 0  ? 'workflow_driven' :
    snExtension             ? 'native'           :
    snWebhookCount > 0      ? 'webhook_only'     : 'none';

  // Workflows with 10+ steps are "major incident" class — need dedicated sprint + exec sign-off
  const complexWorkflows = config.incidentWorkflows
    .filter(wf => (wf.steps || []).length >= 10)
    .map(wf => ({
      name:       wf.name,
      step_count: (wf.steps || []).length,
      has_teams:  (wf.steps || []).some(s =>
        TEAMS_PATTERNS_EXT.some(p => (s.action_id || '').toLowerCase().includes(p))
      ),
      has_zoom: (wf.steps || []).some(s =>
        ZOOM_PATTERNS.some(p => (s.action_id || '').toLowerCase().includes(p))
      ),
    }))
    .sort((a, b) => b.step_count - a.step_count);

  // Automation breakdown by type
  const automationByType = {};
  for (const a of config.automationActions) {
    const t = a.action_type || 'script';
    automationByType[t] = (automationByType[t] || 0) + 1;
  }

  return {
    meta: {
      schema_version:   '3.0',
      generated_at:     new Date().toISOString(),
      analyzer_version: '3.0.0',
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
      with_change_event_integrations:    changeEvtServices.length,
      change_event_integration_services: changeEvtServices,
      // Active services by team — for wave planning and stakeholder mapping
      active_by_team: activeByTeamSorted,
      // Full list of active services sorted by integration complexity.
      // This is the migration scope. Stale services are decommissioned, not migrated.
      active_services: activeServicesList,
    },
    teams: {
      total: config.teams.length,
      // Teams with member counts and service ownership — useful for migration wave grouping
      items: teamItems,
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
      // Business services with owning teams, contacts, and supporting technical services.
      // Maps the customer's business capability hierarchy — critical for exec stakeholder mapping.
      items: bizSvcItems,
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
      // Classified destinations — the key signal for migration risk assessment.
      // unknown_destinations are items that need investigation before sprint planning can be finalised.
      destinations: webhookDestinationsSerialized,
      unknown_count: unknownWebhooks.length,
      unknown_destinations: unknownWebhooks,
      items: webhookItems,
    },
    extensions: {
      total: config.extensions.length,
      items: extItems,
    },
    automation: {
      actions_total:  config.automationActions.length,
      runners_total:  config.automationRunners.length,
      by_type:        automationByType,
      actions:        aaItems,
    },
    // Pre-digested signals for SE migration planning.
    // Designed to give the SE an immediate read on the key complexity drivers
    // without having to parse every section of the JSON manually.
    shadow_stack: {
      servicenow: {
        detected:       serviceNowMode !== 'none',
        // mode explains HOW SN is integrated — determines the migration approach:
        //   workflow_driven → migrate the workflow condition logic to incident.io Workflows
        //   native          → migrate using the native incident.io ↔ SN integration
        //   webhook_only    → replace webhooks with incident.io Workflow actions
        //   none            → ServiceNow not detected
        mode:           serviceNowMode,
        workflow_names: snWorkflows.map(w => w.name),
        webhook_count:  snWebhookCount,
        hostnames:      (webhookDestinations['servicenow']?.hostnames
          ? [...webhookDestinations['servicenow'].hostnames]
          : []),
      },
      // Workflows with 10+ steps are "major incident class" — need dedicated sprint and exec sign-off
      complex_workflows: complexWorkflows,
      // Unknown webhook destinations — these MUST be investigated in Sprint 0 before
      // sprint planning can be finalised. Each unknown is a potential shadow integration.
      unknown_webhook_destinations: unknownWebhooks,
      // Collaboration tools detected across workflows, extensions, and webhooks
      collaboration: {
        slack:           wfSlack.size > 0,
        microsoft_teams: wfTeams.size > 0,
        zoom:            wfZoom.size > 0,
      },
      live_call_routing: lcrServices.length > 0,
      change_events:     changeEvtServices.length > 0,
      status_pages: {
        public:   (config.statusPages || []).length > 0,
        internal: (config.statusDashboards || []).length > 0,
      },
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
// SECTION 6 — DATA ACCESS LOG BUILDER
//
// Produces a human-readable plain-text log of every PagerDuty API endpoint
// called during the scan. Intended as a "data access explainer" document that
// customers can share with their security or compliance teams to verify exactly
// what the script read and why.
//
// Format: one file per scan run, named pd-analysis-DOMAIN-DATE.log (alongside
// the JSON output file). The log groups calls by endpoint, explains the purpose
// of each endpoint, lists any endpoints that returned 404 (plan limitations),
// and includes a full chronological call list as an appendix.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a PagerDuty API path for grouping purposes.
 * Replaces UUID/alphanumeric IDs in path segments with {id} so that calls
 * like /services/P1ABC23/rules and /services/P9XYZ99/rules group together.
 */
function normalizePath(path) {
  return path
    .replace(/\/[A-Z0-9]{7,}\b/g, '/{id}')   // PD resource IDs (e.g. P1ABC23)
    .replace(/\/\d+\b/g, '/{id}');             // numeric IDs
}

/**
 * Human-readable descriptions for every endpoint the script calls.
 * Keyed on the normalized path (after normalizePath()).
 * Each entry explains: what the endpoint returns, what fields we use, and WHY.
 */
const ENDPOINT_PURPOSES = {
  '/abilities': {
    returns: 'List of feature/plan flags (e.g. teams, response_plays, event_orchestration).',
    fields_used: 'Ability flag names only.',
    why: 'Determines which PagerDuty features are active on the account so the migration plan covers each one.',
  },
  '/services': {
    returns: 'All PagerDuty services with integration types, alert grouping config, and team ownership.',
    fields_used: 'Service name, ID, integration type names, alert_grouping_parameters type, team IDs/names.',
    why: 'Services are the primary unit of migration. Their count, integration types, and team ownership drive the sprint plan and wave grouping.',
  },
  '/services/{id}/rules': {
    returns: 'Legacy per-service event routing rules (if configured).',
    fields_used: 'Rule count only — no rule conditions or payloads.',
    why: 'Per-service rules are a legacy routing mechanism that must be mapped to incident.io alert routes. Knowing how many exist flags the rule-migration workstream.',
  },
  '/teams': {
    returns: 'All PagerDuty teams.',
    fields_used: 'Team name, ID.',
    why: 'Teams are the migration wave unit. Each wave migrates a group of related teams together.',
  },
  '/teams/{id}/members': {
    returns: 'Members of a specific team.',
    fields_used: 'User IDs and roles within the team.',
    why: 'Member counts indicate training burden. Team membership is used for stakeholder mapping and wave sizing.',
  },
  '/schedules': {
    returns: 'On-call schedules with layers, assigned users, and team associations.',
    fields_used: 'Schedule name, layer count, user count, team associations.',
    why: 'Every active schedule must be recreated in incident.io. Layer count indicates rotation complexity.',
  },
  '/escalation_policies': {
    returns: 'Escalation policies — rules for how incidents escalate if not acknowledged.',
    fields_used: 'Policy name, rule count (layers), loop settings.',
    why: 'Each escalation policy must be migrated. Policies with multiple layers or loops have specific migration patterns in incident.io.',
  },
  '/users': {
    returns: 'All users with name, email, and role.',
    fields_used: 'User role only (admin, user, limited_user, etc.) — used for role breakdown counts.',
    why: 'User role distribution informs the incident.io license sizing and training plan.',
  },
  '/business_services': {
    returns: 'Business services — logical groupings of technical services representing a customer-facing capability.',
    fields_used: 'Business service name, ID, owning team, point of contact.',
    why: 'Business services map the customer\'s service hierarchy. They are referenced in executive migration plans and stakeholder mapping.',
  },
  '/service_dependencies/technical_services': {
    returns: 'Dependency relationships between technical services (which services depend on which).',
    fields_used: 'Dependent service ID, supporting service ID.',
    why: 'Service dependencies affect migration wave ordering — dependent services should be migrated in the same wave as the services they rely on.',
  },
  '/service_dependencies/business_services/{id}': {
    returns: 'Which technical services support a given business service.',
    fields_used: 'Supporting technical service names and IDs.',
    why: 'Builds the business capability hierarchy — which technical services underpin each business service. Used in exec-level migration planning.',
  },
  '/extensions': {
    returns: 'Extensions installed on the account (ServiceNow, Jira, Slack, custom webhooks, etc.).',
    fields_used: 'Extension name, schema type, number of services it is attached to.',
    why: 'Extensions represent integrations that need to be migrated or replaced in incident.io. ServiceNow and custom extensions are on the critical path.',
  },
  '/webhook_subscriptions': {
    returns: 'Outbound webhook subscriptions — URLs that PagerDuty sends event data to.',
    fields_used: 'Webhook name, destination URL (classified by domain, not logged verbatim in JSON), filter type.',
    why: 'Webhooks are shadow integrations. Unknown destinations (non-SaaS URLs) are flagged as investigation items for Sprint 0 before migration planning can be finalised.',
  },
  '/incident_workflows': {
    returns: 'Incident workflow definitions — automated processes triggered on incident events.',
    fields_used: 'Workflow name, step count, trigger types, step action IDs (to detect collaboration tool usage).',
    why: 'Incident workflows must be rebuilt as incident.io Workflows. High-step workflows (10+ steps) are "major incident class" and need a dedicated sprint. Collaboration tool usage (Slack, Teams, Zoom) in workflows signals which native integrations incident.io needs to configure.',
  },
  '/incident_workflows/{id}': {
    returns: 'Full detail for a specific incident workflow including all steps and triggers.',
    fields_used: 'Step action IDs, action configuration keys (not values), trigger type.',
    why: 'Step-level detail is needed to detect collaboration tool usage (Slack channel creation, Teams meeting creation, Zoom bridge setup) and to identify ServiceNow workflow-driven integration patterns.',
  },
  '/event_orchestrations': {
    returns: 'Global Event Orchestration definitions.',
    fields_used: 'Orchestration name, ID.',
    why: 'Global orchestrations are the central alert normalisation and routing layer. Their presence indicates the account uses alert enrichment — a pattern that maps to incident.io alert routes and workflow conditions.',
  },
  '/event_orchestrations/{id}/router': {
    returns: 'Router rules for a specific Event Orchestration.',
    fields_used: 'Rule count per set, routed service IDs.',
    why: 'Router rule count indicates normalisation complexity. Service routing tells us which services receive events through the orchestration.',
  },
  '/automation_actions/actions': {
    returns: 'Automation actions (Rundeck/PD Automation scripts).',
    fields_used: 'Action name, type (process_automation vs script), runner ID.',
    why: 'Automation actions must be migrated to incident.io Runbooks. Type and runner information determines the Runbook configuration approach.',
  },
  '/automation_actions/runners': {
    returns: 'Automation runners (the infrastructure that executes automation actions).',
    fields_used: 'Runner name, ID.',
    why: 'Runner names are used to label automation actions in the migration plan.',
  },
  '/response_plays': {
    returns: 'Response plays — pre-configured incident response playbooks.',
    fields_used: 'Play name, owning team, responder count, subscriber count.',
    why: 'Response plays map to incident.io\'s Response Plays feature. Their presence and complexity inform the migration scope.',
  },
  '/maintenance_windows': {
    returns: 'Maintenance windows — scheduled periods of alert suppression.',
    fields_used: 'Description, service count, start/end times.',
    why: 'Active and recurring maintenance windows need to be recreated in incident.io.',
  },
  '/slack_connections': {
    returns: 'Slack workspace connections.',
    fields_used: 'Connection count only.',
    why: 'Confirms whether PagerDuty is connected to Slack — relevant because incident.io\'s native Slack integration replaces PD\'s webhook-based approach.',
  },
  '/status_pages': {
    returns: 'Public-facing status pages.',
    fields_used: 'Page name, subdomain, type.',
    why: 'Public status pages are a distinct migration workstream requiring subscriber list migration, content migration, and custom domain setup. incident.io includes Status Pages at no extra cost (vs. PD\'s premium pricing).',
  },
  '/status_dashboards': {
    returns: 'Internal stakeholder status dashboards.',
    fields_used: 'Dashboard name.',
    why: 'Internal dashboards map to incident.io\'s stakeholder update and status page features.',
  },
  '/rulesets': {
    returns: 'Legacy Global Event Rules (predecessor to Event Orchestrations).',
    fields_used: 'Ruleset name, ID.',
    why: 'Legacy rulesets must be migrated to Event Orchestrations or incident.io alert routes.',
  },
  '/incidents': {
    returns: 'At most 1 incident record per service query (only the existence of an incident is checked).',
    fields_used: 'service.id field only — to determine whether the service had any incident activity.',
    why: 'Stale service detection. Services with no incident activity in the last N days are "stale" and can be archived rather than migrated, often cutting the migration scope by 50% or more. We query each service individually with limit=1 to ensure high-incident services do not crowd out quiet services. We do NOT retain incident IDs, titles, descriptions, or any incident content.',
  },
};

function buildLogText({ domain, callLog, report, days, startedAt, finishedAt }) {
  const durationMs = finishedAt - startedAt;
  const durationSecs = Math.round(durationMs / 1000);
  const durationStr = durationSecs >= 60
    ? `${Math.floor(durationSecs / 60)}m ${durationSecs % 60}s`
    : `${durationSecs}s`;

  const totalCalls = callLog.length;
  const successCalls = callLog.filter(c => c.status !== 404).length;
  const notFoundCalls = callLog.filter(c => c.status === 404);

  // Group calls by normalized path for the summary section
  const grouped = {};
  for (const entry of callLog) {
    const key = entry.method + ' ' + normalizePath(entry.path);
    if (!grouped[key]) grouped[key] = { count: 0, examples: [], notFound: 0 };
    grouped[key].count++;
    if (entry.status === 404) grouped[key].notFound++;
  }

  const pad = (n, w = 4) => String(n).padStart(w, ' ');
  const line = (char = '─', len = 72) => char.repeat(len);

  const lines = [];
  const L = (...args) => lines.push(args.join(''));

  L('PagerDuty Configuration Analyzer — Data Access Log');
  L(line('═'));
  L();
  L(`Generated at : ${new Date(finishedAt).toISOString()}`);
  L(`Domain       : ${domain}.pagerduty.com`);
  L(`Lookback     : ${days} days (stale service detection window)`);
  L(`Scan duration: ${durationStr}`);
  L(`Total API calls made: ${totalCalls}  (${successCalls} successful, ${notFoundCalls.length} not found / plan-limited)`);
  L();
  L(line());
  L('WHAT THIS FILE IS');
  L(line());
  L();
  L('This log records every PagerDuty API endpoint called during the configuration');
  L('scan. It is provided so that your security, compliance, or IT teams can verify');
  L('exactly what data was accessed and why.');
  L();
  L('All requests in this log are read-only (HTTP GET). The script made no write,');
  L('update, or delete requests of any kind. No PagerDuty configuration was changed.');
  L();
  L('The API token used for this scan is not stored in this log or in the JSON');
  L('output file. It was used only for the duration of this run.');
  L();
  L(line());
  L('WHAT WAS NOT COLLECTED');
  L(line());
  L();
  L('The following data was explicitly NOT collected by this script:');
  L();
  L('  • Incident titles, descriptions, body text, or notes');
  L('  • Alert payloads or monitoring tool event data');
  L('  • User contact methods, notification rules, or personal details');
  L('  • On-call notification history or acknowledgement records');
  L('  • Any credentials, secrets, API keys, or integration tokens');
  L('  • PagerDuty billing, contract, or subscription information');
  L('  • Incident timestamps, durations, or MTTR/MTTA metrics');
  L('  • Audit log entries');
  L();
  L('For stale service detection, the /incidents endpoint was called with limit=1');
  L('per service. Only the presence or absence of an incident was recorded — no');
  L('incident IDs, titles, or content were retained.');
  L();
  L(line());
  L('ENDPOINTS CALLED — SUMMARY');
  L(line());
  L();
  L('The table below shows each unique endpoint called, how many times it was');
  L('called, and why.');
  L();

  const sortedGroups = Object.entries(grouped).sort((a, b) => {
    // Sort: 404s last, then by call count descending
    const aFailed = a[1].notFound === a[1].count ? 1 : 0;
    const bFailed = b[1].notFound === b[1].count ? 1 : 0;
    if (aFailed !== bFailed) return aFailed - bFailed;
    return b[1].count - a[1].count;
  });

  for (const [key, stats] of sortedGroups) {
    const normPath = key.replace(/^GET /, '');
    const purpose = ENDPOINT_PURPOSES[normPath];
    const notFoundNote = stats.notFound > 0
      ? stats.notFound === stats.count
        ? '  [NOT FOUND — feature not available on this PagerDuty plan]'
        : `  [${stats.notFound} call(s) returned 404 — not available on this plan]`
      : '';

    L(`${key}  (${stats.count} call${stats.count !== 1 ? 's' : ''})${notFoundNote}`);
    if (purpose) {
      L(`  Returns    : ${purpose.returns}`);
      L(`  Fields used: ${purpose.fields_used}`);
      L(`  Why        : ${purpose.why}`);
    } else {
      L(`  Purpose    : Configuration data collection.`);
    }
    L();
  }

  L(line());
  L('ENDPOINTS NOT CALLED');
  L(line());
  L();
  L('The following PagerDuty endpoints were NOT called during this scan:');
  L();
  L('  POST/PUT/PATCH/DELETE * — no write endpoints were called');
  L('  GET /incidents/{id}     — individual incident detail (content, notes, responders)');
  L('  GET /log_entries        — incident audit log / timeline entries');
  L('  GET /notifications      — user notification history');
  L('  GET /users/{id}/contact_methods — user phone numbers / email addresses');
  L('  GET /users/{id}/notification_rules — user notification preferences');
  L('  GET /analytics/*        — incident metrics and analytics data');
  L();

  if (notFoundCalls.length > 0) {
    L(line());
    L('PLAN-LIMITED ENDPOINTS (returned 404)');
    L(line());
    L();
    L('These endpoints returned 404 during the scan, indicating the feature is not');
    L('available on this account\'s PagerDuty plan:');
    L();
    const notFoundPaths = [...new Set(notFoundCalls.map(c => normalizePath(c.path)))];
    for (const p of notFoundPaths) L(`  GET ${p}`);
    L();
    L('This is normal — not all PagerDuty features are available on every plan tier.');
    L();
  }

  L(line());
  L('APPENDIX — CHRONOLOGICAL CALL LIST');
  L(line());
  L();
  L('Every API call made during this scan, in order of execution.');
  L('Pagination parameters (limit, offset, cursor) are omitted for readability.');
  L(`Format: [seq] timestamp  METHOD /path  {params}`);
  L();

  callLog.forEach((entry, i) => {
    const seq = pad(i + 1);
    const ts  = entry.ts;
    const paramStr = entry.params
      ? '  {' + Object.entries(entry.params).map(([k, v]) => `${k}=${v}`).join(', ') + '}'
      : '';
    const statusNote = entry.status === 404 ? '  [404 — not found]' : '';
    L(`[${seq}] ${ts}  ${entry.method} ${entry.path}${paramStr}${statusNote}`);
  });

  L();
  L(line());
  L(`End of data access log.  ${domain}.pagerduty.com  ${new Date(finishedAt).toISOString()}`);
  L(line());

  return lines.join('\n');
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

  const rawDomain = ARGS.subdomain || await prompt('PagerDuty subdomain (e.g. "acme" from acme.pagerduty.com):');
  if (!rawDomain) { err('Domain name is required.'); process.exit(1); }
  const domain = rawDomain.toLowerCase().replace(/\.pagerduty\.com.*$/, '').replace(/\s/g, '');

  log();
  let apiKey;
  if (ARGS.token) {
    apiKey = ARGS.token;
    info('Using API key from --token flag.');
  } else {
    info('Recommended: use a Read-Only API key (PagerDuty → Integrations → API Access Keys).');
    apiKey = await promptSecret('PagerDuty API key:');
  }
  if (!apiKey) { err('API key is required.'); process.exit(1); }

  log();

  // ── Step 2: Validate the API key ──────────────────────────────────────
  step(1, 5, 'Validating API key...');
  const client = new PagerDutyClient({ token: apiKey, subdomain: domain, rateLimit: ARGS.rateLimit });
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
  log(`  Rate limit   : ${C.bold}${ARGS.rateLimit} req/min${C.reset}${ARGS.rateLimit < 500 ? ` ${C.dim}(conservative — scan will take longer but won't impact production API traffic)${C.reset}` : ''}`);
  log(`  Analysis mode: ${C.bold}Config-only${C.reset} (no incident content collected)`);
  log(`  Output       : ${C.bold}${ARGS.output || `pd-analysis-${domain}-${new Date().toISOString().slice(0,10)}.json`}${C.reset} (+ .log)`);
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

  const scanStartedAt = Date.now();
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

  const scanFinishedAt = Date.now();
  const report = buildReport({ domain, config, days: ARGS.days });

  const outputBase = ARGS.output
    ? ARGS.output.replace(/\.json$/i, '')
    : `pd-analysis-${domain}-${new Date().toISOString().slice(0,10)}`;
  const outputFile = outputBase + '.json';
  const logFile    = outputBase + '.log';
  const outputPath = path.resolve(outputFile);
  const logPath    = path.resolve(logFile);

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
  ok('JSON report written.');

  const logText = buildLogText({
    domain,
    callLog:     client._callLog,
    report,
    days:        ARGS.days,
    startedAt:   scanStartedAt,
    finishedAt:  scanFinishedAt,
  });
  fs.writeFileSync(logPath, logText, 'utf8');
  ok('Data access log written.');

  log();
  hr();
  log();
  log(`${C.bold}${C.green}  Scan complete!${C.reset}`);
  log();
  log(`  JSON report  : ${C.bold}${outputPath}${C.reset}`);
  log(`  Access log   : ${C.bold}${logPath}${C.reset}`);
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

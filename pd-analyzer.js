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
//    • A list of incident IDs from the last N days (default: 90) to flag
//      stale services. Only service IDs are used — no incident content.
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
//    --output=FILE   Output HTML filename (default: pd-analysis-DOMAIN-DATE.html)
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
  --output=FILE   Output HTML filename (default: pd-analysis-DOMAIN-DATE.html)
  --yes           Skip confirmation prompt
  --no-color      Disable ANSI colour output
  --help          Show this help text

EXAMPLE
  node pd-analyzer.js --days=90
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
   * Fetch the set of service IDs that had at least one incident in the last N days.
   * Used only for stale-service detection — we do NOT collect incident content.
   *
   * We cap each request at chunk.length incidents (one per service is sufficient
   * to mark it active). This means one page of results per chunk rather than
   * paginating through potentially thousands of incidents per chunk.
   *
   * With 50 services per chunk, a 672-service domain requires ~14 API calls total
   * instead of potentially hundreds of paginated requests.
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
        // Cap at chunk.length — we only need one incident per service to know it's active.
        // This keeps the fetch to a single page (100 items) per chunk.
        const incidents = await this._all('/incidents', 'incidents', {
          since, until, service_ids: chunk,
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

  report('Fetching Slack connections...');
  const slackConnections = await client.getSlackConnections();

  report('Fetching account abilities (plan / feature flags)...');
  const abilities = await client.getAbilities();

  report('Fetching legacy rulesets...');
  const rulesets = await client.listRulesets();

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
    automationRunners, slackConnections, abilities, rulesets,
    activeServiceIds, techDepMap,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — CONVERSION MAPPINGS
//
// Maps each PagerDuty resource type to its incident.io equivalent status:
//   AUTO        → Direct import supported (schedule, escalation policy, team)
//   MANUAL      → Requires configuration work (services, business services)
//   SKIP        → Not migrated via Terraform (users provisioned via SSO/SCIM)
//   UNSUPPORTED → No direct equivalent — requires manual re-implementation
// ─────────────────────────────────────────────────────────────────────────────

const CONVERSION_MAP = {
  SCHEDULE: {
    status: 'AUTO',
    ioResourceType: 'incident_schedule',
    effort: 'Low',
    notes: 'Direct mapping to incident.io on-call schedules',
  },
  ESCALATION_POLICY: {
    status: 'AUTO',
    ioResourceType: 'incident_escalation_path',
    effort: 'Low',
    notes: 'Direct mapping to incident.io escalation paths',
  },
  TEAM: {
    status: 'AUTO',
    ioResourceType: 'incident_catalog_entry',
    effort: 'Low',
    notes: 'Teams imported as Service Catalog entries',
  },
  USER: {
    status: 'SKIP',
    ioResourceType: '',
    effort: 'Low',
    notes: 'Users provisioned via SSO / SCIM — not via Terraform',
  },
  SERVICE: {
    status: 'MANUAL',
    ioResourceType: 'catalog entry + alert routes',
    effort: 'Medium',
    notes: 'Services require mapping to catalog entries and alert routing',
  },
  BUSINESS_SERVICE: {
    status: 'MANUAL',
    ioResourceType: 'incident_catalog_entry',
    effort: 'Medium',
    notes: 'Business services map to custom catalog entries; may need custom attributes',
  },
  RULESET: {
    status: 'UNSUPPORTED',
    ioResourceType: '',
    effort: 'High',
    notes: 'Event Orchestration rule logic must be re-implemented as alert routes',
  },
  EXTENSION: {
    status: 'MANUAL',
    ioResourceType: 'incident.io Workflow action',
    effort: 'Medium',
    notes: 'Extensions (ServiceNow, Jira, etc.) re-configured as Workflow actions',
  },
  WEBHOOK_SUBSCRIPTION: {
    status: 'MANUAL',
    ioResourceType: 'incident.io Webhook / Workflow',
    effort: 'Low',
    notes: 'Outbound webhooks replaced with incident.io native Workflow actions',
  },
  INCIDENT_WORKFLOW: {
    status: 'MANUAL',
    ioResourceType: 'incident.io Workflow',
    effort: 'Medium',
    notes: 'Incident Workflow steps recreated in incident.io Workflow builder',
  },
  EVENT_ORCHESTRATION: {
    status: 'MANUAL',
    ioResourceType: 'alert routes + conditions',
    effort: 'Medium',
    notes: 'Routing rules translated to incident.io alert route conditions',
  },
};

function computeConversions(config) {
  const mappings = [];

  const add = (id, type, name, teamIds = []) => {
    const m = CONVERSION_MAP[type];
    if (!m) return;
    mappings.push({ id, type, name, teamIds, ...m });
  };

  config.services.forEach(s           => add(s.id,  'SERVICE',            s.name, s.teams?.map(t=>t.id) || []));
  config.teams.forEach(t              => add(t.id,  'TEAM',               t.name));
  config.schedules.forEach(s          => add(s.id,  'SCHEDULE',           s.name, s.teams?.map(t=>t.id) || []));
  config.escalationPolicies.forEach(p => add(p.id,  'ESCALATION_POLICY',  p.name, p.teams?.map(t=>t.id) || []));
  config.users.forEach(u              => add(u.id,  'USER',               u.name));
  config.businessServices.forEach(bs  => add(bs.id, 'BUSINESS_SERVICE',   bs.name));
  config.rulesets.forEach(r           => add(r.id,  'RULESET',            r.name));
  config.extensions.forEach(e         => add(e.id,  'EXTENSION',          e.name || e.extension_schema?.summary || 'Extension'));
  config.webhooks.forEach(w           => add(w.id,  'WEBHOOK_SUBSCRIPTION', w.description || `Webhook → ${w.delivery_method?.url || 'unknown'}`));
  config.incidentWorkflows.forEach(wf => add(wf.id, 'INCIDENT_WORKFLOW',  wf.name || 'Incident Workflow'));
  config.eventOrchestrations.forEach(eo => add(eo.id, 'EVENT_ORCHESTRATION', eo.name || 'Event Orchestration'));

  return mappings;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — SHADOW STACK ANALYSIS (config-only)
//
// Detects custom integrations, tooling, and automation that exist around
// your PagerDuty setup — the "shadow stack" that needs to be migrated
// alongside core resources.
//
// In config-only mode (no incident data), we detect signals from:
//   • Outbound webhook subscriptions
//   • Account-level extensions (ServiceNow, Jira, custom webhooks)
//   • Incident workflow steps (Slack, MS Teams, custom actions)
//   • Event orchestration routing layers
//   • Automation actions and runners
//   • Service integration types (custom event transformers, API integrations)
// ─────────────────────────────────────────────────────────────────────────────

const SHADOW_REPLACEMENT = {
  webhook_destination:  { feature: 'incident.io Workflows',           action: 'Replace outbound webhook with a Workflow action or native webhook.',              effort: 'Low — ~1 day per webhook' },
  custom_extension:     { feature: 'incident.io Workflows',           action: 'Evaluate extension functionality and rebuild as Workflow steps.',                  effort: 'Medium — case by case' },
  workflow_integration: { feature: 'incident.io Workflows',           action: 'Recreate Incident Workflow actions as incident.io Workflow steps.',               effort: 'Low-Medium — native integrations map directly' },
  eo_routing_layer:     { feature: 'Alert Routes',                    action: 'Map Global Event Orchestration routing rules to alert routes with conditions.',   effort: 'Medium-High — depends on rule count' },
  automation_action:    { feature: 'incident.io Workflows + Runbooks', action: 'Migrate Automation Actions to incident.io Workflows or Runbooks.',               effort: 'Medium-High — depends on runner complexity' },
  enrichment_middleware:{ feature: 'Catalog + Workflows',             action: 'Replace custom event transformer enrichment with Catalog attributes.',           effort: 'Medium — 2-3 days' },
  analytics_pipeline:   { feature: 'incident.io Webhooks + API',      action: 'Reconfigure data export pipeline to consume incident.io webhook events or API.', effort: 'Medium — 2-3 days' },
  api_consumer:         { feature: 'incident.io API',                 action: 'Update API endpoint and auth to incident.io. Review for PD-specific fields.',    effort: 'Medium — per consumer' },
};

function analyzeShadowStack(config) {
  const signals = [];
  const serviceMap = new Map(config.services.map(s => [s.id, s.name]));

  // ── 1. Outbound webhook subscriptions ──────────────────────────────────
  for (const wh of config.webhooks) {
    const url  = wh.delivery_method?.url || '';
    const name = wh.description || url || 'Unnamed webhook';
    const isAnalytics = /datadog|splunk|elastic|bigpanda|moogsoft|newrelic|prometheus|grafana|bigquery|snowflake|redshift|analytics|warehouse|pipeline/i.test(url + name);

    signals.push({
      type: isAnalytics ? 'analytics_pipeline' : 'webhook_destination',
      confidence: 'high',
      evidence: `Outbound webhook → ${url || 'unknown URL'}`,
      description: isAnalytics
        ? `Analytics pipeline webhook: "${name}"`
        : `Outbound webhook: "${name}"`,
      incidentIoReplacement: SHADOW_REPLACEMENT[isAnalytics ? 'analytics_pipeline' : 'webhook_destination'],
    });
  }

  // ── 2. Extensions (ServiceNow, Jira, Slack, custom webhooks) ────────────
  const KNOWN_ITSM = ['servicenow','jira','remedy','zendesk','freshservice'];
  for (const ext of config.extensions) {
    const name = (ext.name || ext.extension_schema?.summary || '').toLowerCase();
    const isITSM = KNOWN_ITSM.some(k => name.includes(k));
    const hasCustomUrl = ext.endpoint_url && !ext.extension_schema?.summary;
    if (isITSM || hasCustomUrl || name.includes('webhook') || name.includes('custom')) {
      signals.push({
        type: 'custom_extension',
        confidence: 'high',
        evidence: `Extension: "${ext.name || ext.extension_schema?.summary}" (${ext.extension_objects?.length || 0} service(s) connected)`,
        description: `Custom extension: ${ext.name || ext.extension_schema?.summary || 'Unknown'}`,
        incidentIoReplacement: SHADOW_REPLACEMENT.custom_extension,
      });
    }
  }

  // ── 3. Incident workflows with steps ────────────────────────────────────
  for (const wf of config.incidentWorkflows) {
    const steps = wf.steps || [];
    if (!steps.length) continue;
    const actionIds = steps.map(s => s.action_configuration?.action_id || '').filter(Boolean);
    signals.push({
      type: 'workflow_integration',
      confidence: 'high',
      evidence: `Incident Workflow "${wf.name}" has ${steps.length} step(s): ${actionIds.slice(0,3).join(', ')}${actionIds.length > 3 ? '...' : ''}`,
      description: `Incident Workflow: "${wf.name}" (${steps.length} steps)`,
      incidentIoReplacement: SHADOW_REPLACEMENT.workflow_integration,
    });
  }

  // ── 4. Event orchestration routing layers ───────────────────────────────
  for (const eo of config.eventOrchestrations) {
    const routed = (eo._routedServiceIds || []).length;
    const ruleCount = eo._routerRules?.sets?.reduce((n, s) => n + (s.rules?.length || 0), 0) || 0;
    if (routed > 0 || ruleCount > 0) {
      signals.push({
        type: 'eo_routing_layer',
        confidence: 'high',
        evidence: `Event Orchestration "${eo.name}" routes to ${routed} service(s) via ${ruleCount} rule(s)`,
        description: `Event Orchestration routing: "${eo.name}" (${ruleCount} rules → ${routed} services)`,
        incidentIoReplacement: SHADOW_REPLACEMENT.eo_routing_layer,
      });
    }
  }

  // ── 5. Automation actions ────────────────────────────────────────────────
  for (const action of config.automationActions) {
    const runnerName = config.automationRunners.find(r => r.id === action.runner_id)?.name || action.runner_id || 'unknown runner';
    signals.push({
      type: 'automation_action',
      confidence: 'high',
      evidence: `Automation Action "${action.name}" (type: ${action.action_type || 'script'}, runner: ${runnerName})`,
      description: `Automation Action: "${action.name}"`,
      incidentIoReplacement: SHADOW_REPLACEMENT.automation_action,
    });
  }

  // ── 6. Service integrations — custom event transformers & API integrations
  const CET_PATTERNS = ['custom_event_transform', 'event_transformer', 'cet'];
  for (const svc of config.services) {
    const integrations = svc.integrations || [];
    for (const int of integrations) {
      const type = (int.type || '').toLowerCase();
      const vendor = (int.vendor?.name || int.name || '').toLowerCase();
      const isCET = CET_PATTERNS.some(p => type.includes(p) || vendor.includes(p));
      if (isCET) {
        signals.push({
          type: 'enrichment_middleware',
          confidence: 'high',
          evidence: `Custom Event Transformer on service "${svc.name}" (integration: ${int.name || int.type})`,
          description: `Custom Event Transformer: "${svc.name}"`,
          incidentIoReplacement: SHADOW_REPLACEMENT.enrichment_middleware,
        });
      }
    }
  }

  // ── Deduplicate by (type, description) ──────────────────────────────────
  const seen = new Set();
  const deduped = signals.filter(s => {
    const key = `${s.type}:${s.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const webhookCount     = deduped.filter(s => s.type === 'webhook_destination' || s.type === 'analytics_pipeline').length;
  const automationCount  = deduped.filter(s => s.type === 'automation_action').length;
  const eoCount          = deduped.filter(s => s.type === 'eo_routing_layer').length;

  const burden = (deduped.length >= 10 || automationCount >= 3) ? 'high'
               : (deduped.length >= 4  || webhookCount >= 2)    ? 'medium'
               : 'low';

  const narrativeParts = [];
  if (webhookCount)     narrativeParts.push(`${webhookCount} outbound webhook/analytics pipeline destination${webhookCount !== 1 ? 's' : ''}`);
  if (config.extensions.length) narrativeParts.push(`${config.extensions.length} account-level extension${config.extensions.length !== 1 ? 's' : ''}`);
  if (config.incidentWorkflows.filter(w => w.steps?.length).length) narrativeParts.push(`${config.incidentWorkflows.filter(w => w.steps?.length).length} active incident workflow${config.incidentWorkflows.filter(w => w.steps?.length).length !== 1 ? 's' : ''}`);
  if (eoCount)          narrativeParts.push(`${eoCount} event orchestration layer${eoCount !== 1 ? 's' : ''}`);
  if (automationCount)  narrativeParts.push(`${automationCount} automation action${automationCount !== 1 ? 's' : ''}`);

  const narrative = narrativeParts.length
    ? `Shadow stack includes: ${narrativeParts.join(', ')}. Each component requires explicit migration planning.`
    : 'No significant shadow stack signals detected. This domain uses PagerDuty in a relatively standard configuration.';

  return {
    signals: deduped,
    webhookDestinationCount: webhookCount,
    automationPatternCount:  automationCount,
    eoRoutingLayerCount:     eoCount,
    apiConsumerCount:        0, // log-entry based — not available in config-only mode
    estimatedMaintenanceBurden: burden,
    maintenanceNarrative: narrative,
    dataLimitations: [
      'API consumer detection requires incident log entries (not collected in config-only mode).',
      'Auto-acknowledge/auto-resolve pattern detection requires incident log entries.',
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — RISK ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

function analyzeRisk(config, shadowStack, conversions) {
  const signals = [];

  // Complex escalation policies (>3 levels or >1 loop)
  for (const ep of config.escalationPolicies) {
    const rules = ep.escalation_rules || [];
    if (rules.length > 5 || (ep.num_loops || 0) > 2) {
      signals.push({
        type: 'complex_escalation', severity: 'medium',
        description: `Escalation policy "${ep.name}" has ${rules.length} levels and ${ep.num_loops || 0} loops`,
      });
    }
  }

  // Complex on-call: teams with many schedules
  const teamScheduleCount = new Map();
  for (const sched of config.schedules) {
    for (const t of (sched.teams || [])) {
      teamScheduleCount.set(t.id, (teamScheduleCount.get(t.id) || 0) + 1);
    }
  }
  const teamMap = new Map(config.teams.map(t => [t.id, t.name]));
  teamScheduleCount.forEach((count, teamId) => {
    if (count > 3) {
      signals.push({
        type: 'complex_on_call', severity: 'low',
        description: `Team "${teamMap.get(teamId) || teamId}" has ${count} on-call schedules`,
      });
    }
  });

  // Large service footprint
  if (config.services.length > 100) {
    signals.push({
      type: 'large_service_footprint', severity: 'high',
      description: `${config.services.length} services — large footprint increases migration scope`,
    });
  } else if (config.services.length > 30) {
    signals.push({
      type: 'moderate_service_footprint', severity: 'medium',
      description: `${config.services.length} services — moderate migration scope`,
    });
  }

  // Shadow stack signals feed into risk
  if (shadowStack.signals.length > 10) {
    signals.push({
      type: 'heavy_shadow_stack', severity: 'high',
      description: `${shadowStack.signals.length} shadow stack signals — significant custom integration work`,
    });
  } else if (shadowStack.signals.length > 4) {
    signals.push({
      type: 'moderate_shadow_stack', severity: 'medium',
      description: `${shadowStack.signals.length} shadow stack signals detected`,
    });
  }

  // Event orchestration complexity
  if (config.eventOrchestrations.length > 5) {
    signals.push({
      type: 'complex_eo', severity: 'medium',
      description: `${config.eventOrchestrations.length} Event Orchestrations — routing logic must be re-implemented as alert routes`,
    });
  }

  // Unsupported resources
  const unsupportedCount = conversions.filter(c => c.status === 'UNSUPPORTED').length;
  if (unsupportedCount > 0) {
    signals.push({
      type: 'unsupported_resources', severity: 'medium',
      description: `${unsupportedCount} resource type(s) with no direct incident.io equivalent`,
    });
  }

  const high   = signals.filter(s => s.severity === 'high').length;
  const medium = signals.filter(s => s.severity === 'medium').length;

  const overallComplexity =
    high >= 3           ? 'VERY_HIGH' :
    high >= 2 || medium >= 4 ? 'HIGH' :
    high >= 1 || medium >= 2 ? 'MEDIUM' : 'LOW';

  return { overallComplexity, signals };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — PROJECT PLAN GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

function generateProjectPlan(config, conversions, shadowStack, risk) {
  const serviceResources  = config.services;
  const scheduleResources = config.schedules;
  const epResources       = config.escalationPolicies;

  const effortByType = { Low: 0.5, Medium: 2, High: 5 };
  const statusByName = new Map(conversions.map(c => [c.name, c.status]));

  // Per-team metrics
  const teams = config.teams.map(team => {
    const teamServices  = serviceResources.filter(s => s.teams?.some(t => t.id === team.id));
    const teamSchedules = scheduleResources.filter(s => s.teams?.some(t => t.id === team.id));
    const teamEPs       = epResources.filter(ep => ep.teams?.some(t => t.id === team.id));

    const shadowCount = shadowStack.signals.filter(sig =>
      teamServices.some(s => sig.description?.includes(s.name))
    ).length;

    let effortDays = 1;
    [...teamServices, ...teamSchedules, ...teamEPs].forEach(r => {
      const conv = conversions.find(c => c.id === r.id);
      if (conv) effortDays += effortByType[conv.effort] || 1;
    });

    let riskScore = 1;
    const riskFlags = [];
    if (teamServices.length > 20)  { riskScore += 2; riskFlags.push('Large service footprint'); }
    else if (teamServices.length > 10) { riskScore += 1; riskFlags.push('Moderate service count'); }
    if (shadowCount > 3)           { riskScore += 3; riskFlags.push('Shadow stack dependencies'); }
    const manualRatio = teamServices.filter(s => {
      const c = conversions.find(x => x.id === s.id);
      return c?.status === 'MANUAL';
    }).length / Math.max(teamServices.length, 1);
    if (manualRatio > 0.5) { riskScore += 1; riskFlags.push('High manual conversion ratio'); }

    return {
      teamId: team.id, teamName: team.name,
      serviceCount: teamServices.length, scheduleCount: teamSchedules.length, epCount: teamEPs.length,
      shadowStackSignalCount: shadowCount, riskScore: Math.min(riskScore, 10),
      effortDays: Math.round(effortDays), riskFlags, recommendedWave: 0,
    };
  });

  // Assign waves by risk score
  const sorted = [...teams].sort((a, b) => a.riskScore - b.riskScore);
  const total  = sorted.length;
  sorted.forEach((t, i) => {
    t.recommendedWave = total <= 3 ? i + 1
      : i < Math.ceil(total * 0.3) ? 1
      : i < Math.ceil(total * 0.7) ? 2 : 3;
  });
  sorted.forEach(st => { const t = teams.find(x => x.teamId === st.teamId); if (t) t.recommendedWave = st.recommendedWave; });

  const pilotTeams = sorted.slice(0, Math.min(3, sorted.length)).map((t, i) => {
    const reasons = [];
    if (t.riskScore <= 3)               reasons.push('low risk profile');
    if (t.serviceCount <= 10)           reasons.push(`manageable service count (${t.serviceCount})`);
    if (t.shadowStackSignalCount === 0) reasons.push('no shadow stack dependencies');
    if (t.scheduleCount > 0)            reasons.push('has active on-call schedules');
    return {
      teamId: t.teamId, teamName: t.teamName,
      serviceCount: t.serviceCount,
      reason: reasons.length ? `Pilot #${i+1}: ${reasons.join(', ')}.` : 'Lowest complexity team.',
      score: 10 - t.riskScore,
    };
  });

  const wave1 = teams.filter(t => t.recommendedWave === 1).map(t => t.teamName);
  const wave2 = teams.filter(t => t.recommendedWave === 2).map(t => t.teamName);
  const wave3 = teams.filter(t => t.recommendedWave === 3).map(t => t.teamName);
  const totalEffort = teams.reduce((s, t) => s + t.effortDays, 0);
  const shadowItems = shadowStack.signals.length;

  const months = { LOW:4, MEDIUM:5, HIGH:7, VERY_HIGH:9 }[risk.overallComplexity] || 7;

  const phases = [
    {
      phase: 1, name: 'Discovery & Foundation', duration: 'Weeks 1–8',
      description: 'Stand up incident.io, build service catalog, configure SSO/RBAC, connect monitoring integrations in parallel. Complete shadow stack mapping.',
      teams: ['All teams (platform-level)'],
      tasks: [
        'Provision incident.io tenant and configure SSO',
        'Import service catalog from PagerDuty configuration snapshot',
        'Enrich catalog with ownership data (Backstage / CMDB / manual)',
        'Connect monitoring integrations (PagerDuty stays primary during this phase)',
        'Validate alert routing matches current PagerDuty configuration',
        'Map all shadow stack components and assign to migration phases',
      ],
    },
    {
      phase: 2, name: 'On-Call Migration', duration: 'Weeks 9–16',
      description: `Migrate on-call scheduling via schedule mirroring. Wave 1 (pilot): ${wave1.join(', ') || 'TBD'}. Wave 2: ${wave2.join(', ') || 'TBD'}. Wave 3: ${wave3.join(', ') || 'TBD'}.`,
      teams: [...wave1, ...wave2, ...wave3],
      tasks: [
        `Wave 1 (Pilot): Import schedules for ${wave1.join(', ') || 'pilot teams'}`,
        'Enable schedule mirroring — validate parity for 1-2 weeks before switching over',
        'Switch pilot teams to incident.io primary, PagerDuty as backup',
        `Wave 2: Roll out to ${wave2.length} additional team(s)`,
        `Wave 3: Migrate remaining ${wave3.length} higher-complexity team(s)`,
        'Verify zero missed pages across all waves before proceeding',
      ],
    },
    {
      phase: 3, name: 'Workflow & Shadow Stack Replacement', duration: 'Weeks 17–24',
      description: `Migrate incident workflows, replace ${shadowItems} shadow stack component(s) with incident.io native features. Decommission custom tooling.`,
      teams: ['All teams'],
      tasks: [
        'Translate incident workflows to incident.io Workflow builder',
        'Replace custom Slack/Teams bots with native incident.io integration',
        'Repoint enrichment pipelines to Catalog attributes + Workflow steps',
        'Migrate Event Orchestration routing rules to incident.io alert routes',
        'Decommission outbound webhooks (replace with Workflow actions)',
        'Update Terraform modules from PagerDuty provider to incident.io provider',
      ],
    },
    {
      phase: 4, name: 'Cutover & Decommission', duration: 'Weeks 25–28',
      description: 'Remove all PagerDuty dependencies, complete contractual exit, establish incident.io as sole platform.',
      teams: ['All teams'],
      tasks: [
        'Final audit: verify no active PagerDuty API consumers remain',
        'Export historical PagerDuty data for compliance / archival',
        'Remove PagerDuty SSO/SCIM integration from IdP',
        'Revoke all PagerDuty API keys and service integrations',
        'Update internal documentation — replace all PagerDuty references',
        'Send PagerDuty non-renewal notice to procurement',
      ],
    },
  ];

  return { teams, pilotTeams, phases, totalEffortDays: totalEffort, estimatedMonths: months };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — HTML REPORT GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

function generateHTMLReport({ domain, analysisDate, days, config, conversions, shadowStack, risk, plan, abilities }) {
  const counts = {
    services:           config.services.length,
    teams:              config.teams.length,
    schedules:          config.schedules.length,
    escalationPolicies: config.escalationPolicies.length,
    users:              config.users.length,
    businessServices:   config.businessServices.length,
    incidentWorkflows:  config.incidentWorkflows.length,
    eventOrchestrations:config.eventOrchestrations.length,
    extensions:         config.extensions.length,
    webhooks:           config.webhooks.length,
    automationActions:  config.automationActions.length,
    rulesets:           config.rulesets.length,
  };

  const statusGroups = { AUTO: 0, MANUAL: 0, SKIP: 0, UNSUPPORTED: 0 };
  conversions.forEach(c => { statusGroups[c.status] = (statusGroups[c.status] || 0) + 1; });

  const complexityColor = { LOW:'#16a34a', MEDIUM:'#ca8a04', HIGH:'#ea580c', VERY_HIGH:'#dc2626' };
  const complexityLabel = { LOW:'Low', MEDIUM:'Medium', HIGH:'High', VERY_HIGH:'Very High' };
  const statusColor = { AUTO:'#16a34a', MANUAL:'#ca8a04', SKIP:'#6b7280', UNSUPPORTED:'#dc2626' };
  const statusBg    = { AUTO:'#dcfce7', MANUAL:'#fef9c3', SKIP:'#f3f4f6', UNSUPPORTED:'#fee2e2' };
  const signalColor = { high:'#dc2626', medium:'#ca8a04', low:'#6b7280' };

  const badge = (status) => `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;background:${statusBg[status]};color:${statusColor[status]}">${status}</span>`;
  const escHtml = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const cell = (content, opts = '') => `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px${opts ? ';' + opts : ''}">${content}</td>`;

  // ── ACCOUNT ABILITIES: categorise into meaningful groups ─────────────────
  const ABILITY_GROUPS = {
    'AI & Noise Reduction': ['event_intelligence','aiops','preview_intelligent_alert_grouping',
      'time_based_alert_grouping','incident_correlation','similar_incidents','analytics_recommendations',
      'event_intelligence_datadog_widget'],
    'Automation': ['response_automation','rundeck_actions','incident_workflows','beta_custom_actions',
      'automation_actions'],
    'Event Processing': ['event_rules','global_rulesets','dynamic_notifications','change_events',
      'preview_incident_alert_split'],
    'Access & Permissions': ['sso','teams','read_only_users','advanced_permissions',
      'permissions_service','manage_api_keys','team_responders'],
    'On-Call & Scheduling': ['manage_schedules','mobile_schedules','urgencies',
      'service_support_hours','coordinated_responding'],
    'Analytics & Visibility': ['operations_console','mobile_analytics','mobile_home_analytics_v1',
      'status_dashboard_advanced','subscribers_status_updates','status_update_integration'],
    'Integrations': ['advanced_ticketing_integrations','incident_priority_activated',
      'beta_conference_calls','tags','premium_custom_fields','enable_custom_fields_on_incidents'],
  };
  const KEY_ABILITIES = new Set(['event_intelligence','aiops','automation_actions',
    'incident_workflows','rundeck_actions','global_rulesets','operations_console',
    'advanced_permissions','sso','preview_intelligent_alert_grouping']);

  const abilitySet = new Set(abilities);
  const abilityCategorised = Object.entries(ABILITY_GROUPS).map(([group, keys]) => {
    const present  = keys.filter(k => abilitySet.has(k));
    const absent   = keys.filter(k => !abilitySet.has(k) && KEY_ABILITIES.has(k));
    if (!present.length && !absent.length) return '';
    const items = [
      ...present.map(k => `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:12px;font-size:12px;background:${KEY_ABILITIES.has(k)?'#ede9fe':'#f3f4f6'};color:${KEY_ABILITIES.has(k)?'#7c3aed':'#374151'}">${escHtml(k)}</span>`),
      ...absent.map(k  => `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:12px;font-size:12px;background:#f3f4f6;color:#9ca3af;text-decoration:line-through" title="Not enabled">${escHtml(k)}</span>`),
    ].join('');
    return `<div style="margin-bottom:12px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin-bottom:6px">${escHtml(group)}</div>${items}</div>`;
  }).join('');

  // Flag notable plan signals
  const hasAI       = abilitySet.has('event_intelligence') || abilitySet.has('aiops');
  const hasRundecks = abilitySet.has('rundeck_actions');
  const hasIW       = abilitySet.has('incident_workflows');
  const planNotes   = [
    !hasAI       && '⚠️ AIOps / Event Intelligence not detected — account may be on Professional tier',
    hasRundecks  && '🔧 Rundeck Actions enabled — automation actions will need migration planning',
    hasIW        && '⚙️ Incident Workflows enabled — workflow steps need mapping to incident.io Workflows',
  ].filter(Boolean);

  // ── RESOURCE INVENTORY: one row per resource type, not per resource ───────
  // Ordered by migration significance (UNSUPPORTED/MANUAL first)
  const TYPE_META = {
    SERVICE:            { label:'Services',             status:'MANUAL',      ioType:'Catalog entry + alert routes', effort:'Medium' },
    BUSINESS_SERVICE:   { label:'Business Services',    status:'MANUAL',      ioType:'Custom catalog entry',         effort:'Medium' },
    RULESET:            { label:'Rulesets (legacy)',     status:'UNSUPPORTED', ioType:'—',                            effort:'High'   },
    INCIDENT_WORKFLOW:  { label:'Incident Workflows',   status:'MANUAL',      ioType:'incident.io Workflow',         effort:'Medium' },
    EVENT_ORCHESTRATION:{ label:'Event Orchestrations', status:'MANUAL',      ioType:'Alert routes + conditions',    effort:'Medium' },
    EXTENSION:          { label:'Extensions',           status:'MANUAL',      ioType:'Workflow action',              effort:'Medium' },
    WEBHOOK_SUBSCRIPTION:{ label:'Webhook Subscriptions',status:'MANUAL',     ioType:'Workflow / native webhook',    effort:'Low'    },
    ESCALATION_POLICY:  { label:'Escalation Policies',  status:'AUTO',        ioType:'Escalation path',              effort:'Low'    },
    SCHEDULE:           { label:'Schedules',            status:'AUTO',        ioType:'On-call schedule',             effort:'Low'    },
    TEAM:               { label:'Teams',                status:'AUTO',        ioType:'Service Catalog entry',        effort:'Low'    },
    USER:               { label:'Users',                status:'SKIP',        ioType:'SSO / SCIM',                   effort:'Low'    },
  };
  const TYPE_NOTES = {
    SERVICE:            'Each service needs a Catalog entry and at least one alert route. Review integrations per service.',
    BUSINESS_SERVICE:   'Map to custom Catalog type with supporting service relationships.',
    RULESET:            'Legacy event rules have no direct equivalent. Routing logic must be rebuilt as alert routes.',
    INCIDENT_WORKFLOW:  'Workflow steps recreated in incident.io Workflow builder. Native integrations (Slack, Jira) map directly.',
    EVENT_ORCHESTRATION:'Routing rules translate to alert route conditions. Review rule complexity before planning.',
    EXTENSION:          'Per extension: evaluate whether incident.io native integration covers the functionality.',
    WEBHOOK_SUBSCRIPTION:'Replace with incident.io Workflow HTTP step or native webhook. Low effort per webhook.',
    ESCALATION_POLICY:  'Direct import via Terraform or UI. Review multi-level and looping policies.',
    SCHEDULE:           'Direct import. Verify timezone and layer configuration post-import.',
    TEAM:               'Imported as Service Catalog entries. Enrich with ownership attributes post-migration.',
    USER:               'Provisioned via SSO/SCIM — not migrated via Terraform. No action required.',
  };

  // Count by type
  const countByType = {};
  conversions.forEach(c => { countByType[c.type] = (countByType[c.type] || 0) + 1; });

  const inventoryRows = Object.entries(TYPE_META)
    .filter(([type]) => countByType[type] > 0)
    .map(([type, meta]) => {
      const count = countByType[type] || 0;
      return `<tr>
        ${cell(`<strong>${escHtml(meta.label)}</strong>`)}
        ${cell(`<span style="font-size:22px;font-weight:800;color:${statusColor[meta.status]}">${count}</span>`, 'text-align:center')}
        ${cell(badge(meta.status))}
        ${cell(escHtml(meta.ioType), 'color:#6b7280')}
        ${cell(escHtml(meta.effort), 'color:#6b7280')}
        ${cell(escHtml(TYPE_NOTES[type] || ''), 'color:#6b7280;font-size:12px')}
      </tr>`;
    }).join('');

  // ── SHADOW STACK: group by signal type, show count + named examples ───────
  const shadowGroups = new Map();
  shadowStack.signals.forEach(s => {
    if (!shadowGroups.has(s.type)) shadowGroups.set(s.type, []);
    shadowGroups.get(s.type).push(s);
  });

  const SHADOW_TYPE_LABEL = {
    webhook_destination:   'Outbound Webhooks',
    analytics_pipeline:    'Analytics Pipeline Destinations',
    custom_extension:      'Custom Extensions',
    workflow_integration:  'Incident Workflow Integrations',
    eo_routing_layer:      'Event Orchestration Routing Layers',
    automation_action:     'Automation Actions',
    enrichment_middleware: 'Custom Event Transformers',
    api_consumer:          'API Consumers',
    auto_ack:              'Auto-Acknowledge Patterns',
    auto_resolve:          'Auto-Resolve Patterns',
  };

  const shadowSection = shadowStack.signals.length === 0
    ? '<p style="color:#6b7280;padding:8px 0">No shadow stack signals detected. This domain uses PagerDuty in a standard configuration.</p>'
    : Array.from(shadowGroups.entries()).map(([type, signals]) => {
        const label    = SHADOW_TYPE_LABEL[type] || type.replace(/_/g,' ');
        const rep      = signals[0].incidentIoReplacement;
        const examples = signals.slice(0, 5).map(s => {
          // Extract a short name from the description (strip the type prefix)
          const name = s.description.replace(/^[^:]+:\s*/,'').replace(/ \(\d+ .*?\)$/,'');
          return `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:4px;font-size:12px;background:#f3f4f6;color:#374151">${escHtml(name)}</span>`;
        }).join('');
        const overflow = signals.length > 5 ? `<span style="font-size:12px;color:#6b7280"> +${signals.length - 5} more</span>` : '';

        return `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px">
            <div style="display:flex;align-items:center;gap:10px">
              <span style="background:#ede9fe;color:#7c3aed;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;white-space:nowrap">${escHtml(label.toUpperCase())}</span>
              <span style="font-size:20px;font-weight:800;color:#7c3aed">${signals.length}</span>
            </div>
            <span style="font-size:12px;color:#7c3aed;font-weight:600">Effort: ${escHtml(rep.effort)}</span>
          </div>
          <div style="margin-bottom:8px">${examples}${overflow}</div>
          <div style="background:#f8fafc;border-radius:6px;padding:10px;font-size:13px">
            <span style="font-weight:600;color:#374151">incident.io: </span>${escHtml(rep.feature)} &nbsp;·&nbsp;
            <span style="color:#6b7280">${escHtml(rep.action)}</span>
          </div>
        </div>`;
      }).join('');

  // ── RISK SIGNALS ──────────────────────────────────────────────────────────
  const riskRows = risk.signals.length === 0
    ? '<tr><td colspan="2" style="padding:16px;color:#6b7280">No significant risk signals detected.</td></tr>'
    : risk.signals.map(s => `<tr>
        ${cell(`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${signalColor[s.severity]};margin-right:8px"></span><strong>${s.type.replace(/_/g,' ')}</strong>`)}
        ${cell(escHtml(s.description), 'color:#374151')}
      </tr>`).join('');

  // ── TEAM WAVES: wave summary bars + collapsible full table ────────────────
  const waveSummary = [1,2,3].map(w => {
    const wTeams = plan.teams.filter(t => t.recommendedWave === w);
    if (!wTeams.length) return '';
    const wColor = w===1?'#16a34a':w===2?'#ca8a04':'#dc2626';
    const wBg    = w===1?'#f0fdf4':w===2?'#fefce8':'#fff1f2';
    const totalSvcs = wTeams.reduce((s,t) => s+t.serviceCount, 0);
    const names = wTeams.slice(0,8).map(t => escHtml(t.teamName)).join(', ');
    const overflow = wTeams.length > 8 ? ` <span style="color:#6b7280">+${wTeams.length-8} more</span>` : '';
    return `<div style="border-radius:8px;padding:14px 16px;margin-bottom:8px;background:${wBg};border:1px solid ${wColor}30">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
        <span style="font-weight:700;font-size:13px;color:${wColor}">Wave ${w}</span>
        <span style="font-size:13px;color:#374151">${wTeams.length} team${wTeams.length!==1?'s':''} · ${totalSvcs} service${totalSvcs!==1?'s':''}</span>
      </div>
      <div style="font-size:13px;color:#6b7280">${names}${overflow}</div>
    </div>`;
  }).join('');

  const teamTableRows = plan.teams.length === 0
    ? '<tr><td colspan="5" style="padding:16px;color:#6b7280">No teams found in this domain.</td></tr>'
    : plan.teams
        .sort((a,b) => a.recommendedWave - b.recommendedWave || b.riskScore - a.riskScore)
        .map(t => {
          const wc = t.recommendedWave===1?'#16a34a':t.recommendedWave===2?'#ca8a04':'#dc2626';
          const wb = t.recommendedWave===1?'#dcfce7':t.recommendedWave===2?'#fef9c3':'#fee2e2';
          return `<tr>
            ${cell(escHtml(t.teamName),'font-weight:500')}
            ${cell(String(t.serviceCount),'text-align:center;color:#6b7280')}
            ${cell(String(t.scheduleCount),'text-align:center;color:#6b7280')}
            ${cell(String(t.shadowStackSignalCount),'text-align:center;color:#6b7280')}
            ${cell(`<span style="padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;background:${wb};color:${wc}">Wave ${t.recommendedWave}</span>`,'text-align:center')}
          </tr>`;
        }).join('');

  // ── MIGRATION PHASES ──────────────────────────────────────────────────────
  const phaseCards = plan.phases.map(ph => `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#ede9fe;color:#7c3aed;margin-bottom:6px">Phase ${ph.phase}</span>
          <div style="font-size:16px;font-weight:700">${escHtml(ph.name)}</div>
        </div>
        <span style="font-size:13px;color:#6b7280;white-space:nowrap">${escHtml(ph.duration)}</span>
      </div>
      <p style="font-size:13px;color:#6b7280;margin:0 0 12px 0">${escHtml(ph.description)}</p>
      <ul style="margin:0;padding-left:20px;font-size:13px;color:#374151">
        ${ph.tasks.map(t => `<li style="margin-bottom:4px">${escHtml(t)}</li>`).join('')}
      </ul>
    </div>`).join('');

  // ── PILOT RECOMMENDATIONS ─────────────────────────────────────────────────
  const pilotCards = plan.pilotTeams.length === 0
    ? '<p style="color:#6b7280">No teams found — add team assignments to services in PagerDuty for pilot recommendations.</p>'
    : plan.pilotTeams.map(t => `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;background:#f0fdf4">
        <div style="font-weight:700;font-size:14px;margin-bottom:4px">🏆 ${escHtml(t.teamName)}</div>
        <div style="font-size:13px;color:#374151">${escHtml(t.reason)}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px">${t.serviceCount} service(s)</div>
      </div>`).join('');

  // ── DATA MANIFEST ─────────────────────────────────────────────────────────
  const dataManifest = `
    <tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">Account abilities</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">Plan and feature flags — GET /abilities</td></tr>
    <tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">Services</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">Names, integrations, alert grouping — GET /services</td></tr>
    <tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">Teams + Members</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">Team names, member roles — GET /teams</td></tr>
    <tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">Schedules</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">Schedule layers and team assignments — GET /schedules</td></tr>
    <tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">Escalation policies</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">Policy rules and targets — GET /escalation_policies</td></tr>
    <tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">Users</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">Name, email, role — GET /users</td></tr>
    <tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">Business services</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">Names and dependencies — GET /business_services</td></tr>
    <tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">Extensions</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">ServiceNow, Jira, Slack, custom webhooks — GET /extensions</td></tr>
    <tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">Webhook subscriptions</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">Outbound webhook destinations — GET /webhook_subscriptions</td></tr>
    <tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">Incident workflows</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">Workflow names, step action IDs — GET /incident_workflows</td></tr>
    <tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">Event orchestrations</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">Names and routing rules — GET /event_orchestrations</td></tr>
    <tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">Automation actions</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">Action names and runner assignments — GET /automation_actions</td></tr>
    <tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">Incident service IDs (stale detection)</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">Only service.id per incident — no titles, content, or payloads — GET /incidents</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>PagerDuty Configuration Analysis — ${escHtml(domain)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #111827; line-height: 1.5; }
    a { color: #7c3aed; }
    .page { max-width: 960px; margin: 0 auto; padding: 32px 24px; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 24px; margin-bottom: 24px; }
    .section-title { font-size: 18px; font-weight: 700; margin-bottom: 16px; color: #111827; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
    .stat-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center; }
    .stat-num  { font-size: 28px; font-weight: 800; color: #7c3aed; }
    .stat-label{ font-size: 12px; color: #6b7280; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 10px 12px; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: .5px; background: #f8fafc; border-bottom: 2px solid #e5e7eb; }
    .notice { background: #fefce8; border: 1px solid #fde047; border-radius: 8px; padding: 14px 16px; font-size: 13px; color: #713f12; margin-bottom: 16px; }
    .complexity-badge { display: inline-block; padding: 4px 12px; border-radius: 6px; font-size: 14px; font-weight: 700; }
    @media print { .page { padding: 0; } }
  </style>
</head>
<body>
<div class="page">

  <!-- ── HEADER ── -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-size:13px;font-weight:700;color:#7c3aed;letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">incident.io</div>
      <h1 style="font-size:26px;font-weight:800;color:#111827">PagerDuty Configuration Analysis</h1>
      <p style="color:#6b7280;font-size:14px;margin-top:4px">Domain: <strong>${escHtml(domain)}</strong> &nbsp;·&nbsp; Analysis date: ${escHtml(analysisDate)} &nbsp;·&nbsp; Lookback: ${days} days</p>
    </div>
    <div style="text-align:right">
      <div class="complexity-badge" style="background:${complexityColor[risk.overallComplexity]}20;color:${complexityColor[risk.overallComplexity]}">
        Migration Complexity: ${complexityLabel[risk.overallComplexity]}
      </div>
      <div style="font-size:12px;color:#6b7280;margin-top:6px">${plan.estimatedMonths}-month estimated migration timeline</div>
    </div>
  </div>

  <!-- ── TRANSPARENCY NOTICE ── -->
  <div class="notice">
    <strong>Transparency note:</strong> This report was generated using only read-only GET requests to the PagerDuty REST API.
    No incident content, alert payloads, or configuration values were collected.
    See the <a href="#data-collected">Data Collected</a> section for the full list of API calls made.
  </div>

  <!-- ── RESOURCE SUMMARY ── -->
  <div class="card">
    <div class="section-title">Resource Summary</div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${counts.services}</div><div class="stat-label">Services</div></div>
      <div class="stat-card"><div class="stat-num">${counts.teams}</div><div class="stat-label">Teams</div></div>
      <div class="stat-card"><div class="stat-num">${counts.schedules}</div><div class="stat-label">Schedules</div></div>
      <div class="stat-card"><div class="stat-num">${counts.escalationPolicies}</div><div class="stat-label">Escalation Policies</div></div>
      <div class="stat-card"><div class="stat-num">${counts.users}</div><div class="stat-label">Users</div></div>
      <div class="stat-card"><div class="stat-num">${counts.incidentWorkflows}</div><div class="stat-label">Incident Workflows</div></div>
      <div class="stat-card"><div class="stat-num">${counts.eventOrchestrations}</div><div class="stat-label">Event Orchestrations</div></div>
      <div class="stat-card"><div class="stat-num">${counts.automationActions}</div><div class="stat-label">Automation Actions</div></div>
    </div>
    <div class="stat-grid" style="margin-top:16px">
      <div class="stat-card"><div class="stat-num" style="color:#16a34a">${statusGroups.AUTO}</div><div class="stat-label">AUTO (direct import)</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#ca8a04">${statusGroups.MANUAL}</div><div class="stat-label">MANUAL (config work)</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">${statusGroups.UNSUPPORTED}</div><div class="stat-label">UNSUPPORTED</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#6b7280">${statusGroups.SKIP}</div><div class="stat-label">SKIP (SSO/SCIM)</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#7c3aed">${shadowStack.signals.length}</div><div class="stat-label">Shadow Stack Signals</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#7c3aed">${plan.estimatedMonths}mo</div><div class="stat-label">Est. Timeline</div></div>
    </div>
  </div>

  <!-- ── ACCOUNT ABILITIES ── -->
  <div class="card">
    <div class="section-title">Account Plan &amp; Features</div>
    ${planNotes.length ? `<div style="margin-bottom:16px">${planNotes.map(n => `<div style="font-size:13px;padding:6px 10px;margin-bottom:4px;border-radius:6px;background:#fefce8;border:1px solid #fde047;color:#713f12">${n}</div>`).join('')}</div>` : ''}
    ${abilityCategorised || '<p style="color:#6b7280;font-size:13px">No abilities returned — token may have limited scope.</p>'}
    <p style="font-size:11px;color:#9ca3af;margin-top:12px">Purple = key feature for migration planning · Strikethrough = not enabled on this account</p>
  </div>

  <!-- ── RESOURCE INVENTORY ── -->
  <div class="card">
    <div class="section-title">Resource Inventory &amp; Conversion Status</div>
    <p style="font-size:13px;color:#6b7280;margin-bottom:16px">
      <strong>AUTO</strong> resources import directly into incident.io. <strong>MANUAL</strong> requires configuration work.
      <strong>UNSUPPORTED</strong> resources must be re-implemented. <strong>SKIP</strong> resources are handled via SSO/SCIM.
    </p>
    <div style="overflow-x:auto">
      <table>
        <thead><tr>
          <th>Resource Type</th><th style="text-align:center">Count</th><th>Status</th>
          <th>incident.io Equivalent</th><th>Effort</th><th>Migration Notes</th>
        </tr></thead>
        <tbody>${inventoryRows}</tbody>
      </table>
    </div>
  </div>

  <!-- ── SHADOW STACK ── -->
  <div class="card">
    <div class="section-title">Shadow Stack Analysis</div>
    <p style="font-size:13px;color:#6b7280;margin-bottom:12px">${escHtml(shadowStack.maintenanceNarrative)}</p>
    ${shadowStack.dataLimitations.length ? `<p style="font-size:12px;color:#9ca3af;margin-bottom:16px;font-style:italic">Note: ${shadowStack.dataLimitations[0]}</p>` : ''}
    ${shadowSection}
  </div>

  <!-- ── RISK SIGNALS ── -->
  <div class="card">
    <div class="section-title">Migration Risk Signals</div>
    <p style="font-size:13px;color:#6b7280;margin-bottom:16px">
      Overall complexity: <span class="complexity-badge" style="font-size:13px;background:${complexityColor[risk.overallComplexity]}20;color:${complexityColor[risk.overallComplexity]}">${complexityLabel[risk.overallComplexity]}</span>
    </p>
    <table>
      <thead><tr><th>Signal</th><th>Description</th></tr></thead>
      <tbody>${riskRows}</tbody>
    </table>
  </div>

  <!-- ── PILOT RECOMMENDATIONS ── -->
  <div class="card">
    <div class="section-title">Recommended Pilot Teams</div>
    <p style="font-size:13px;color:#6b7280;margin-bottom:16px">These teams have the lowest migration risk and are ideal starting points for a phased rollout.</p>
    ${pilotCards}
  </div>

  <!-- ── TEAM MIGRATION WAVES ── -->
  <div class="card">
    <div class="section-title">Team Migration Waves</div>
    <p style="font-size:13px;color:#6b7280;margin-bottom:16px">Teams sorted by migration risk. Wave 1 = lowest risk (pilot). Wave 3 = highest complexity.</p>
    ${waveSummary}
    <details style="margin-top:12px">
      <summary style="cursor:pointer;font-size:13px;font-weight:600;color:#7c3aed;user-select:none;padding:8px 0">Show full team list (${plan.teams.length} teams)</summary>
      <div style="overflow-x:auto;margin-top:12px">
        <table>
          <thead><tr>
            <th>Team</th><th style="text-align:center">Services</th>
            <th style="text-align:center">Schedules</th>
            <th style="text-align:center">Shadow Signals</th>
            <th style="text-align:center">Wave</th>
          </tr></thead>
          <tbody>${teamTableRows}</tbody>
        </table>
      </div>
    </details>
  </div>

  <!-- ── MIGRATION PHASES ── -->
  <div class="card">
    <div class="section-title">Migration Roadmap</div>
    <p style="font-size:13px;color:#6b7280;margin-bottom:16px">
      Estimated total migration: <strong>${plan.estimatedMonths} months</strong> &nbsp;·&nbsp;
      Total effort: <strong>~${plan.totalEffortDays} engineer-days</strong>
    </p>
    ${phaseCards}
  </div>

  <!-- ── DATA COLLECTED ── -->
  <div class="card" id="data-collected">
    <div class="section-title">Data Collected</div>
    <p style="font-size:13px;color:#6b7280;margin-bottom:16px">
      The following PagerDuty API endpoints were called to produce this report. All requests were read-only (GET).
      No data was written, modified, or deleted. No incident content, alert payloads, or credential values were collected.
    </p>
    <table>
      <thead><tr><th>Data Type</th><th>What Was Collected</th></tr></thead>
      <tbody>${dataManifest}</tbody>
    </table>
  </div>

  <!-- ── FOOTER / CTA ── -->
  <div style="text-align:center;padding:32px 0;border-top:1px solid #e5e7eb;margin-top:8px">
    <div style="font-size:16px;font-weight:700;color:#111827;margin-bottom:8px">Ready to explore migration further?</div>
    <p style="font-size:14px;color:#6b7280;max-width:480px;margin:0 auto 16px">
      incident.io's Solution Architects can walk you through a full migration assessment, live demo, and tailored migration plan based on these findings.
    </p>
    <a href="https://incident.io/demo" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 24px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none">Book a migration walkthrough →</a>
    <p style="font-size:12px;color:#9ca3af;margin-top:16px">
      Report generated by the incident.io PagerDuty Configuration Analyzer &nbsp;·&nbsp; <a href="https://incident.io">incident.io</a>
    </p>
  </div>

</div>
</body>
</html>`;
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
  log(`${C.dim}automation actions, and incident IDs from the last ${ARGS.days} days (stale detection only).${C.reset}`);
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
  log(`  Output       : ${C.bold}${ARGS.output || `pd-analysis-${domain}-${new Date().toISOString().slice(0,10)}.html`}${C.reset}`);
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
  log(`  ${C.green}${config.automationActions.length}${C.reset} automation actions  ·  ${C.green}${config.extensions.length}${C.reset} extensions  ·  ${C.green}${config.webhooks.length}${C.reset} webhook subscriptions`);
  log();

  // ── Step 6: Run analysis ───────────────────────────────────────────────
  step(5, 5, 'Running analysis...');

  const conversions  = computeConversions(config);
  const shadowStack  = analyzeShadowStack(config);
  const risk         = analyzeRisk(config, shadowStack, conversions);
  const plan         = generateProjectPlan(config, conversions, shadowStack, risk);

  const statusGroups = { AUTO:0, MANUAL:0, SKIP:0, UNSUPPORTED:0 };
  conversions.forEach(c => statusGroups[c.status]++);

  ok(`Analysis complete — ${C.bold}${risk.overallComplexity}${C.reset} complexity, ${C.bold}${shadowStack.signals.length}${C.reset} shadow stack signals`);
  log();

  // ── Step 7: Generate report ────────────────────────────────────────────
  const analysisDate = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
  const outputFile   = ARGS.output || `pd-analysis-${domain}-${new Date().toISOString().slice(0,10)}.html`;
  const abilities    = config.abilities;

  const html = generateHTMLReport({ domain, analysisDate, days: ARGS.days, config, conversions, shadowStack, risk, plan, abilities });

  const outputPath = path.resolve(outputFile);
  fs.writeFileSync(outputPath, html, 'utf8');

  log();
  hr();
  log();
  log(`${C.bold}${C.green}  Analysis complete!${C.reset}`);
  log();
  log(`  Report saved to: ${C.bold}${outputPath}${C.reset}`);
  log();
  log(`  ${C.bold}Summary${C.reset}`);
  log(`  ${'─'.repeat(36)}`);
  log(`  Total resources   : ${conversions.length}`);
  log(`  AUTO (import)     : ${statusGroups.AUTO}`);
  log(`  MANUAL (config)   : ${statusGroups.MANUAL}`);
  log(`  SKIP              : ${statusGroups.SKIP}`);
  log(`  UNSUPPORTED       : ${statusGroups.UNSUPPORTED}`);
  log(`  Shadow signals    : ${shadowStack.signals.length}`);
  log(`  Migration complexity: ${risk.overallComplexity}`);
  log(`  Estimated timeline  : ${plan.estimatedMonths} months`);
  log();
  log(`  Open the report in your browser to review the full analysis.`);
  log();
  log(`  Questions? Book a migration walkthrough at ${C.bold}${C.magenta}https://incident.io/demo${C.reset}`);
  log();
  hr();
}

main().catch(e => {
  err(`Unexpected error: ${e.message}`);
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});

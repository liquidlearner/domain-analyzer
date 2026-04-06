'use strict';
// ============================================================================
//  PagerDuty → incident.io Migration Assessment Deck Generator
//  Reads a pd-analyzer JSON output and produces a 10-slide .pptx
//  "Midnight Executive" palette: Navy 1E2761 · Ice Blue CADCFC · Orange FF4D00
// ============================================================================

const PptxGenJS = require('pptxgenjs');
const fs = require('fs');
const path = require('path');

// ── Input / Output ───────────────────────────────────────────────────────────
const jsonPath = process.argv[2] || '/tmp/v2-fixed.json';
const outPath  = process.argv[3] || '/sessions/laughing-adoring-maxwell/mnt/domain-analyzer/orbitpay-migration-assessment.pptx';

const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

// ── Colour constants (no # prefix) ──────────────────────────────────────────
const NAVY   = '1E2761';
const ICE    = 'CADCFC';
const ORANGE = 'FF4D00';
const WHITE  = 'FFFFFF';
const GREY   = 'F4F5F7';
const MID    = '64748B';
const DARK   = '1E293B';
const GREEN  = '059669';
const LGREY  = 'E2E8F0';

// ── Data extraction ──────────────────────────────────────────────────────────
const meta     = raw.meta     || {};
const account  = raw.account  || {};
const services = raw.services || {};
const users    = raw.users    || {};
const teams    = raw.teams    || {};
const scheds   = raw.schedules || {};
const eps      = raw.escalation_policies || {};
const iwfs     = raw.incident_workflows || {};
const eos      = raw.event_orchestrations || {};
const agg      = raw.alert_grouping_settings || {};
const ss       = raw.shadow_stack || {};
const auto     = raw.automation || {};
const webhooks = raw.webhooks || {};
const statpg   = raw.status_pages || {};
const sp       = raw.service_event_rules || {};
const tags     = raw.tags || {};

const domain      = meta.subdomain || 'Customer';
const daysAnalyzed = meta.days_analyzed || 90;
const planName    = (account.licenses || [])[0]?.name || 'Enterprise';
const seatCount   = (account.licenses || [])[0]?.current_value || users.total || 0;
const today       = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });

const activeServices = services.active_last_n_days || 0;
const staleServices  = services.stale_last_n_days  || 0;
const totalServices  = services.total || 0;
const totalTeams     = teams.total || 0;
const totalUsers     = users.total || 0;
const totalScheds    = scheds.total || 0;
const totalEps       = eps.total || 0;
const totalIwfs      = iwfs.total || 0;
const totalEos       = eos.total || 0;
const totalAuto      = auto.actions_total || 0;

const snMode         = (ss.servicenow || {}).mode || 'none';
const snDetected     = (ss.servicenow || {}).detected === true;
const snWorkflows    = (ss.servicenow || {}).workflow_names || [];
const snWebhookCount = (ss.servicenow || {}).webhook_count || 0;
const complexWfs     = ss.complex_workflows || [];
const unknownWebhooks = ss.unknown_webhook_destinations || [];
const unknownCount   = unknownWebhooks.length;
const unknownUrl     = unknownWebhooks[0]?.url || '';
const collab         = ss.collaboration || {};
const lcrDetected    = ss.live_call_routing === true;
const publicPages    = statpg.public_total || 0;
const internalPages  = statpg.internal_total || 0;

const activeByTeam    = services.active_by_team || [];
const teamsWithActive = activeByTeam.filter(t => t.active > 0);
const top10Teams      = teamsWithActive.slice(0, 10);

// ── Sprint plan for this account ─────────────────────────────────────────────
// Base: 268 active services → 151-300 bracket → 9 base sprints
// +1 ServiceNow (workflow_driven)
// +1 Complex workflows (2 workflows @ 10+ steps → 1 sprint per 2)
// +2 Automation (14 actions, 11+ = +2)
// +1 Unknown webhooks (112 = definitely +1 sprint)
// Total: 9+5 = 14 sprints, but we combine some for clean narrative: ~11 sequential
// Timeline: 1 week (Sp0) + 10 × 3 weeks = 31 weeks ≈ 7.5 months standard
// Parallel: compressible to ~22 weeks ≈ 5.5 months

const sprintPlan = [
  { label: 'Sprint 0',  dur: '1 week',   theme: 'Foundation & Discovery',       activity: 'Provision incident.io · SSO/SCIM · Terraform · Investigate eventsender webhook · Confirm SN approach',                    milestone: 'incident.io environment live; sprint plan locked' },
  { label: 'Sprint 1',  dur: '3 weeks',  theme: 'Pilot Wave (3 teams)',          activity: 'Migrate Release Eng, Business Ops, Quality Eng · Validate alert-to-resolution flow · Begin dual-run',                      milestone: 'First 22 services live on incident.io · dual-run stable' },
  { label: 'Sprint 2',  dur: '3 weeks',  theme: 'Wave 1 (~10 teams)',            activity: 'Simplest teams with no SN dependency · On-call schedule migration · Training sessions',                                    milestone: '~12 teams on incident.io (~60 active services)' },
  { label: 'Sprint 3',  dur: '3 weeks',  theme: 'ServiceNow Integration',        activity: 'Migrate "ServiceNOW INC for P1 and P2" workflow → incident.io Workflow + native SN integration · Bidirectional sync test', milestone: 'ServiceNow P1/P2 sync validated; SN-dependent teams now safe to migrate' },
  { label: 'Sprint 4',  dur: '3 weeks',  theme: 'Wave 2 (~12 teams)',            activity: 'Mid-complexity teams including Risk & Compliance · SN-dependent teams now migrating',                                      milestone: '~24 teams on incident.io (~120 active services)' },
  { label: 'Sprint 5',  dur: '3 weeks',  theme: 'Major Incident Process',        activity: 'Rebuild "Declare Major Incident" (15 steps) and ops-srmr (14 steps) · Incident commander sign-off',                       milestone: 'P1/P2 declaration flow live on incident.io; commanders approved' },
  { label: 'Sprint 6',  dur: '3 weeks',  theme: 'Wave 3 (~13 teams)',            activity: 'Data & Analytics (20 svc) · Developer Platform (16 svc) · Complex high-volume teams',                                     milestone: '~37 teams on incident.io (~190 active services)' },
  { label: 'Sprint 7',  dur: '3 weeks',  theme: 'Automation Runbooks (14)',      activity: 'Map 14 PD Automation Actions → incident.io Runbooks · 10 process automation · 4 script actions',                          milestone: 'Runbook library live; automation coverage matches PD baseline' },
  { label: 'Sprint 8',  dur: '3 weeks',  theme: 'Wave 4 (~13 teams)',            activity: 'Core Infrastructure (14 svc) · Customer Experience (12 svc) · Identity & Access (11 svc)',                                milestone: '~50 teams on incident.io (~250 active services)' },
  { label: 'Sprint 9',  dur: '3 weeks',  theme: 'Wave 5 + Unknown Webhook Cleanup', activity: 'Remaining 11 active teams · Validate/retire eventsender.herokuapp.com integration (112 subscriptions)',               milestone: 'All 61 active teams migrated; shadow integration resolved' },
  { label: 'Sprint 10', dur: '3 weeks',  theme: 'Cutover',                       activity: 'Full regression test · Cutover gate decision · PD routing disabled · Hypercare begins (2 weeks)',                         milestone: 'incident.io is the primary platform. PagerDuty routing disabled.' },
];

// ── Build presentation ───────────────────────────────────────────────────────
const pres = new PptxGenJS();
pres.layout = 'LAYOUT_16x9';
pres.author = 'incident.io Solutions Engineering';
pres.title  = `${domain} — PD Migration Assessment`;

// Helper: navy bar at top of content slides (4px)
function addTopBar(slide) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.08,
    fill: { color: ORANGE },
    line: { color: ORANGE, width: 0 },
  });
}

function addSlideNumber(slide, n) {
  slide.addText(String(n), {
    x: 9.5, y: 5.35, w: 0.45, h: 0.25,
    fontSize: 9, color: MID, align: 'right',
  });
}

// ── SLIDE 1 — Title (dark navy) ───────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: NAVY };

  // incident.io logo block (orange rectangle + text)
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.45, y: 0.35, w: 0.08, h: 0.4,
    fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
  });
  s.addText('incident.io', {
    x: 0.62, y: 0.35, w: 3, h: 0.4,
    fontSize: 16, color: WHITE, bold: true, valign: 'middle', margin: 0,
  });

  // Main title block — centred
  s.addText('PagerDuty → incident.io', {
    x: 1, y: 1.6, w: 8, h: 0.9,
    fontSize: 38, color: WHITE, bold: true, align: 'center',
  });
  s.addText('Migration Assessment', {
    x: 1, y: 2.45, w: 8, h: 0.7,
    fontSize: 32, color: ICE, bold: true, align: 'center',
  });

  // Domain / customer name
  s.addShape(pres.shapes.RECTANGLE, {
    x: 3.5, y: 3.3, w: 3, h: 0.06,
    fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
  });
  s.addText(domain.toUpperCase(), {
    x: 1, y: 3.45, w: 8, h: 0.45,
    fontSize: 16, color: ICE, align: 'center', charSpacing: 4,
  });

  // Footer
  s.addText(`Prepared by incident.io Solutions Engineering  ·  ${today}`, {
    x: 1, y: 5.1, w: 8, h: 0.3,
    fontSize: 10, color: '8899BB', align: 'center',
  });
}

// ── SLIDE 2 — Environment at a Glance ────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  addTopBar(s);

  // Header
  s.addText('Environment at a Glance', {
    x: 0.4, y: 0.18, w: 7, h: 0.5,
    fontSize: 24, color: NAVY, bold: true, margin: 0,
  });
  s.addText(`${domain}  ·  ${daysAnalyzed}-day analysis window`, {
    x: 0.4, y: 0.65, w: 7, h: 0.3,
    fontSize: 12, color: MID, margin: 0,
  });

  // 6 stat callouts: 3 top (large), 3 bottom (smaller)
  const statW = 2.8;
  const statH = 1.15;

  function addStat(slide, x, y, value, label, sub, accentColor) {
    // Background card
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: statW, h: statH,
      fill: { color: GREY },
      line: { color: LGREY, width: 1 },
      shadow: { type: 'outer', color: '000000', blur: 4, offset: 2, angle: 135, opacity: 0.06 },
    });
    // Accent left border
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 0.06, h: statH,
      fill: { color: accentColor || NAVY },
      line: { color: accentColor || NAVY, width: 0 },
    });
    // Value
    slide.addText(String(value), {
      x: x + 0.15, y: y + 0.1, w: statW - 0.2, h: 0.6,
      fontSize: 36, color: accentColor || NAVY, bold: true, margin: 0,
    });
    // Label
    slide.addText(label, {
      x: x + 0.15, y: y + 0.68, w: statW - 0.2, h: 0.28,
      fontSize: 12, color: DARK, bold: false, margin: 0,
    });
    if (sub) {
      slide.addText(sub, {
        x: x + 0.15, y: y + 0.92, w: statW - 0.2, h: 0.18,
        fontSize: 9, color: MID, margin: 0,
      });
    }
  }

  // Row 1 — big 3
  addStat(s, 0.35, 1.08, totalServices.toLocaleString(), 'Total Services',    null,                    NAVY);
  addStat(s, 3.35, 1.08, totalUsers.toLocaleString(),    'Total Users',       `${seatCount} licensed seats`, ORANGE);
  addStat(s, 6.35, 1.08, totalTeams.toLocaleString(),    'Teams',             null,                    NAVY);

  // Row 2 — supporting 3 (slightly smaller)
  const r2y = 2.45;
  addStat(s, 0.35, r2y, totalScheds.toLocaleString(),  'On-Call Schedules',     null, MID);
  addStat(s, 3.35, r2y, totalEps.toLocaleString(),     'Escalation Policies',   null, MID);
  addStat(s, 6.35, r2y, totalIwfs.toLocaleString(),    'Incident Workflows',    null, MID);

  // Side info box (right — plan/priorities)
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.35, y: 3.75, w: 9.3, h: 1.6,
    fill: { color: NAVY }, line: { color: NAVY, width: 0 },
  });
  const priorities = (account.priorities || []).map(p => p.name).join(' · ') || 'P1 · P2 · P3 · P4 · P5';
  s.addText([
    { text: 'Plan: ', options: { bold: false, color: ICE } },
    { text: planName, options: { bold: true, color: WHITE } },
    { text: '    |    Priorities: ', options: { bold: false, color: ICE } },
    { text: priorities, options: { bold: true, color: WHITE } },
    { text: '    |    Event Orchestrations: ', options: { bold: false, color: ICE } },
    { text: String(totalEos), options: { bold: true, color: ORANGE } },
    { text: '    |    AIOps Alert Grouping: ', options: { bold: false, color: ICE } },
    { text: `${agg.total || 0} services`, options: { bold: true, color: ORANGE } },
  ], {
    x: 0.55, y: 3.9, w: 8.9, h: 0.45, fontSize: 12,
  });
  s.addText('Next slide shows the real migration scope — active vs. stale services.', {
    x: 0.55, y: 4.4, w: 8.9, h: 0.35,
    fontSize: 11, color: ICE, italic: true, margin: 0,
  });

  addSlideNumber(s, 2);
}

// ── SLIDE 3 — Real Migration Scope (key reframe) ──────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  addTopBar(s);

  s.addText('The Real Migration Scope', {
    x: 0.4, y: 0.18, w: 9, h: 0.5,
    fontSize: 24, color: NAVY, bold: true, margin: 0,
  });
  s.addText(`Services with incidents in the last ${daysAnalyzed} days vs. dormant services`, {
    x: 0.4, y: 0.65, w: 9, h: 0.28,
    fontSize: 12, color: MID, margin: 0,
  });

  // Left column: Active (navy/orange)
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.35, y: 1.05, w: 4.4, h: 3.4,
    fill: { color: NAVY }, line: { color: NAVY, width: 0 },
  });
  s.addText('ACTIVE SERVICES', {
    x: 0.55, y: 1.2, w: 4, h: 0.35,
    fontSize: 11, color: ICE, bold: true, charSpacing: 2, margin: 0,
  });
  s.addText(String(activeServices), {
    x: 0.55, y: 1.52, w: 4, h: 1.1,
    fontSize: 72, color: ORANGE, bold: true, margin: 0,
  });
  s.addText(`Services with incidents in the last ${daysAnalyzed} days`, {
    x: 0.55, y: 2.65, w: 3.9, h: 0.38,
    fontSize: 12, color: ICE, margin: 0,
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.55, y: 3.12, w: 3.9, h: 0.04,
    fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
  });
  s.addText('→  These migrate to incident.io', {
    x: 0.55, y: 3.2, w: 3.9, h: 0.45,
    fontSize: 13, color: WHITE, bold: true, margin: 0,
  });
  s.addText(`Across ${teamsWithActive.length} active teams`, {
    x: 0.55, y: 3.7, w: 3.9, h: 0.3,
    fontSize: 11, color: ICE, margin: 0,
  });

  // Right column: Stale (light grey)
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.25, y: 1.05, w: 4.4, h: 3.4,
    fill: { color: GREY }, line: { color: LGREY, width: 1 },
  });
  s.addText('STALE SERVICES', {
    x: 5.45, y: 1.2, w: 4, h: 0.35,
    fontSize: 11, color: MID, bold: true, charSpacing: 2, margin: 0,
  });
  s.addText(String(staleServices), {
    x: 5.45, y: 1.52, w: 4, h: 1.1,
    fontSize: 72, color: MID, bold: true, margin: 0,
  });
  s.addText(`No incidents in ${daysAnalyzed} days`, {
    x: 5.45, y: 2.65, w: 3.9, h: 0.38,
    fontSize: 12, color: MID, margin: 0,
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.45, y: 3.12, w: 3.9, h: 0.04,
    fill: { color: LGREY }, line: { color: LGREY, width: 0 },
  });
  s.addText('→  Archive or decommission', {
    x: 5.45, y: 3.2, w: 3.9, h: 0.45,
    fontSize: 13, color: DARK, bold: true, margin: 0,
  });

  const stalePercent = Math.round((staleServices / totalServices) * 100);
  s.addText(`${stalePercent}% of total services are stale — significant scope reduction`, {
    x: 5.45, y: 3.7, w: 3.9, h: 0.3,
    fontSize: 11, color: MID, italic: true, margin: 0,
  });

  // Bottom summary bar
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.35, y: 4.6, w: 9.3, h: 0.72,
    fill: { color: ICE }, line: { color: ICE, width: 0 },
  });
  s.addText([
    { text: 'Real migration scope: ', options: { color: NAVY, bold: false } },
    { text: `${activeServices} active services`, options: { color: NAVY, bold: true } },
    { text: ` across `, options: { color: NAVY, bold: false } },
    { text: `${teamsWithActive.length} teams`, options: { color: NAVY, bold: true } },
    { text: `  —  the other ${staleServices} services are candidates for decommission`, options: { color: MID, bold: false, italic: true } },
  ], { x: 0.55, y: 4.72, w: 9, h: 0.48, fontSize: 13 });

  addSlideNumber(s, 3);
}

// ── SLIDE 4 — Team Breakdown ───────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  addTopBar(s);

  s.addText('Team Breakdown', {
    x: 0.4, y: 0.18, w: 9, h: 0.5,
    fontSize: 24, color: NAVY, bold: true, margin: 0,
  });
  s.addText('Teams are the migration unit — each wave migrates 10–20 teams together', {
    x: 0.4, y: 0.65, w: 9, h: 0.28,
    fontSize: 12, color: MID, margin: 0,
  });

  // Left stat column
  const avgActive = teamsWithActive.length > 0
    ? (activeServices / teamsWithActive.length).toFixed(1)
    : '—';

  const leftStats = [
    { label: 'Total teams', value: String(totalTeams) },
    { label: 'Teams with active services', value: String(teamsWithActive.length) },
    { label: 'Avg active services / team', value: avgActive },
  ];

  leftStats.forEach((st, i) => {
    const y = 1.1 + i * 1.05;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.35, y, w: 2.6, h: 0.85,
      fill: { color: GREY }, line: { color: LGREY, width: 1 },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.35, y, w: 0.06, h: 0.85,
      fill: { color: NAVY }, line: { color: NAVY, width: 0 },
    });
    s.addText(st.value, {
      x: 0.55, y: y + 0.04, w: 2.3, h: 0.42,
      fontSize: 28, color: NAVY, bold: true, margin: 0,
    });
    s.addText(st.label, {
      x: 0.55, y: y + 0.46, w: 2.3, h: 0.3,
      fontSize: 11, color: DARK, margin: 0,
    });
  });

  // Right — Top 10 teams table
  const tableData = [
    [
      { text: 'Team', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Active', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'center' } },
      { text: 'Stale', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'center' } },
    ],
    ...top10Teams.map((t, i) => [
      { text: t.team, options: { color: DARK, fill: { color: i % 2 === 0 ? WHITE : GREY } } },
      { text: String(t.active), options: { color: ORANGE, bold: true, align: 'center', fill: { color: i % 2 === 0 ? WHITE : GREY } } },
      { text: String(t.stale || 0), options: { color: MID, align: 'center', fill: { color: i % 2 === 0 ? WHITE : GREY } } },
    ]),
  ];

  s.addTable(tableData, {
    x: 3.2, y: 1.05, w: 6.5, colW: [4.2, 1.15, 1.15],
    rowH: 0.38, border: { pt: 0.5, color: LGREY },
    fontSize: 12,
  });

  // Footer note
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.35, y: 4.6, w: 9.3, h: 0.65,
    fill: { color: ICE }, line: { color: ICE, width: 0 },
  });
  s.addText([
    { text: 'Wave planning starts with the simplest teams first.  ', options: { color: NAVY } },
    { text: 'Recommended pilot: Release Engineering + Business Ops — fewest dependencies, cleanest config.', options: { color: NAVY, italic: true } },
  ], { x: 0.55, y: 4.72, w: 9, h: 0.42, fontSize: 11 });

  addSlideNumber(s, 4);
}

// ── SLIDE 5 — Shadow Stack & Integration Risk ──────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  addTopBar(s);

  s.addText('Shadow Stack & Integration Risk', {
    x: 0.4, y: 0.18, w: 9, h: 0.5,
    fontSize: 24, color: NAVY, bold: true, margin: 0,
  });
  s.addText('Integrations and workflows outside the core migration path that need dedicated attention', {
    x: 0.4, y: 0.65, w: 9, h: 0.28,
    fontSize: 12, color: MID, margin: 0,
  });

  const snDesc = snMode === 'workflow_driven'
    ? `Workflow-driven (${snWorkflows[0] || 'P1/P2 only'}) — migrates as incident.io Workflow action · Easier than it looks`
    : snMode === 'native'
    ? `Native PD↔SN extension — migrates via incident.io native ServiceNow integration`
    : snMode === 'webhook_only'
    ? `Webhook-based (${snWebhookCount} subscriptions) — replace with incident.io Workflow actions`
    : '✓ Not detected';

  const rows = [
    {
      icon: '⚙',
      label: 'ServiceNow',
      badge: snDetected ? `${snWebhookCount} webhooks` : 'Not detected',
      desc: snDesc,
      risk: snDetected,
    },
    {
      icon: '⚡',
      label: 'Complex Incident Workflows',
      badge: complexWfs.length > 0 ? `${complexWfs.length} workflows (10+ steps)` : 'None detected',
      desc: complexWfs.length > 0
        ? `"${complexWfs[0]?.name}" (${complexWfs[0]?.step_count} steps) · "${complexWfs[1]?.name}" (${complexWfs[1]?.step_count} steps) — dedicated sprint to rebuild`
        : '✓ No complex workflows detected',
      risk: complexWfs.length > 0,
    },
    {
      icon: '🔗',
      label: 'Unknown Webhook Destinations',
      badge: unknownCount > 0 ? `${unknownCount} subscriptions` : 'None',
      desc: unknownCount > 0
        ? `${unknownCount} webhooks → eventsender-f81fbd33135c.herokuapp.com · Investigate in Sprint 0 before committing final sprint plan`
        : '✓ All webhook destinations are known',
      risk: unknownCount > 0,
    },
    {
      icon: '🤖',
      label: 'Automation Actions',
      badge: totalAuto > 0 ? `${totalAuto} actions` : 'None',
      desc: totalAuto > 0
        ? `${totalAuto} automation actions (${auto.by_type?.process_automation || 0} process + ${auto.by_type?.script || 0} script) → migrate to incident.io Runbooks (+2 sprints)`
        : '✓ No automation actions',
      risk: totalAuto > 0,
    },
    {
      icon: '💬',
      label: 'Collaboration Tools',
      badge: [collab.slack && 'Slack', collab.microsoft_teams && 'Teams', collab.zoom && 'Zoom'].filter(Boolean).join(' · ') || 'None detected',
      desc: '✓ incident.io has native first-class integrations for Slack, Microsoft Teams, and Zoom — no webhook adapters needed',
      risk: false,
    },
    {
      icon: '📄',
      label: 'Status Pages',
      badge: publicPages > 0 ? `${publicPages} public · ${internalPages} internal` : internalPages > 0 ? `${internalPages} internal dashboards` : 'None',
      desc: publicPages > 0
        ? `${publicPages} public status pages → migrate to incident.io Status Pages (+1 sprint for subscriber lists)`
        : internalPages > 0
        ? `${internalPages} internal status dashboards only — no subscriber migration needed · incident.io Status Pages covers these`
        : '✓ No public status pages',
      risk: publicPages > 0,
    },
    {
      icon: '📞',
      label: 'Live Call Routing',
      badge: lcrDetected ? 'Detected' : 'Not detected',
      desc: lcrDetected
        ? 'Live Call Routing detected — no direct equivalent in incident.io; discuss alternative approach'
        : '✓ Not detected — no migration blocker',
      risk: lcrDetected,
    },
  ];

  const rowH = 0.59;
  const startY = 1.0;

  rows.forEach((row, i) => {
    const y = startY + i * rowH;
    const color = row.risk ? ORANGE : GREEN;

    // Left accent bar
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.35, y, w: 0.06, h: rowH - 0.04,
      fill: { color }, line: { color, width: 0 },
    });

    // Row background
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.41, y, w: 9.24, h: rowH - 0.04,
      fill: { color: i % 2 === 0 ? WHITE : GREY },
      line: { color: LGREY, width: 0.5 },
    });

    // Label
    s.addText(`${row.icon}  ${row.label}`, {
      x: 0.55, y: y + 0.04, w: 2.2, h: rowH - 0.12,
      fontSize: 12, color: DARK, bold: true, valign: 'middle', margin: 0,
    });

    // Badge
    s.addShape(pres.shapes.RECTANGLE, {
      x: 2.85, y: y + 0.1, w: 2.0, h: 0.35,
      fill: { color: row.risk ? 'FFF3ED' : 'ECFDF5' },
      line: { color: row.risk ? ORANGE : GREEN, width: 1 },
    });
    s.addText(row.badge, {
      x: 2.85, y: y + 0.1, w: 2.0, h: 0.35,
      fontSize: 10, color: row.risk ? ORANGE : GREEN, bold: true, align: 'center', valign: 'middle', margin: 0,
    });

    // Description
    s.addText(row.desc, {
      x: 5.05, y: y + 0.04, w: 4.55, h: rowH - 0.12,
      fontSize: 10, color: DARK, valign: 'middle', margin: 0,
    });
  });

  addSlideNumber(s, 5);
}

// ── SLIDE 6 — Sprint Plan ─────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  addTopBar(s);

  s.addText('Recommended Sprint Plan', {
    x: 0.4, y: 0.18, w: 9, h: 0.5,
    fontSize: 24, color: NAVY, bold: true, margin: 0,
  });
  s.addText(`Based on ${activeServices} active services · ${teamsWithActive.length} active teams · ServiceNow (workflow-driven) · ${complexWfs.length} complex workflows · ${totalAuto} automation actions`, {
    x: 0.4, y: 0.65, w: 9.2, h: 0.28,
    fontSize: 10, color: MID, margin: 0,
  });

  // Sprint theme colors
  const themeColors = {
    'Foundation': LGREY,
    'Pilot': ICE,
    'Wave': NAVY,
    'ServiceNow': ORANGE,
    'Major': ORANGE,
    'Automation': ORANGE,
    'Unknown': ORANGE,
    'Cutover': '064E3B',
  };

  function sprintColor(theme) {
    for (const [k, c] of Object.entries(themeColors)) {
      if (theme.includes(k)) return c;
    }
    return NAVY;
  }

  const tableData = [
    // Header
    [
      { text: 'Sprint', options: { bold: true, color: WHITE, fill: { color: DARK }, align: 'center' } },
      { text: 'Duration', options: { bold: true, color: WHITE, fill: { color: DARK }, align: 'center' } },
      { text: 'Theme', options: { bold: true, color: WHITE, fill: { color: DARK } } },
      { text: 'End Milestone', options: { bold: true, color: WHITE, fill: { color: DARK } } },
    ],
    // Data rows
    ...sprintPlan.map((sp, i) => {
      const bg = i === 0 ? LGREY : i === sprintPlan.length - 1 ? '064E3B' : (i % 2 === 0 ? WHITE : GREY);
      const tc = i === sprintPlan.length - 1 ? WHITE : DARK;
      const themeC = i === 0 ? MID : sprintColor(sp.theme);
      const themeTextC = ['LGREY', ICE, WHITE, GREY].includes(themeC) || themeC === LGREY || themeC === ICE ? DARK : WHITE;
      return [
        { text: sp.label, options: { color: DARK, bold: true, align: 'center', fill: { color: bg } } },
        { text: sp.dur, options: { color: MID, align: 'center', fill: { color: bg } } },
        { text: sp.theme, options: { color: tc, bold: true, fill: { color: bg } } },
        { text: sp.milestone, options: { color: tc, fill: { color: bg }, fontSize: 9 } },
      ];
    }),
  ];

  s.addTable(tableData, {
    x: 0.35, y: 1.0, w: 9.3, colW: [0.8, 0.85, 2.65, 5.0],
    rowH: 0.34, border: { pt: 0.5, color: LGREY },
    fontSize: 10,
  });

  // Summary box
  const summaryY = 1.0 + (sprintPlan.length + 1) * 0.34 + 0.1;
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.35, y: summaryY, w: 9.3, h: 0.55,
    fill: { color: ICE }, line: { color: ICE, width: 0 },
  });
  s.addText([
    { text: 'Standard timeline: ', options: { color: NAVY } },
    { text: '11 sprints  (31 weeks ≈ 7.5 months)', options: { color: NAVY, bold: true } },
    { text: '    |    With parallel waves: ', options: { color: NAVY } },
    { text: '22–25 weeks ≈ 5–6 months', options: { color: ORANGE, bold: true } },
    { text: '  (confirmed in Sprint 0)', options: { color: MID, italic: true } },
  ], { x: 0.55, y: summaryY + 0.08, w: 9, h: 0.4, fontSize: 11 });

  addSlideNumber(s, 6);
}

// ── SLIDE 7 — What's Easy & What Needs Discussion ─────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  addTopBar(s);

  s.addText("What's Easy & What Needs Discussion", {
    x: 0.4, y: 0.18, w: 9, h: 0.5,
    fontSize: 24, color: NAVY, bold: true, margin: 0,
  });

  // LEFT: Easy column
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.35, y: 0.75, w: 4.55, h: 0.42,
    fill: { color: GREEN }, line: { color: GREEN, width: 0 },
  });
  s.addText('✓  What migrates quickly', {
    x: 0.35, y: 0.75, w: 4.55, h: 0.42,
    fontSize: 14, color: WHITE, bold: true, valign: 'middle', margin: 8,
  });

  const easyItems = [
    { h: 'Events API v2 integrations', d: 'Clean, modern alert source → direct incident.io connection. No webhook adapter needed.' },
    { h: 'Slack · Teams · Zoom', d: 'incident.io has native first-class integrations for all three — PD webhook adapters replaced automatically.' },
    { h: 'No Live Call Routing', d: 'No migration blocker. LCR has no direct equivalent and would need alternative planning — but it\'s not here.' },
    { h: `${totalEos} Event Orchestrations`, d: 'incident.io Alert Routes are a direct equivalent. Routing logic maps cleanly.' },
    { h: 'P1–P5 priority model', d: 'Severity definitions map directly to incident.io Severity levels. No redesign needed.' },
  ];

  easyItems.forEach((item, i) => {
    const y = 1.28 + i * 0.72;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.35, y, w: 4.55, h: 0.65,
      fill: { color: i % 2 === 0 ? 'F0FDF4' : WHITE },
      line: { color: 'BBF7D0', width: 0.5 },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.35, y, w: 0.06, h: 0.65,
      fill: { color: GREEN }, line: { color: GREEN, width: 0 },
    });
    s.addText(item.h, {
      x: 0.5, y: y + 0.04, w: 4.2, h: 0.25,
      fontSize: 12, color: DARK, bold: true, margin: 0,
    });
    s.addText(item.d, {
      x: 0.5, y: y + 0.3, w: 4.2, h: 0.3,
      fontSize: 10, color: MID, margin: 0,
    });
  });

  // RIGHT: Needs discussion column
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.1, y: 0.75, w: 4.55, h: 0.42,
    fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
  });
  s.addText('⚑  What needs a conversation', {
    x: 5.1, y: 0.75, w: 4.55, h: 0.42,
    fontSize: 14, color: WHITE, bold: true, valign: 'middle', margin: 8,
  });

  const discussItems = [
    { h: `${unknownCount} unknown webhook subscriptions`, d: `${unknownCount} webhooks → eventsender.herokuapp.com. Live integration or legacy? Investigate in Sprint 0 before locking the plan.` },
    { h: '"Declare Major Incident" workflows (×2)', d: '15-step and 14-step workflows. Walk through step by step with incident commanders before rebuilding.' },
    { h: `ServiceNow · ${snWebhookCount} subscriptions`, d: '"ServiceNOW INC for P1 and P2" — workflow-driven (easier than it looks), but SN-dependent teams migrate after Sprint 3.' },
    { h: `${totalAuto} Automation Actions → Runbooks`, d: '10 process automation + 4 script actions. Runbook runner infrastructure needs to be confirmed before Sprint 7.' },
    { h: `${agg.total || 0} intelligent alert grouping settings`, d: 'Are engineers actively relying on ML grouping, or is it default-on? Validates AIOps usage depth for incident.io roadmap.' },
  ];

  discussItems.forEach((item, i) => {
    const y = 1.28 + i * 0.72;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 5.1, y, w: 4.55, h: 0.65,
      fill: { color: i % 2 === 0 ? 'FFF7ED' : WHITE },
      line: { color: 'FED7AA', width: 0.5 },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 5.1, y, w: 0.06, h: 0.65,
      fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
    });
    s.addText(item.h, {
      x: 5.25, y: y + 0.04, w: 4.2, h: 0.25,
      fontSize: 12, color: DARK, bold: true, margin: 0,
    });
    s.addText(item.d, {
      x: 5.25, y: y + 0.3, w: 4.2, h: 0.3,
      fontSize: 10, color: MID, margin: 0,
    });
  });

  addSlideNumber(s, 7);
}

// ── SLIDE 8 — Discovery Questions ─────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  addTopBar(s);

  s.addText('Discovery Questions', {
    x: 0.4, y: 0.18, w: 9, h: 0.5,
    fontSize: 24, color: NAVY, bold: true, margin: 0,
  });
  s.addText('Tailored to this environment — use as a call guide. Check off as you cover them.', {
    x: 0.4, y: 0.65, w: 9, h: 0.28,
    fontSize: 12, color: MID, margin: 0,
  });

  const questions = [
    {
      n: '1',
      q: '"What happens if PagerDuty goes down for 4 hours?"',
      why: 'Reveals shadow dependencies and undocumented backup processes. Always surprises.',
    },
    {
      n: '2',
      q: `"Of your ${totalServices} services, how many actually page your engineers week-to-week?"`,
      why: `Validates the ${activeServices} active count and surfaces any services the data misses.`,
    },
    {
      n: '3',
      q: '"Which teams are most excited about the change?"',
      why: 'Identifies your pilot wave champion. The right first team makes everything easier.',
    },
    {
      n: '4',
      q: '"Is your PD contract up for renewal in the next 12 months?"',
      why: 'A contract deadline is your best forcing function for timeline compression.',
    },
    {
      n: '5',
      q: '"Who owns the ServiceNow integration — your PD admin or the ITSM team?"',
      why: 'The right stakeholder for Sprint 3. Wrong person in the room = blocked integration sprint.',
    },
    {
      n: '6',
      q: '"Which incidents create a ServiceNow ticket — all of them, or just P1/P2?"',
      why: `You have ${snWebhookCount} SN webhook subscriptions. The "P1 and P2 only" workflow suggests scoped use — confirm before migration.`,
    },
    {
      n: '7',
      q: '"Can we walk through the \'Declare Major Incident\' flow step by step together?"',
      why: 'This is your most important process rebuild. Uncovers hidden dependencies in a 15-step workflow.',
    },
    {
      n: '8',
      q: `"What's hitting ${unknownUrl.substring(0, 45)}...? Is that a live integration?"`,
      why: `${unknownCount} webhook subscriptions go to an unidentified Heroku endpoint. Live or legacy? Critical for Sprint 0.`,
    },
  ];

  const colW  = 4.5;
  const rowH  = 0.85;
  const startX = [0.35, 5.1];
  const startY = 1.02;

  questions.forEach((q, i) => {
    const col = i < 4 ? 0 : 1;
    const row = i % 4;
    const x = startX[col];
    const y = startY + row * rowH;

    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: colW, h: rowH - 0.06,
      fill: { color: row % 2 === 0 ? WHITE : GREY },
      line: { color: LGREY, width: 0.5 },
    });

    // Number badge
    s.addShape(pres.shapes.RECTANGLE, {
      x: x + 0.08, y: y + 0.08, w: 0.28, h: 0.28,
      fill: { color: NAVY }, line: { color: NAVY, width: 0 },
    });
    s.addText(q.n, {
      x: x + 0.08, y: y + 0.08, w: 0.28, h: 0.28,
      fontSize: 11, color: WHITE, bold: true, align: 'center', valign: 'middle', margin: 0,
    });

    s.addText(q.q, {
      x: x + 0.44, y: y + 0.06, w: colW - 0.52, h: 0.35,
      fontSize: 11, color: DARK, bold: true, margin: 0,
    });
    s.addText(q.why, {
      x: x + 0.44, y: y + 0.44, w: colW - 0.52, h: 0.3,
      fontSize: 9.5, color: MID, margin: 0,
    });
  });

  addSlideNumber(s, 8);
}

// ── SLIDE 9 — Why incident.io ─────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  addTopBar(s);

  s.addText('Why incident.io', {
    x: 0.4, y: 0.18, w: 9, h: 0.5,
    fontSize: 24, color: NAVY, bold: true, margin: 0,
  });
  s.addText('Built for this — from the first page to the post-incident review', {
    x: 0.4, y: 0.65, w: 9, h: 0.28,
    fontSize: 12, color: MID, italic: true, margin: 0,
  });

  const reasons = [
    {
      icon: '🤖',
      title: 'AI SRE Agent — built in',
      body: 'Automatically reduces noise during major incidents, suggests runbooks, and captures actions — no separate product to buy.',
    },
    {
      icon: '⚡',
      title: 'Native Slack + Teams + Zoom',
      body: `You're already on all three. incident.io treats these as first-class citizens — not webhook adapters bolted on.`,
    },
    {
      icon: '🔧',
      title: 'Flexible Workflow Engine',
      body: `Your 2 complex "Declare Major Incident" flows (15 and 14 steps) rebuild cleanly. Conditions, branching, and multi-step automation are native.`,
    },
    {
      icon: '📊',
      title: 'Status Pages included',
      body: `4 internal status dashboards migrate to incident.io Status Pages at no extra cost. PagerDuty charges premium for status page add-ons.`,
    },
    {
      icon: '📋',
      title: 'Runbooks replace Automation Actions',
      body: `Your ${totalAuto} PD Automation Actions migrate to incident.io Runbooks — same functionality, tighter incident integration.`,
    },
    {
      icon: '🏁',
      title: 'Migrations complete faster than you expect',
      body: '7shifts: 2 weeks (70 engineers). Trustly: 6 weeks (200 users, deadline-driven). When there\'s a contract date, teams find a way.',
    },
  ];

  const boxW = 2.9;
  const boxH = 1.3;
  const cols = [0.35, 3.55, 6.75];
  const rows = [1.05, 2.55];

  reasons.forEach((r, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = cols[col];
    const y = rows[row];

    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: boxW, h: boxH,
      fill: { color: GREY },
      line: { color: LGREY, width: 1 },
      shadow: { type: 'outer', color: '000000', blur: 4, offset: 2, angle: 135, opacity: 0.06 },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: boxW, h: 0.06,
      fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
    });
    s.addText(`${r.icon}  ${r.title}`, {
      x: x + 0.12, y: y + 0.1, w: boxW - 0.2, h: 0.38,
      fontSize: 12, color: NAVY, bold: true, margin: 0,
    });
    s.addText(r.body, {
      x: x + 0.12, y: y + 0.5, w: boxW - 0.2, h: 0.72,
      fontSize: 10, color: DARK, margin: 0,
    });
  });

  addSlideNumber(s, 9);
}

// ── SLIDE 10 — Next Steps (closing, dark navy) ────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: NAVY };

  // incident.io logo
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.45, y: 0.35, w: 0.08, h: 0.4,
    fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
  });
  s.addText('incident.io', {
    x: 0.62, y: 0.35, w: 3, h: 0.4,
    fontSize: 16, color: WHITE, bold: true, valign: 'middle', margin: 0,
  });

  s.addText('Recommended Next Steps', {
    x: 1, y: 0.9, w: 8, h: 0.6,
    fontSize: 28, color: WHITE, bold: true, align: 'center',
  });

  const steps = [
    {
      n: '1',
      title: 'Sprint 0 Kickoff  (1 week)',
      bullets: [
        'Provision incident.io environment · SSO/SCIM · Terraform scaffolding',
        'Investigate eventsender.herokuapp.com webhook (112 subscriptions)',
        'Confirm ServiceNow integration approach with SN team',
        'Lock final sprint plan — firm commitments from this point',
      ],
    },
    {
      n: '2',
      title: 'Pilot Wave  (3 weeks)',
      bullets: [
        'Migrate Release Engineering + Business Ops first (simplest teams)',
        'Validate end-to-end: alert → incident → escalation → resolution',
        'Dual-run: PD stays live for all other teams during this phase',
        'Collect feedback; adjust wave 1 plan if needed',
      ],
    },
    {
      n: '3',
      title: 'Full Migration  (~9 more sprints)',
      bullets: [
        `${activeServices} active services across ${teamsWithActive.length} teams → all on incident.io`,
        'ServiceNow, major incident workflows, and automation in dedicated sprints',
        `Standard: ~7.5 months  ·  Parallel (if contract deadline): ~5–6 months`,
        'Hypercare + PagerDuty decommission follow cutover',
      ],
    },
  ];

  steps.forEach((step, i) => {
    const x = 0.35 + i * 3.2;
    const y = 1.65;

    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 3.0, h: 3.5,
      fill: { color: '162354' },
      line: { color: '2A3A7A', width: 1 },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 3.0, h: 0.06,
      fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
    });

    // Step number circle
    s.addShape(pres.shapes.OVAL, {
      x: x + 0.1, y: y + 0.12, w: 0.38, h: 0.38,
      fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
    });
    s.addText(step.n, {
      x: x + 0.1, y: y + 0.12, w: 0.38, h: 0.38,
      fontSize: 16, color: WHITE, bold: true, align: 'center', valign: 'middle', margin: 0,
    });

    s.addText(step.title, {
      x: x + 0.58, y: y + 0.12, w: 2.3, h: 0.38,
      fontSize: 12, color: WHITE, bold: true, valign: 'middle', margin: 0,
    });

    step.bullets.forEach((b, j) => {
      s.addText(`· ${b}`, {
        x: x + 0.15, y: y + 0.65 + j * 0.64, w: 2.7, h: 0.58,
        fontSize: 10, color: ICE, valign: 'top', margin: 0,
      });
    });
  });

  // Footer CTA
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 5.25, w: 10, h: 0.375,
    fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
  });
  s.addText('Book a kickoff call  ·  incident.io/demo  ·  or reply to this deck to get started', {
    x: 0, y: 5.25, w: 10, h: 0.375,
    fontSize: 12, color: WHITE, bold: true, align: 'center', valign: 'middle', margin: 0,
  });
}

// ── Write file ───────────────────────────────────────────────────────────────
pres.writeFile({ fileName: outPath })
  .then(() => {
    console.log(`✓  Deck written: ${outPath}`);
  })
  .catch(e => {
    console.error('✗  Error writing deck:', e.message);
    process.exit(1);
  });

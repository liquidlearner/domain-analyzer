'use strict';
// =============================================================================
//  PD Migration Assessment — RENDERER
//
//  This file contains ZERO business logic and ZERO data analysis.
//  It is a pure layout engine: it reads a content JSON authored by Claude
//  and renders it into a .pptx file.
//
//  Every string visible on screen comes from the content JSON.
//  The SE or AE can edit content.json before running this to adjust any slide.
//
//  Usage:
//    node renderer.js <content.json> <output.pptx>
//
//  The content JSON schema is documented in:
//    .claude/skills/pd-migration-planner/content-schema.json
// =============================================================================

const PptxGenJS = require('pptxgenjs');
const fs        = require('fs');

const contentPath = process.argv[2];
const outPath     = process.argv[3];

if (!contentPath || !outPath) {
  console.error('Usage: node renderer.js <content.json> <output.pptx>');
  process.exit(1);
}

const C = JSON.parse(fs.readFileSync(contentPath, 'utf8'));

// ── Palette ──────────────────────────────────────────────────────────────────
const NAVY   = '1E2761';
const ICE    = 'CADCFC';
const ORANGE = 'FF4D00';
const WHITE  = 'FFFFFF';
const GREY   = 'F4F5F7';
const MID    = '64748B';
const DARK   = '1E293B';
const GREEN  = '059669';
const LGREY  = 'E2E8F0';

// ── Type colours ─────────────────────────────────────────────────────────────
const SPRINT_COLORS = {
  discovery:   LGREY,
  pilot:       ICE,
  wave:        NAVY,
  integration: ORANGE,
  process:     ORANGE,
  automation:  ORANGE,
  cleanup:     ORANGE,
  cutover:     '064E3B',
};

const ACCENT_COLORS = { orange: ORANGE, navy: NAVY, mid: MID };

// ── Build presentation ────────────────────────────────────────────────────────
const pres = new PptxGenJS();
pres.layout = 'LAYOUT_16x9';
pres.author = 'incident.io Solutions Engineering';
pres.title  = `${C.meta.customer} — PD Migration Assessment`;

// ── Shared layout helpers ─────────────────────────────────────────────────────

function topBar(slide) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.08,
    fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
  });
}

function slideNumber(slide, n) {
  slide.addText(String(n), {
    x: 9.5, y: 5.35, w: 0.45, h: 0.25,
    fontSize: 9, color: MID, align: 'right',
  });
}

function logoBlock(slide) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.45, y: 0.35, w: 0.08, h: 0.4,
    fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
  });
  slide.addText('incident.io', {
    x: 0.62, y: 0.35, w: 3, h: 0.4,
    fontSize: 16, color: WHITE, bold: true, valign: 'middle', margin: 0,
  });
}

function pageHeader(slide, title, subtitle) {
  slide.addText(title, {
    x: 0.4, y: 0.18, w: 9, h: 0.5,
    fontSize: 24, color: NAVY, bold: true, margin: 0,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.4, y: 0.65, w: 9, h: 0.28,
      fontSize: 12, color: MID, margin: 0,
    });
  }
}

function card(slide, x, y, w, h, accentColor) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h,
    fill: { color: GREY },
    line: { color: LGREY, width: 1 },
    shadow: { type: 'outer', color: '000000', blur: 4, offset: 2, angle: 135, opacity: 0.06 },
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w: 0.06, h,
    fill: { color: accentColor || NAVY },
    line: { color: accentColor || NAVY, width: 0 },
  });
}

function statCard(slide, x, y, w, h, value, label, sub, accentColor) {
  card(slide, x, y, w, h, accentColor);
  slide.addText(value, {
    x: x + 0.15, y: y + 0.1, w: w - 0.2, h: 0.6,
    fontSize: 36, color: accentColor || NAVY, bold: true, margin: 0,
  });
  slide.addText(label, {
    x: x + 0.15, y: y + 0.68, w: w - 0.2, h: 0.28,
    fontSize: 12, color: DARK, margin: 0,
  });
  if (sub) {
    slide.addText(sub, {
      x: x + 0.15, y: y + 0.92, w: w - 0.2, h: 0.18,
      fontSize: 9, color: MID, margin: 0,
    });
  }
}

function colorBar(slide, x, y, w, h, color) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h,
    fill: { color }, line: { color, width: 0 },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 1 — Title
// ─────────────────────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: NAVY };

  logoBlock(s);

  s.addText('PagerDuty → incident.io', {
    x: 1, y: 1.6, w: 8, h: 0.9,
    fontSize: 38, color: WHITE, bold: true, align: 'center',
  });
  s.addText(C.slide1_title.tagline, {
    x: 1, y: 2.45, w: 8, h: 0.7,
    fontSize: 32, color: ICE, bold: true, align: 'center',
  });

  colorBar(s, 3.5, 3.3, 3, 0.06, ORANGE);
  s.addText(C.slide1_title.customer_display.toUpperCase(), {
    x: 1, y: 3.45, w: 8, h: 0.45,
    fontSize: 16, color: ICE, align: 'center', charSpacing: 4,
  });

  s.addText(`Prepared by ${C.meta.se_name}  ·  incident.io Solutions Engineering  ·  ${C.meta.date}`, {
    x: 1, y: 5.1, w: 8, h: 0.3,
    fontSize: 10, color: '8899BB', align: 'center',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 2 — Environment at a Glance
// ─────────────────────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  topBar(s);

  pageHeader(s, 'Environment at a Glance', C.slide2_environment.subtitle);

  const statW = 2.8;
  const statH = 1.15;
  const top = C.slide2_environment.stats_top || [];
  const bot = C.slide2_environment.stats_bottom || [];
  const xs  = [0.35, 3.35, 6.35];

  top.forEach((st, i) => {
    statCard(s, xs[i], 1.08, statW, statH,
      st.value, st.label, st.sub || null,
      ACCENT_COLORS[st.accent] || NAVY);
  });

  bot.forEach((st, i) => {
    statCard(s, xs[i], 2.45, statW, statH,
      st.value, st.label, st.sub || null,
      ACCENT_COLORS[st.accent] || MID);
  });

  colorBar(s, 0.35, 3.75, 9.3, 1.6, NAVY);
  s.addText(C.slide2_environment.context_bar, {
    x: 0.55, y: 3.88, w: 8.9, h: 0.5,
    fontSize: 12, color: WHITE, bold: false, margin: 0,
  });
  s.addText(C.slide2_environment.teaser, {
    x: 0.55, y: 4.4, w: 8.9, h: 0.35,
    fontSize: 11, color: ICE, italic: true, margin: 0,
  });

  slideNumber(s, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 3 — Real Migration Scope
// ─────────────────────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  const sc = C.slide3_scope;
  s.background = { color: WHITE };
  topBar(s);

  pageHeader(s, 'The Real Migration Scope', sc.subtitle);

  // Active column
  colorBar(s, 0.35, 1.05, 4.4, 3.4, NAVY);
  s.addText('ACTIVE SERVICES', {
    x: 0.55, y: 1.2, w: 4, h: 0.35,
    fontSize: 11, color: ICE, bold: true, charSpacing: 2, margin: 0,
  });
  s.addText(sc.active_count, {
    x: 0.55, y: 1.52, w: 4, h: 1.1,
    fontSize: 72, color: ORANGE, bold: true, margin: 0,
  });
  s.addText(sc.active_desc, {
    x: 0.55, y: 2.65, w: 3.9, h: 0.38,
    fontSize: 12, color: ICE, margin: 0,
  });
  colorBar(s, 0.55, 3.12, 3.9, 0.04, ORANGE);
  s.addText(sc.active_cta, {
    x: 0.55, y: 3.2, w: 3.9, h: 0.45,
    fontSize: 13, color: WHITE, bold: true, margin: 0,
  });
  s.addText(sc.active_sub, {
    x: 0.55, y: 3.7, w: 3.9, h: 0.3,
    fontSize: 11, color: ICE, margin: 0,
  });

  // Stale column
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.25, y: 1.05, w: 4.4, h: 3.4,
    fill: { color: GREY }, line: { color: LGREY, width: 1 },
  });
  s.addText('STALE SERVICES', {
    x: 5.45, y: 1.2, w: 4, h: 0.35,
    fontSize: 11, color: MID, bold: true, charSpacing: 2, margin: 0,
  });
  s.addText(sc.stale_count, {
    x: 5.45, y: 1.52, w: 4, h: 1.1,
    fontSize: 72, color: MID, bold: true, margin: 0,
  });
  s.addText(sc.stale_desc, {
    x: 5.45, y: 2.65, w: 3.9, h: 0.38,
    fontSize: 12, color: MID, margin: 0,
  });
  colorBar(s, 5.45, 3.12, 3.9, 0.04, LGREY);
  s.addText(sc.stale_cta, {
    x: 5.45, y: 3.2, w: 3.9, h: 0.45,
    fontSize: 13, color: DARK, bold: true, margin: 0,
  });
  s.addText(sc.stale_note, {
    x: 5.45, y: 3.7, w: 3.9, h: 0.3,
    fontSize: 11, color: MID, italic: true, margin: 0,
  });

  // Summary bar
  colorBar(s, 0.35, 4.6, 9.3, 0.72, ICE);
  s.addText(sc.summary_bar, {
    x: 0.55, y: 4.72, w: 9, h: 0.48,
    fontSize: 13, color: NAVY, margin: 0,
  });

  slideNumber(s, 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 4 — Team Breakdown
// ─────────────────────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  const tc = C.slide4_teams;
  s.background = { color: WHITE };
  topBar(s);

  pageHeader(s, 'Team Breakdown', tc.subtitle);

  (tc.stats || []).forEach((st, i) => {
    const y = 1.1 + i * 1.05;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.35, y, w: 2.6, h: 0.85,
      fill: { color: GREY }, line: { color: LGREY, width: 1 },
    });
    colorBar(s, 0.35, y, 0.06, 0.85, NAVY);
    s.addText(st.value, {
      x: 0.55, y: y + 0.04, w: 2.3, h: 0.42,
      fontSize: 28, color: NAVY, bold: true, margin: 0,
    });
    s.addText(st.label, {
      x: 0.55, y: y + 0.46, w: 2.3, h: 0.3,
      fontSize: 11, color: DARK, margin: 0,
    });
  });

  const rows = [
    [
      { text: 'Team',   options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Active', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'center' } },
      { text: 'Stale',  options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'center' } },
    ],
    ...(tc.table_rows || []).map((r, i) => [
      { text: r.team,             options: { color: DARK,   fill: { color: i % 2 === 0 ? WHITE : GREY } } },
      { text: String(r.active),   options: { color: ORANGE, bold: true, align: 'center', fill: { color: i % 2 === 0 ? WHITE : GREY } } },
      { text: String(r.stale),    options: { color: MID,    align: 'center', fill: { color: i % 2 === 0 ? WHITE : GREY } } },
    ]),
  ];

  s.addTable(rows, {
    x: 3.2, y: 1.05, w: 6.5, colW: [4.2, 1.15, 1.15],
    rowH: 0.38, border: { pt: 0.5, color: LGREY }, fontSize: 12,
  });

  colorBar(s, 0.35, 4.6, 9.3, 0.65, ICE);
  s.addText(tc.footer, {
    x: 0.55, y: 4.72, w: 9, h: 0.42,
    fontSize: 11, color: NAVY, margin: 0,
  });

  slideNumber(s, 4);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 5 — Shadow Stack & Integration Risk
// ─────────────────────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  const sh = C.slide5_shadow;
  s.background = { color: WHITE };
  topBar(s);

  pageHeader(s, 'Shadow Stack & Integration Risk', sh.subtitle);

  const rows   = sh.rows || [];
  const rowH   = 0.59;
  const startY = 1.0;

  rows.forEach((row, i) => {
    const y     = startY + i * rowH;
    const color = row.risk ? ORANGE : GREEN;
    const bg    = i % 2 === 0 ? WHITE : GREY;

    colorBar(s, 0.35, y, 0.06, rowH - 0.04, color);
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.41, y, w: 9.24, h: rowH - 0.04,
      fill: { color: bg }, line: { color: LGREY, width: 0.5 },
    });

    s.addText(`${row.icon}  ${row.label}`, {
      x: 0.55, y: y + 0.04, w: 2.2, h: rowH - 0.12,
      fontSize: 12, color: DARK, bold: true, valign: 'middle', margin: 0,
    });

    s.addShape(pres.shapes.RECTANGLE, {
      x: 2.85, y: y + 0.1, w: 2.0, h: 0.35,
      fill: { color: row.risk ? 'FFF3ED' : 'ECFDF5' },
      line: { color: row.risk ? ORANGE : GREEN, width: 1 },
    });
    s.addText(row.badge, {
      x: 2.85, y: y + 0.1, w: 2.0, h: 0.35,
      fontSize: 10, color: row.risk ? ORANGE : GREEN,
      bold: true, align: 'center', valign: 'middle', margin: 0,
    });

    s.addText(row.description, {
      x: 5.05, y: y + 0.04, w: 4.55, h: rowH - 0.12,
      fontSize: 10, color: DARK, valign: 'middle', margin: 0,
    });
  });

  slideNumber(s, 5);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 6 — Sprint Plan
// ─────────────────────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  const sp = C.slide6_sprint;
  s.background = { color: WHITE };
  topBar(s);

  pageHeader(s, 'Recommended Sprint Plan', sp.subtitle);

  const sprintRows = [
    [
      { text: 'Sprint',   options: { bold: true, color: WHITE, fill: { color: DARK }, align: 'center' } },
      { text: 'Duration', options: { bold: true, color: WHITE, fill: { color: DARK }, align: 'center' } },
      { text: 'Theme',    options: { bold: true, color: WHITE, fill: { color: DARK } } },
      { text: 'End Milestone', options: { bold: true, color: WHITE, fill: { color: DARK } } },
    ],
    ...(sp.sprints || []).map((sprint, i) => {
      const isLast = i === (sp.sprints.length - 1);
      const bg  = i === 0 ? LGREY : isLast ? '064E3B' : i % 2 === 0 ? WHITE : GREY;
      const tc  = isLast ? WHITE : DARK;
      return [
        { text: sprint.label,     options: { color: tc, bold: true, align: 'center', fill: { color: bg } } },
        { text: sprint.duration,  options: { color: isLast ? ICE : MID, align: 'center', fill: { color: bg } } },
        { text: sprint.theme,     options: { color: tc, bold: true, fill: { color: bg } } },
        { text: sprint.milestone, options: { color: tc, fill: { color: bg }, fontSize: 9 } },
      ];
    }),
  ];

  s.addTable(sprintRows, {
    x: 0.35, y: 1.0, w: 9.3, colW: [0.8, 0.85, 2.65, 5.0],
    rowH: 0.34, border: { pt: 0.5, color: LGREY }, fontSize: 10,
  });

  const tableBottom = 1.0 + (sprintRows.length) * 0.34 + 0.08;
  colorBar(s, 0.35, tableBottom, 9.3, 0.6, ICE);

  const summaryParts = [
    { text: 'Standard: ',   options: { color: NAVY } },
    { text: sp.summary_standard, options: { color: NAVY, bold: true } },
  ];
  if (sp.summary_parallel) {
    summaryParts.push({ text: '    |    With parallel waves: ', options: { color: NAVY } });
    summaryParts.push({ text: sp.summary_parallel, options: { color: ORANGE, bold: true } });
  }
  if (sp.summary_note) {
    summaryParts.push({ text: `  — ${sp.summary_note}`, options: { color: MID, italic: true } });
  }

  s.addText(summaryParts, {
    x: 0.55, y: tableBottom + 0.1, w: 9, h: 0.4, fontSize: 11,
  });

  slideNumber(s, 6);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 7 — What's Easy & What Needs Discussion
// ─────────────────────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  const ev = C.slide7_easy_discussion;
  s.background = { color: WHITE };
  topBar(s);

  pageHeader(s, "What's Easy & What Needs Discussion");

  // Green header
  colorBar(s, 0.35, 0.75, 4.55, 0.42, GREEN);
  s.addText('✓  What migrates quickly', {
    x: 0.35, y: 0.75, w: 4.55, h: 0.42,
    fontSize: 14, color: WHITE, bold: true, valign: 'middle', margin: 8,
  });

  (ev.easy_items || []).forEach((item, i) => {
    const y = 1.28 + i * 0.72;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.35, y, w: 4.55, h: 0.65,
      fill: { color: i % 2 === 0 ? 'F0FDF4' : WHITE },
      line: { color: 'BBF7D0', width: 0.5 },
    });
    colorBar(s, 0.35, y, 0.06, 0.65, GREEN);
    s.addText(item.headline, {
      x: 0.5, y: y + 0.04, w: 4.2, h: 0.25,
      fontSize: 12, color: DARK, bold: true, margin: 0,
    });
    s.addText(item.detail, {
      x: 0.5, y: y + 0.3, w: 4.2, h: 0.3,
      fontSize: 10, color: MID, margin: 0,
    });
  });

  // Orange header
  colorBar(s, 5.1, 0.75, 4.55, 0.42, ORANGE);
  s.addText('⚑  What needs a conversation', {
    x: 5.1, y: 0.75, w: 4.55, h: 0.42,
    fontSize: 14, color: WHITE, bold: true, valign: 'middle', margin: 8,
  });

  (ev.discussion_items || []).forEach((item, i) => {
    const y = 1.28 + i * 0.72;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 5.1, y, w: 4.55, h: 0.65,
      fill: { color: i % 2 === 0 ? 'FFF7ED' : WHITE },
      line: { color: 'FED7AA', width: 0.5 },
    });
    colorBar(s, 5.1, y, 0.06, 0.65, ORANGE);
    s.addText(item.headline, {
      x: 5.25, y: y + 0.04, w: 4.2, h: 0.25,
      fontSize: 12, color: DARK, bold: true, margin: 0,
    });
    s.addText(item.detail, {
      x: 5.25, y: y + 0.3, w: 4.2, h: 0.3,
      fontSize: 10, color: MID, margin: 0,
    });
  });

  slideNumber(s, 7);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 8 — Discovery Questions
// ─────────────────────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  const dq = C.slide8_questions;
  s.background = { color: WHITE };
  topBar(s);

  pageHeader(s, 'Discovery Questions', dq.subtitle);

  const questions = dq.questions || [];
  const colW      = 4.5;
  const rowH      = 0.85;
  const colX      = [0.35, 5.1];
  const startY    = 1.02;

  questions.forEach((q, i) => {
    const col = i < 4 ? 0 : 1;
    const row = i % 4;
    const x   = colX[col];
    const y   = startY + row * rowH;

    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: colW, h: rowH - 0.06,
      fill: { color: row % 2 === 0 ? WHITE : GREY },
      line: { color: LGREY, width: 0.5 },
    });

    s.addShape(pres.shapes.RECTANGLE, {
      x: x + 0.08, y: y + 0.08, w: 0.28, h: 0.28,
      fill: { color: NAVY }, line: { color: NAVY, width: 0 },
    });
    s.addText(String(i + 1), {
      x: x + 0.08, y: y + 0.08, w: 0.28, h: 0.28,
      fontSize: 11, color: WHITE, bold: true,
      align: 'center', valign: 'middle', margin: 0,
    });

    s.addText(q.question, {
      x: x + 0.44, y: y + 0.06, w: colW - 0.52, h: 0.35,
      fontSize: 11, color: DARK, bold: true, margin: 0,
    });
    s.addText(q.why, {
      x: x + 0.44, y: y + 0.44, w: colW - 0.52, h: 0.3,
      fontSize: 9.5, color: MID, margin: 0,
    });
  });

  slideNumber(s, 8);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 9 — Why incident.io (optional)
// ─────────────────────────────────────────────────────────────────────────────
if (C.meta.include_why_slide !== false) {
  const s = pres.addSlide();
  const wy = C.slide9_why;
  s.background = { color: WHITE };
  topBar(s);

  pageHeader(s, 'Why incident.io', 'Built for this — from the first page to the post-incident review');

  const reasons = wy.reasons || [];
  const boxW    = 2.9;
  const boxH    = 1.3;
  const colX    = [0.35, 3.55, 6.75];
  const rowY    = [1.05, 2.55];

  reasons.forEach((r, i) => {
    const x = colX[i % 3];
    const y = rowY[Math.floor(i / 3)];

    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: boxW, h: boxH,
      fill: { color: GREY }, line: { color: LGREY, width: 1 },
      shadow: { type: 'outer', color: '000000', blur: 4, offset: 2, angle: 135, opacity: 0.06 },
    });
    colorBar(s, x, y, boxW, 0.06, ORANGE);
    s.addText(`${r.icon}  ${r.title}`, {
      x: x + 0.12, y: y + 0.1, w: boxW - 0.2, h: 0.38,
      fontSize: 12, color: NAVY, bold: true, margin: 0,
    });
    s.addText(r.body, {
      x: x + 0.12, y: y + 0.5, w: boxW - 0.2, h: 0.72,
      fontSize: 10, color: DARK, margin: 0,
    });
  });

  slideNumber(s, 9);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 10 — Next Steps
// ─────────────────────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  const ns = C.slide10_next_steps;
  s.background = { color: NAVY };

  logoBlock(s);

  s.addText('Recommended Next Steps', {
    x: 1, y: 0.9, w: 8, h: 0.6,
    fontSize: 28, color: WHITE, bold: true, align: 'center',
  });

  const steps = ns.steps || [];
  const stepW = steps.length > 0 ? (9.3 / steps.length) - 0.15 : 3.0;
  const startX = 0.35;

  steps.forEach((step, i) => {
    const x = startX + i * (stepW + 0.15);

    s.addShape(pres.shapes.RECTANGLE, {
      x, y: 1.65, w: stepW, h: 3.5,
      fill: { color: '162354' }, line: { color: '2A3A7A', width: 1 },
    });
    colorBar(s, x, 1.65, stepW, 0.06, ORANGE);

    s.addShape(pres.shapes.OVAL, {
      x: x + 0.1, y: 1.77, w: 0.38, h: 0.38,
      fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
    });
    s.addText(step.number, {
      x: x + 0.1, y: 1.77, w: 0.38, h: 0.38,
      fontSize: 16, color: WHITE, bold: true,
      align: 'center', valign: 'middle', margin: 0,
    });

    s.addText(step.title, {
      x: x + 0.58, y: 1.77, w: stepW - 0.68, h: 0.38,
      fontSize: 12, color: WHITE, bold: true, valign: 'middle', margin: 0,
    });

    (step.bullets || []).forEach((b, j) => {
      s.addText(`· ${b}`, {
        x: x + 0.15, y: 2.3 + j * 0.62, w: stepW - 0.25, h: 0.56,
        fontSize: 10, color: ICE, valign: 'top', margin: 0,
      });
    });
  });

  colorBar(s, 0, 5.25, 10, 0.375, ORANGE);
  s.addText(ns.cta, {
    x: 0, y: 5.25, w: 10, h: 0.375,
    fontSize: 12, color: WHITE, bold: true,
    align: 'center', valign: 'middle', margin: 0,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Write
// ─────────────────────────────────────────────────────────────────────────────
pres.writeFile({ fileName: outPath })
  .then(() => console.log(`✓  ${outPath}`))
  .catch(e => { console.error('Error:', e.message); process.exit(1); });

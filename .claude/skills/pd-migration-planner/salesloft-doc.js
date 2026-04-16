const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel, BorderStyle,
  WidthType, ShadingType, VerticalAlign, PageNumber
} = require('docx');
const fs = require('fs');

// ── Colours (matched from original Salesloft migration plan) ─────────────────
const C = {
  orange:    "f25533",  // incident.io brand orange — headers, title, metric numbers
  cream:     "e2dacc",  // warm beige — metric box fill, excluded CET rows
  highlight: "fff8ec",  // warm cream — Sprint 0 / action rows
  hlText:    "d4700a",  // amber — text on highlight rows
  altRow:    "f4f4f4",  // light grey — alternating table rows
  white:     "ffffff",
  text:      "2d2d2d",  // near-black — all body text
  textGrey:  "666666",  // medium grey — subtitle / metadata text
};

// ── Border helpers ────────────────────────────────────────────────────────────
const hairline = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const cellBorders = { top: hairline, bottom: hairline, left: hairline, right: hairline };
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

// ── Helpers ───────────────────────────────────────────────────────────────────
const sp = (before, after) => ({ before, after });
const shade = (fill) => ({ fill, type: ShadingType.CLEAR });

function heading1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: sp(360, 120),
    children: [new TextRun({ text, bold: true, size: 26, font: "Arial", color: C.text })],
  });
}

function heading2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: sp(240, 80),
    children: [new TextRun({ text, bold: true, size: 22, font: "Arial", color: C.text })],
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: sp(60, 60),
    children: [new TextRun({ text, size: 22, font: "Arial", color: C.text, ...opts })],
  });
}

function bodyRuns(runs) {
  return new Paragraph({
    spacing: sp(60, 60),
    children: runs.map(([text, opts = {}]) =>
      new TextRun({ text, size: 22, font: "Arial", color: C.text, ...opts })
    ),
  });
}

function bullet(text, bold = false) {
  return new Paragraph({
    spacing: sp(40, 40),
    numbering: { reference: "bullets", level: 0 },
    children: [new TextRun({ text, size: 22, font: "Arial", bold, color: C.text })],
  });
}

function spacer() {
  return new Paragraph({ spacing: sp(80, 80), children: [new TextRun("")] });
}

function divider() {
  return new Paragraph({
    spacing: sp(120, 120),
    border: { bottom: { style: BorderStyle.SINGLE, size: 20, color: C.orange, space: 1 } },
    children: [new TextRun("")],
  });
}

// ── Metric box row (headline numbers) ────────────────────────────────────────
function metricTable(metrics) {
  // metrics = [{number, label, sub}]
  const W = 10080;
  const cw = Math.floor(W / metrics.length);
  const orangeTopBorder = { style: BorderStyle.SINGLE, size: 20, color: C.orange };
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: metrics.map(() => cw),
    rows: [
      new TableRow({
        children: metrics.map(m =>
          new TableCell({
            borders: { top: orangeTopBorder, bottom: noBorder, left: noBorder, right: noBorder },
            width: { size: cw, type: WidthType.DXA },
            shading: shade(C.cream),
            margins: { top: 120, bottom: 120, left: 200, right: 200 },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({ alignment: AlignmentType.LEFT, spacing: sp(0, 0),
                children: [new TextRun({ text: m.number, size: 72, bold: true, font: "Arial", color: C.orange })] }),
              new Paragraph({ alignment: AlignmentType.LEFT, spacing: sp(0, 0),
                children: [new TextRun({ text: m.label, size: 20, bold: true, font: "Arial", color: C.text })] }),
              new Paragraph({ alignment: AlignmentType.LEFT, spacing: sp(0, 0),
                children: [new TextRun({ text: m.sub, size: 18, font: "Arial", color: C.textGrey })] }),
            ],
          })
        ),
      }),
    ],
  });
}

// ── Generic 2-col table ───────────────────────────────────────────────────────
function twoColTable(rows, col1w = 3600) {
  const col2w = 9360 - col1w;
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [col1w, col2w],
    rows: rows.map((row, ri) =>
      new TableRow({
        children: row.map((cell, ci) =>
          new TableCell({
            borders: cellBorders,
            width: { size: ci === 0 ? col1w : col2w, type: WidthType.DXA },
            shading: ri === 0 ? shade(C.orange) : shade(ri % 2 === 0 ? C.white : C.altRow),
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({
                spacing: sp(0, 0),
                children: [new TextRun({
                  text: cell,
                  size: ri === 0 ? 18 : 20,
                  bold: ri === 0,
                  font: "Arial",
                  color: ri === 0 ? C.white : C.text,
                })],
              }),
            ],
          })
        ),
      })
    ),
  });
}

// ── 4-col sprint table ────────────────────────────────────────────────────────
function sprintTable(rows) {
  const colW = [1200, 2000, 3160, 3000];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: colW,
    rows: rows.map((row, ri) => {
      const isHeader = ri === 0;
      const isCutover = row[0] && row[0].includes("Cutover");
      let bg = ri % 2 === 0 ? C.altRow : C.white;
      if (isHeader) bg = C.orange;
      else if (isCutover) bg = C.highlight;
      return new TableRow({
        children: row.map((cell, ci) =>
          new TableCell({
            borders: cellBorders,
            width: { size: colW[ci], type: WidthType.DXA },
            shading: shade(bg),
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            verticalAlign: VerticalAlign.TOP,
            children: [
              new Paragraph({
                spacing: sp(0, 0),
                children: [new TextRun({
                  text: cell,
                  size: isHeader ? 18 : 19,
                  bold: isHeader,
                  font: "Arial",
                  color: isHeader ? C.white : (isCutover ? C.hlText : C.text),
                })],
              }),
            ],
          })
        ),
      });
    }),
  });
}

// ── CET table ─────────────────────────────────────────────────────────────────
function cetTable(rows) {
  const colW = [2400, 1680, 2160, 3120];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: colW,
    rows: rows.map((row, ri) => {
      const isHeader = ri === 0;
      const isExcluded = !isHeader && row[3].includes("Not Migrating");
      let bg = ri % 2 === 0 ? C.highlight : C.white;
      if (isHeader) bg = C.orange;
      else if (isExcluded) bg = C.cream;
      return new TableRow({
        children: row.map((cell, ci) =>
          new TableCell({
            borders: cellBorders,
            width: { size: colW[ci], type: WidthType.DXA },
            shading: shade(bg),
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            verticalAlign: VerticalAlign.TOP,
            children: [
              new Paragraph({
                spacing: sp(0, 0),
                children: [new TextRun({
                  text: cell,
                  size: isHeader ? 18 : 19,
                  bold: isHeader,
                  font: "Arial",
                  color: isHeader ? C.white : (isExcluded ? C.textGrey : C.text),
                })],
              }),
            ],
          })
        ),
      });
    }),
  });
}

// ── Teams table ───────────────────────────────────────────────────────────────
function teamsTable(rows) {
  const colW = [4200, 1680, 3480];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: colW,
    rows: rows.map((row, ri) => {
      const isHeader = ri === 0;
      const isPilot = row[2] && row[2].includes("pilot");
      const isSprint0 = row[2] && row[2].includes("Sprint 0");
      let bg = ri % 2 === 0 ? C.altRow : C.white;
      if (isHeader) bg = C.orange;
      else if (isSprint0) bg = C.highlight;
      else if (isPilot) bg = C.cream;
      return new TableRow({
        children: row.map((cell, ci) =>
          new TableCell({
            borders: cellBorders,
            width: { size: colW[ci], type: WidthType.DXA },
            shading: shade(bg),
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({
                spacing: sp(0, 0),
                children: [new TextRun({
                  text: cell,
                  size: isHeader ? 17 : 18,
                  bold: isHeader || isSprint0,
                  font: "Arial",
                  color: isHeader ? C.white : (isSprint0 ? C.hlText : C.text),
                })],
              }),
            ],
          })
        ),
      });
    }),
  });
}

// ── Document ──────────────────────────────────────────────────────────────────
const doc = new Document({
  numbering: {
    config: [
      { reference: "bullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 640, hanging: 320 } } } }
      ]},
    ],
  },
  styles: {
    default: { document: { run: { font: "Arial", size: 20 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, font: "Arial", color: C.text },
        paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: C.text },
        paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 1 } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            spacing: sp(0, 0),
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "D0D0D0", space: 4 } },
            children: [
              new TextRun({ text: "On-Call Migration Plan  ·  Salesloft  \u2192  incident.io  ·  April 2026", size: 16, font: "Arial", color: "888888" }),
            ],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: sp(0, 0),
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: "D0D0D0", space: 4 } },
            children: [
              new TextRun({ text: "Confidential  \u00B7  incident.io  \u00B7  Page ", size: 16, font: "Arial", color: "888888" }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, font: "Arial", color: "888888" }),
            ],
          }),
        ],
      }),
    },
    children: [

      // ── Title Block ─────────────────────────────────────────────────────────
      new Paragraph({
        spacing: sp(0, 80),
        children: [new TextRun({ text: "On-Call Migration Plan", size: 52, bold: true, font: "Arial", color: C.orange })],
      }),
      new Paragraph({
        spacing: sp(0, 40),
        children: [new TextRun({ text: "Salesloft  \u2192  incident.io", size: 32, font: "Arial", color: C.text })],
      }),
      new Paragraph({
        spacing: sp(0, 240),
        children: [new TextRun({ text: "13 April 2026  \u00B7  Based on full service inventory review", size: 20, font: "Arial", color: C.textGrey, italics: true })],
      }),

      divider(),

      // ── Section 1: Migration Scope ──────────────────────────────────────────
      heading1("Migration scope confirmed by Salesloft service inventory"),

      body("Salesloft has 307 PagerDuty services in total. Your team reviewed the full list and tagged 191 services for migration \u2014 every service your engineers actively own and respond to. The remaining 116 services are in maintenance, disabled, or explicitly excluded (including legacy Drift-BXP infrastructure and tooling services your team decommissioned)."),

      spacer(),

      metricTable([
        { number: "191", label: "Services tagged Migrate", sub: "Manually reviewed and confirmed by Salesloft team" },
        { number: "19", label: "Active named teams", sub: "Plus 15 services needing team assignment (Sprint 0 action)" },
        { number: "116", label: "Services excluded", sub: "91 maintenance, 13 disabled, 12 active-but-excluded" },
      ]),

      spacer(),
      body("Note: Our analysis determined 85 services showed activity in the last 90 days and we recommend prioritizing those before the cutover.", { italics: true, color: C.textGrey }),
      spacer(),

      heading2("Teams and service count (migrate = Yes)"),

      teamsTable([
        ["Team", "Services", "Sprint / Notes"],
        ["No team assigned", "15", "\u26A0 Sprint 0 \u2014 must assign before migration"],
        ["Techops", "43", "Sprint 1 pilot"],
        ["Deals", "24", "Sprint 2"],
        ["Little Five Endpoints", "20", "Sprint 2"],
        ["Wild Wild Data", "13", "Sprint 2"],
        ["Cloud9erz", "11", "Sprint 2"],
        ["HSA", "8", "Sprint 2"],
        ["Conversation Intelligence", "8", "Sprint 2"],
        ["Security Team", "7", "Sprint 2"],
        ["Analytics and Coaching", "7", "Sprint 2"],
        ["No Data Left Behind", "7", "Sprint 2"],
        ["CCR", "6", "Sprint 2"],
        ["OMG", "6", "Sprint 2"],
        ["Workflow Pod", "5", "Sprint 2"],
        ["Prospector Pod", "4", "Sprint 2"],
        ["Support On-Call", "3", "Sprint 2"],
        ["DBE On-Call", "1", "Sprint 2"],
        ["Lead IntelliAgent / RnB / Release Bot", "3", "Sprint 2"],
      ]),

      spacer(),
      divider(),

      // ── Section 2: Why Low Risk ─────────────────────────────────────────────
      heading1("Why this migration remains low-risk"),

      body("The 191-service scope doesn\u2019t change the risk profile. The integrations that extend enterprise migration timelines are absent from the Salesloft PagerDuty account entirely:"),

      spacer(),
      bullet("No ServiceNow \u2014 removes 2\u20133 sprints from typical enterprise timelines"),
      bullet("No automation actions or runners \u2014 no remediation scripts to re-platform"),
      bullet("No status pages, no response plays"),
      bullet("No intelligent alert grouping (AIOps) \u2014 no feature parity concerns"),
      bullet("All integration vendors are Datadog, New Relic, Rigor, Events API V2, or Email \u2014 all map to standard incident.io alert sources"),
      bullet("3 event orchestrations detected, none routing services \u2014 low migration overhead"),
      spacer(),

      body("Programmatic import handles 191 PD services with the same automation as 85. The sprint timeline is driven by team validation and training cadence, not service volume."),

      spacer(),
      divider(),

      // ── Section 3: Sprint Plan ──────────────────────────────────────────────
      heading1("Three-sprint plan to May 9"),

      sprintTable([
        ["Sprint", "Timeline", "Scope", "Exit Milestone"],
        [
          "Sprint 0",
          "Week 1\nApr 13\u201318",
          "Resolve FireHydrant webhook. Review all 4 in-scope Custom Event Transformer scripts. Assign team to 15 unassigned services. Import validated. Run script to create Catalog types for Teams and Salesloft Applications. Import all Schedules and Escalation Paths. Install alert sources.",
          "All unknowns resolved. 15 unassigned services assigned. Techops configured and ready.",
        ],
        [
          "Sprint 1",
          "Weeks 2\u20133\nApr 21 \u2013 May 2",
          "Techops pilot: 43 services go live on incident.io. Dual-run alongside PagerDuty. Engineers install mobile app and validate paging. Simultaneously, build and stage configurations for all remaining 18 teams.",
          "Techops fully live. Zero missed pages. All Sprint 2 team configs pre-built and ready.",
        ],
        [
          "Sprint 2\n\u2713 Cutover",
          "Week 4\nMay 3\u20139",
          "All remaining 148 services across 18 teams migrate: Deals, Little Five Endpoints, Wild Wild Data, Cloud9erz, Security, Analytics & Coaching, HSA, CCR, OMG, Conversation Intelligence, and 8 smaller teams.",
          "All 191 services on incident.io. PagerDuty routing disabled. May 9 deadline met.",
        ],
      ]),

      spacer(),
      divider(),

      // ── Section 4: CETs ─────────────────────────────────────────────────────
      heading1("Custom Event Transformers \u2014 Sprint 0 exit gate"),

      body("JavaScript payload transformers cannot be imported programmatically and must each be reviewed individually. Of the 6 CETs detected in the Salesloft PagerDuty account, 4 are in migration scope and 2 are excluded (Drift-BXP services tagged migrate=No by your team)."),

      spacer(),
      heading2("In-scope CETs (must be resolved before Sprint 1 begins)"),

      cetTable([
        ["Service", "Team", "Transformer Type", "Migration Path"],
        [
          "aws-security-cloudwatch-alerts",
          "Security Team",
          "CloudWatch \u2192 Event Transformer API",
          "Replace with native incident.io AWS integration. CET script reviewed in Sprint 0.",
        ],
        [
          "CloudWatch Alerts",
          "Techops (Sprint 1 pilot)",
          "CloudWatch \u2192 Event Transformer API",
          "Replace with native incident.io AWS integration. Resolved during Techops pilot.",
        ],
        [
          "DBE Critical Alerts",
          "DBE On-Call",
          "Multi-source (Datadog, APIv2, Slack, Sumo Logic) + Transformer",
          "Field enrichment \u2192 custom alert source attribute. DBE engineer sign-off required Sprint 0.",
        ],
        [
          "Slack Webhook",
          "Support On-Call",
          "Slack \u2192 Event Transformer API",
          "Map to incident.io Slack alert source. Likely simple field rename \u2014 lowest effort.",
        ],
        [
          "Cloudwatch_Integration",
          "Drift-Centralized Engineering",
          "CloudWatch \u2192 Event Transformer API",
          "Not Migrating \u2014 Drift team excluded from this migration scope.",
        ],
        [
          "Drift-insights-api",
          "Drift-BXP",
          "Multi-source + Change Event Transformer",
          "Not Migrating \u2014 legacy Drift-BXP footprint, maintenance status, excluded.",
        ],
      ]),

      spacer(),
      bodyRuns([
        ["Sprint 0 exit criterion: ", { bold: true }],
        ["every in-scope transformer must have a confirmed migration path before Sprint 1 begins. The two excluded CETs (Cloudwatch_Integration owned by Drift-Centralized Engineering, and Drift-insights-api owned by Drift-BXP) are not migration scope \u2014 your team has explicitly excluded these services.", {}],
      ]),

      spacer(),
      divider(),

      // ── Section 5: Sprint 0 Open Items ──────────────────────────────────────
      heading1("Sprint 0 open items"),

      bullet("15 services marked Migrate = Yes have no team assigned. These must be assigned an owner before migration. See prioritized services list for full inventory.", true),
      bullet("DBE Critical Alerts CET \u2014 DBE engineer must be available for Sprint 0 sign-off on the custom transformer.", true),
      bullet("FireHydrant webhook \u2014 confirm active routing or legacy deregistration before Sprint 1. The webhook endpoint is live in the PD account; if FireHydrant is no longer in active use, deregister before cutover.", true),

      spacer(),
      divider(),

      // ── Section 6: What incident.io Provides ────────────────────────────────
      heading1("What incident.io provides"),

      bullet("Sprint 0 technical scoping: Custom Event Transformer review (all 4 in-scope transformers), Terraform template validation, Slack workspace configuration (Catalog config, Importing Schedules/EPs, Alert Sources and Routes)"),
      bullet("End-user training sessions for each of the 19+ teams before their cutover across 3 timezones"),
      bullet("Weekly migration syncs with Success team"),
      bullet("Dual-run period for every team \u2014 no engineer is left without paging coverage during transition"),
      bullet("Hypercare: 2-week rapid-response window post-May 9 cutover"),

      spacer(),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('/sessions/friendly-vigilant-ride/mnt/domain-analyzer/salesloft-migration-plan-2026-04-13.docx', buf);
  console.log('Done.');
}).catch(e => { console.error(e); process.exit(1); });

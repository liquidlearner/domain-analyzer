const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel, BorderStyle,
  WidthType, ShadingType, VerticalAlign, PageNumber
} = require('docx');
const fs = require('fs');

// ── Colours ────────────────────────────────────────────────────────────────────
const C = {
  orange:    "f25533",
  cream:     "e2dacc",
  highlight: "fff8ec",
  hlText:    "d4700a",
  altRow:    "f4f4f4",
  white:     "ffffff",
  text:      "2d2d2d",
  textGrey:  "666666",
};

// ── Border helpers ─────────────────────────────────────────────────────────────
const hairline = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const cellBorders = { top: hairline, bottom: hairline, left: hairline, right: hairline };
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const orangeTopBorder = { style: BorderStyle.SINGLE, size: 20, color: C.orange };

// ── Helpers ────────────────────────────────────────────────────────────────────
const sp = (before, after) => ({ before, after });
const shade = (fill) => ({ fill, type: ShadingType.CLEAR });

function heading1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: sp(360, 120),
    children: [new TextRun({ text, bold: true, size: 28, font: "Arial", color: C.text })],
  });
}

function heading2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: sp(240, 80),
    children: [new TextRun({ text, bold: true, size: 23, font: "Arial", color: C.text })],
  });
}

function heading3(text) {
  return new Paragraph({
    spacing: sp(200, 60),
    children: [new TextRun({ text, bold: true, size: 21, font: "Arial", color: C.orange })],
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: sp(60, 60),
    children: [new TextRun({ text, size: 20, font: "Arial", color: C.text, ...opts })],
  });
}

function bodyRuns(runs) {
  return new Paragraph({
    spacing: sp(60, 60),
    children: runs.map(([text, opts = {}]) =>
      new TextRun({ text, size: 20, font: "Arial", color: C.text, ...opts })
    ),
  });
}

function bullet(text, bold = false, level = 0) {
  const ref = level === 0 ? "bullets" : "bullets2";
  return new Paragraph({
    spacing: sp(30, 30),
    numbering: { reference: ref, level: 0 },
    children: [new TextRun({ text, size: 20, font: "Arial", bold, color: C.text })],
  });
}

function numberedItem(text, reference = "numbered") {
  return new Paragraph({
    spacing: sp(40, 40),
    numbering: { reference, level: 0 },
    children: [new TextRun({ text, size: 20, font: "Arial", color: C.text })],
  });
}

function spacer(size = 80) {
  return new Paragraph({ spacing: sp(size, size), children: [new TextRun("")] });
}

function divider() {
  return new Paragraph({
    spacing: sp(120, 120),
    border: { bottom: { style: BorderStyle.SINGLE, size: 20, color: C.orange, space: 1 } },
    children: [new TextRun("")],
  });
}

// Stream banner — full-width orange bar with stream number + title
function streamBanner(number, title) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: noBorders,
            width: { size: 9360, type: WidthType.DXA },
            shading: shade(C.orange),
            margins: { top: 120, bottom: 120, left: 240, right: 240 },
            children: [
              new Paragraph({
                spacing: sp(0, 0),
                children: [
                  new TextRun({ text: `Stream ${number}  `, size: 18, bold: true, font: "Arial", color: C.cream }),
                  new TextRun({ text: title, size: 22, bold: true, font: "Arial", color: C.white }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

// Callout box — cream background, optional amber label
function callout(label, text) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: { top: orangeTopBorder, bottom: noBorder, left: noBorder, right: noBorder },
            width: { size: 9360, type: WidthType.DXA },
            shading: shade(C.highlight),
            margins: { top: 100, bottom: 100, left: 200, right: 200 },
            children: [
              new Paragraph({
                spacing: sp(0, 40),
                children: [new TextRun({ text: label, size: 18, bold: true, font: "Arial", color: C.hlText })],
              }),
              new Paragraph({
                spacing: sp(0, 0),
                children: [new TextRun({ text, size: 19, font: "Arial", color: C.text })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

// Metric box row
function metricTable(metrics) {
  const W = 9360;
  const cw = Math.floor(W / metrics.length);
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
                children: [new TextRun({ text: m.label, size: 19, bold: true, font: "Arial", color: C.text })] }),
              new Paragraph({ alignment: AlignmentType.LEFT, spacing: sp(0, 0),
                children: [new TextRun({ text: m.sub, size: 17, font: "Arial", color: C.textGrey })] }),
            ],
          })
        ),
      }),
    ],
  });
}

// Generic 2-col table
function twoColTable(rows, col1w = 3000) {
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
                  size: ri === 0 ? 18 : 19,
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

// 3-col table for prerequisites / checklist
function checklistTable(rows) {
  const colW = [3800, 3000, 2560];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: colW,
    rows: rows.map((row, ri) => {
      const isHeader = ri === 0;
      return new TableRow({
        children: row.map((cell, ci) =>
          new TableCell({
            borders: cellBorders,
            width: { size: colW[ci], type: WidthType.DXA },
            shading: isHeader ? shade(C.orange) : shade(ri % 2 === 0 ? C.white : C.altRow),
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({
                spacing: sp(0, 0),
                children: [new TextRun({
                  text: cell,
                  size: isHeader ? 17 : 18,
                  bold: isHeader,
                  font: "Arial",
                  color: isHeader ? C.white : C.text,
                })],
              }),
            ],
          })
        ),
      });
    }),
  });
}

// CET table
function cetTable(rows) {
  const colW = [2400, 1560, 2160, 3240];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: colW,
    rows: rows.map((row, ri) => {
      const isHeader = ri === 0;
      const isExcluded = !isHeader && row[3] && row[3].includes("Not Migrating");
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
                  size: isHeader ? 17 : 18,
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

// Sprint timeline table
function sprintTable(rows) {
  const colW = [1300, 1800, 3060, 3200];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: colW,
    rows: rows.map((row, ri) => {
      const isHeader = ri === 0;
      const isSprint0 = !isHeader && row[0] && row[0].includes("0");
      const isCutover = !isHeader && row[0] && row[0].includes("\u2713");
      let bg = ri % 2 === 0 ? C.altRow : C.white;
      if (isHeader) bg = C.orange;
      else if (isSprint0) bg = C.highlight;
      else if (isCutover) bg = C.cream;
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

// Alert sources table
function alertSourceTable(rows) {
  const colW = [2600, 2200, 2000, 2560];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: colW,
    rows: rows.map((row, ri) => {
      const isHeader = ri === 0;
      return new TableRow({
        children: row.map((cell, ci) =>
          new TableCell({
            borders: cellBorders,
            width: { size: colW[ci], type: WidthType.DXA },
            shading: isHeader ? shade(C.orange) : shade(ri % 2 === 0 ? C.white : C.altRow),
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            verticalAlign: VerticalAlign.TOP,
            children: [
              new Paragraph({
                spacing: sp(0, 0),
                children: [new TextRun({
                  text: cell,
                  size: isHeader ? 17 : 18,
                  bold: isHeader,
                  font: "Arial",
                  color: isHeader ? C.white : C.text,
                })],
              }),
            ],
          })
        ),
      });
    }),
  });
}

// ── Document ───────────────────────────────────────────────────────────────────
const doc = new Document({
  numbering: {
    config: [
      { reference: "bullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 640, hanging: 320 } } } }
      ]},
      { reference: "bullets2", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "\u25E6", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 960, hanging: 320 } } } }
      ]},
      { reference: "numbered", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 640, hanging: 320 } } } }
      ]},
    ],
  },
  styles: {
    default: { document: { run: { font: "Arial", size: 20 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: C.text },
        paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 23, bold: true, font: "Arial", color: C.text },
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
              new TextRun({ text: "Migration Guide  \u00B7  Salesloft  \u2192  incident.io  \u00B7  April 2026", size: 16, font: "Arial", color: "888888" }),
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

      // ── Title Block ──────────────────────────────────────────────────────────
      new Paragraph({
        spacing: sp(0, 80),
        children: [new TextRun({ text: "Migration Guide", size: 56, bold: true, font: "Arial", color: C.orange })],
      }),
      new Paragraph({
        spacing: sp(0, 40),
        children: [new TextRun({ text: "Salesloft  \u2192  incident.io", size: 32, font: "Arial", color: C.text })],
      }),
      new Paragraph({
        spacing: sp(0, 40),
        children: [new TextRun({ text: "Technical runbook for a phased, zero-downtime cutover", size: 21, font: "Arial", color: C.textGrey, italics: true })],
      }),
      new Paragraph({
        spacing: sp(0, 240),
        children: [new TextRun({ text: "13 April 2026  \u00B7  incident.io Solution Architecture", size: 19, font: "Arial", color: C.textGrey })],
      }),

      divider(),

      // ── Section: Our Understanding of Your Account ───────────────────────────
      heading1("Our understanding of your account"),

      body("The following summary is drawn directly from Salesloft\u2019s PagerDuty account. Your team reviewed the full service inventory and provided migration tags, which form the basis of every estimate and recommendation in this guide."),

      spacer(),

      metricTable([
        { number: "191", label: "Services in scope", sub: "Manually tagged Migrate = Yes by Salesloft team" },
        { number: "19", label: "Active teams", sub: "Plus 15 services pending team assignment (Sprint 0 action)" },
        { number: "4", label: "Custom Event Transformers", sub: "In-scope; scoped in Sprint 0, resolved per team sprint" },
      ]),

      spacer(),

      twoColTable([
        ["Category", "Salesloft Detail"],
        ["Total PD services", "307 services (191 migrate, 116 excluded)"],
        ["Excluded services", "91 maintenance, 13 disabled, 12 active-but-excluded (incl. legacy Drift-BXP)"],
        ["Recently active services", "85 services with alert activity in the last 90 days \u2014 prioritised first"],
        ["Alert integrations in use", "Datadog, New Relic, Rigor, Events API V2, Email"],
        ["Global Orchestrations", "3 event orchestrations detected \u2014 none routing to services. Must be ported in Sprint 0."],
        ["Live Call Routing (LCR)", "LCR data collected pre-purchase. Migration gated on destination team\u2019s services being live."],
        ["Custom Event Transformers", "6 total; 4 in migration scope, 2 excluded (Drift teams). Scoped in Sprint 0."],
        ["ServiceNow / automation actions", "None detected \u2014 removes 2\u20133 sprint blocks from typical enterprise timelines"],
        ["Status pages / response plays", "None detected"],
        ["Pilot team", "Techops \u2014 43 services, Sprint 1 (Apr 21 \u2013 May 2)"],
        ["Target cutover", "May 9, 2026 \u2014 all 191 services on incident.io"],
      ], 3200),

      spacer(),

      callout(
        "\u26A0  Sprint 0 actions required before migration begins",
        "1. Assign an owner to the 15 services currently showing Migrate = Yes with no team. These must be assigned before migration scripts run.\n2. Resolve the FireHydrant webhook \u2014 confirm active use or deregister before Sprint 1.\n3. Scope all 4 in-scope CETs and confirm migration path for each (see Stream 2)."
      ),

      spacer(),
      divider(),

      // ── STREAM 1 ─────────────────────────────────────────────────────────────
      streamBanner(1, "Prerequisites"),
      spacer(60),

      body("Everything in Stream 1 happens before any alert sources are connected. These are account-level foundations \u2014 get them right once and they enable every subsequent stream."),

      spacer(),
      heading2("1.1  Account creation and access"),

      checklistTable([
        ["Task", "Owner", "When"],
        ["Create incident.io organisation (provisioned by incident.io)", "incident.io SA", "Pre-Sprint 0"],
        ["Invite Salesloft Workspace Owners (minimum 2 admin users)", "Salesloft IT / Eng Lead", "Sprint 0, Day 1"],
        ["Configure SSO \u2014 connect Salesloft\u2019s identity provider (Okta or SAML 2.0)", "Salesloft IT", "Sprint 0"],
        ["Define RBAC roles: Responder, Team Admin, Workspace Owner", "Salesloft Eng Lead", "Sprint 0"],
        ["Install the incident.io Slack app in your workspace", "Salesloft Slack Admin", "Sprint 0"],
        ["Verify Slack bot permissions (post to channels, create incidents)", "incident.io SA", "Sprint 0"],
      ]),

      spacer(),
      heading2("1.2  Connect PagerDuty to incident.io"),

      body("The PagerDuty \u2192 incident.io connector enables programmatic import of your schedules, escalation policies, and service metadata. This is the foundation for Streams 2 and 3."),

      spacer(),
      numberedItem("In incident.io Settings \u2192 Integrations, add the PagerDuty integration and authenticate with a PagerDuty API token (read-only scope is sufficient for import)."),
      numberedItem("Validate that the connection can read your 307 services, 19 teams, and existing escalation policies."),
      numberedItem("Do not disconnect PagerDuty yet \u2014 dual-run requires the connection to remain active through Sprint 2 cutover."),

      spacer(),
      heading2("1.3  Catalog foundation"),

      body("incident.io\u2019s Catalog is the source of truth for Teams, Services, and ownership. Salesloft\u2019s migration will use Catalog to map the 191 services to their 19 teams, ensuring alert enrichment and routing logic is correct from day one."),

      spacer(),
      bullet("Run the incident.io Terraform template to create Catalog types for Teams and Salesloft Applications."),
      bullet("Import all 19 Salesloft teams as Catalog entries (with team owners, Slack channels, and timezone metadata)."),
      bullet("Resolve the 15 unassigned services \u2014 assign each to a Catalog team before migration scripts run. This is a Sprint 0 exit criterion."),
      bullet("Verify that Catalog team entries match PagerDuty team names for automated mapping during service import."),

      spacer(),
      divider(),

      // ── STREAM 2 ─────────────────────────────────────────────────────────────
      streamBanner(2, "Connecting and enriching alerts"),
      spacer(60),

      body("Stream 2 wires up Salesloft\u2019s monitoring tools as incident.io alert sources. The principle is one alert source configuration per tool \u2014 not per PagerDuty service. All Salesloft alert volume (Datadog, New Relic, Rigor, Events API, Email) maps to five alert source types."),

      spacer(),
      heading2("2.1  Alert source inventory"),

      alertSourceTable([
        ["Integration", "PD Services using it", "incident.io alert source", "Notes"],
        ["Datadog", "Majority of in-scope services", "Native Datadog alert source", "Webhook endpoint; no transform required"],
        ["New Relic", "Multiple services", "Native New Relic alert source", "Webhook endpoint; no transform required"],
        ["Rigor", "Multiple services", "HTTP / Events API alert source", "Map payload fields at source config"],
        ["Events API V2", "Multiple services", "Custom HTTP alert source", "Direct POST; field mapping in alert source config"],
        ["Email integration", "Several services", "Email alert source", "One shared inbound address, routed by subject/tag"],
      ]),

      spacer(),
      heading2("2.2  Alert enrichment strategy"),

      body("Rather than replicating PagerDuty\u2019s per-service routing key model, incident.io uses Catalog attributes to enrich alerts at source. Two approaches work for Salesloft:"),

      spacer(),
      bodyRuns([["Option A (recommended) \u2014 Tag-based enrichment: ", { bold: true, color: C.orange }]]),
      bullet("Each monitoring tool (Datadog, New Relic) sends alerts with a tag or label identifying the service or team."),
      bullet("incident.io alert routes use that tag to look up the Catalog entry and attach service/team ownership automatically."),
      bullet("No per-service webhook endpoints \u2014 simpler to maintain than the PagerDuty model."),

      spacer(),
      bodyRuns([["Option B \u2014 Routing key \u2192 Catalog mapping: ", { bold: true, color: C.text }]]),
      bullet("Existing PagerDuty routing keys are mapped to Catalog entities using incident.io\u2019s routing key import tool."),
      bullet("Useful for services where alert payloads cannot be easily tagged at source."),
      bullet("Can be combined with Option A: use tags where possible, routing key mapping as fallback."),

      spacer(),
      heading2("2.3  Custom Event Transformers (CETs)"),

      body("Custom Event Transformers are JavaScript payload transforms that run inside PagerDuty. They cannot be imported programmatically. Each CET must be reviewed individually, and a migration path confirmed before the team\u2019s sprint begins."),
      spacer(),
      body("Scoping philosophy: CETs are identified and scoped during Sprint 0. Implementation happens alongside the relevant team\u2019s sprint \u2014 not as a blocker to all sprints.", { italics: true, color: C.textGrey }),

      spacer(),

      cetTable([
        ["Service", "Team", "Transformer type", "Migration path"],
        [
          "aws-security-cloudwatch-alerts",
          "Security Team",
          "CloudWatch \u2192 Event Transformer API",
          "Replace with native incident.io AWS integration. Script reviewed Sprint 0; implemented during Security sprint.",
        ],
        [
          "CloudWatch Alerts",
          "Techops (Sprint 1 pilot)",
          "CloudWatch \u2192 Event Transformer API",
          "Replace with native AWS integration. Resolved and validated during Techops pilot sprint.",
        ],
        [
          "DBE Critical Alerts",
          "DBE On-Call",
          "Multi-source (Datadog, APIv2, Slack, Sumo Logic) + field transformer",
          "Field enrichment mapped to custom alert source attribute. DBE engineer sign-off required Sprint 0.",
        ],
        [
          "Slack Webhook",
          "Support On-Call",
          "Slack \u2192 Event Transformer API",
          "Map to incident.io Slack alert source. Likely simple field rename \u2014 lowest implementation effort.",
        ],
        [
          "Cloudwatch_Integration",
          "Drift-Centralized Eng",
          "CloudWatch \u2192 Event Transformer API",
          "Not Migrating \u2014 Drift team excluded from migration scope.",
        ],
        [
          "Drift-insights-api",
          "Drift-BXP",
          "Multi-source + Change Event Transformer",
          "Not Migrating \u2014 legacy Drift-BXP, maintenance status, excluded.",
        ],
      ]),

      spacer(),
      callout(
        "Sprint 0 CET requirement",
        "By end of Sprint 0: every in-scope CET must have a confirmed migration path. The DBE Critical Alerts transformer is the highest complexity \u2014 schedule a DBE engineer for Sprint 0 sign-off. The two Drift CETs are explicitly out of scope."
      ),

      spacer(),
      divider(),

      // ── STREAM 3 ─────────────────────────────────────────────────────────────
      streamBanner(3, "Configuring alert routing"),
      spacer(60),

      body("Stream 3 migrates Salesloft\u2019s on-call schedules, escalation policies, and routing logic into incident.io. The goal is one centralised alert route per team \u2014 simpler, more readable, and easier to maintain than PagerDuty\u2019s per-service routing key model."),

      spacer(),
      heading2("3.1  Import schedules and escalation policies"),

      numberedItem("Use the PagerDuty \u2192 incident.io connector to import all schedules and escalation policies for the 19 Salesloft teams."),
      numberedItem("Review each imported schedule: confirm timezone coverage (Salesloft has engineers across multiple timezones), verify rotation lengths, and reconcile any schedule overrides that were active in PD."),
      numberedItem("Escalation policies import as incident.io escalation paths. Verify step timing and fallback behaviour matches Salesloft\u2019s expectations."),
      numberedItem("Techops schedules and escalation paths must be validated before Sprint 1 begins \u2014 they are the pilot team."),

      spacer(),
      heading2("3.2  Global Orchestrations \u2014 Sprint 0"),

      body("Salesloft has 3 event orchestrations in PagerDuty. None are currently routing to services, but they represent routing logic that lives outside individual services and must be ported before any team migration begins."),

      spacer(),
      callout(
        "\u26A0  Global Orchestrations are a Sprint 0 requirement",
        "All 3 Salesloft event orchestrations must be reviewed and ported to incident.io alert routes during Sprint 0. Because orchestrations sit above service-level routing, any delay here creates a gap in alert coverage for every team. This is not a team-sprint deliverable \u2014 it is a pre-migration prerequisite."
      ),

      spacer(),
      bullet("For each orchestration: document the rule logic, trigger conditions, and destination (even if currently inactive)."),
      bullet("Port each orchestration to an incident.io alert route using Catalog-backed conditions."),
      bullet("Validate with a test alert in staging before Sprint 1."),

      spacer(),
      heading2("3.3  Centralised alert route"),

      body("Rather than one route per PagerDuty service (191 routes), incident.io uses a single centralised alert route with Catalog-based conditions. This is the primary architectural difference from PagerDuty and the key to long-term maintainability."),

      spacer(),
      bullet("Create a default alert route that routes all inbound alerts to the correct team based on Catalog attributes (service ownership or alert tag)."),
      bullet("Add team-specific conditions only when routing logic differs meaningfully from the default."),
      bullet("For Salesloft: expect one shared route covering the majority of services, with specific conditions for CETs and multi-source services like DBE Critical Alerts."),

      spacer(),
      heading2("3.4  Live Call Routing (LCR)"),

      body("Live Call Routing data has been collected as part of the pre-purchase analysis. LCR configuration is planned before purchase and migration is gated on the destination team\u2019s services being fully live on incident.io."),

      spacer(),
      twoColTable([
        ["LCR consideration", "Salesloft guidance"],
        ["Pre-purchase planning", "LCR requirements captured in PD analysis. Review with Salesloft on-call team leads to confirm phone number, escalation, and fallback preferences."],
        ["Migration gate", "A team\u2019s LCR cannot migrate until that team\u2019s services and schedules are live on incident.io and validated. Do not migrate LCR independently."],
        ["Pilot team (Techops)", "Validate Techops LCR configuration during Sprint 1 before enabling for remaining teams in Sprint 2."],
        ["Fallback during dual-run", "PagerDuty LCR remains active until each team\u2019s incident.io LCR is validated. No engineer is left without phone routing at any point."],
      ], 3000),

      spacer(),
      divider(),

      // ── STREAM 4 ─────────────────────────────────────────────────────────────
      streamBanner(4, "Migrating additional dependencies"),
      spacer(60),

      body("Stream 4 covers everything outside the core alert path: Terraform infrastructure, third-party integrations, and the service inventory itself. The principle is native replacements first, API migration second."),

      spacer(),
      heading2("4.1  Service migration approach"),

      body("Services are not migrated one-by-one during a team\u2019s sprint. They are populated early (Sprint 0 / pre-sprint) to identify structural issues, then validated and activated team by team."),

      spacer(),
      bullet("Sprint 0: Run the import script to create all 191 incident.io services from PagerDuty metadata. This is a read operation \u2014 no routing changes yet."),
      bullet("Early population surfaces: naming inconsistencies, missing team assignments, and services that warrant a native redesign (uncommon but should be identified before the team\u2019s sprint, not during)."),
      bullet("Teams that want to redesign their service structure native to incident.io should flag this in Sprint 0. Redesign happens before the team\u2019s sprint, not as a blocker to it."),
      bullet("During each team\u2019s sprint: validate the pre-populated services, confirm alert routing, and activate."),

      spacer(),
      heading2("4.2  Terraform"),

      body("incident.io maintains a Terraform provider for infrastructure-as-code management of your incident.io configuration. For Salesloft, Terraform handles the initial Catalog setup and can manage ongoing configuration after cutover."),

      spacer(),
      bullet("incident.io will provide a validated Terraform template for Salesloft\u2019s team and service structure."),
      bullet("Template covers: Catalog types (Teams, Applications), alert sources, and base escalation path configuration."),
      bullet("Salesloft\u2019s infra team should validate the template in a staging environment before applying to production."),
      bullet("Terraform state management: if Salesloft uses remote state (S3, Terraform Cloud), incident.io SA will coordinate state file location during Sprint 0."),

      spacer(),
      heading2("4.3  Third-party integrations"),

      body("Two third-party integrations require attention beyond standard alert source configuration:"),

      spacer(),
      bodyRuns([["FireHydrant webhook: ", { bold: true }], ["A FireHydrant webhook endpoint is active in the Salesloft PagerDuty account. Before Sprint 1: confirm whether FireHydrant is still in active use. If yes, coordinate with the FireHydrant team to point the webhook at incident.io. If not, deregister the webhook in PagerDuty before cutover to avoid phantom alerts.", {}]]),

      spacer(),
      bodyRuns([["Slack integration: ", { bold: true }], ["Salesloft\u2019s Support On-Call team uses a Slack \u2192 Event Transformer to generate PagerDuty incidents from Slack messages. The incident.io equivalent is a Slack alert source. The transformer logic (likely a simple field rename) should be confirmed during Sprint 0 CET scoping.", {}]]),

      spacer(),
      divider(),

      // ── STREAM 5 ─────────────────────────────────────────────────────────────
      streamBanner(5, "Preparing for onboarding"),
      spacer(60),

      body("Stream 5 is the final technical gate before user-facing cutover begins. The key step is decoupling Salesloft\u2019s Catalog from PagerDuty-backed objects, so that incident.io is the authoritative source of truth for team and service ownership."),

      spacer(),
      heading2("5.1  Catalog decoupling"),

      body("During the migration, Catalog entries for Teams and Services are initially seeded from PagerDuty data. Before cutover, these must be decoupled so that PagerDuty is no longer the source of truth."),

      spacer(),
      callout(
        "Catalog decoupling timing",
        "Decoupling happens gradually, team by team, as each team\u2019s sprint completes \u2014 not as a single global event at the end. Once a team\u2019s services are live and validated on incident.io, their Catalog entries are updated to reflect incident.io as the source of truth and the PagerDuty-backed references are removed. This approach reduces risk and allows immediate correction if issues arise."
      ),

      spacer(),
      bullet("For each team post-sprint: update Catalog team entries to remove PagerDuty team IDs and confirm incident.io service IDs are the canonical reference."),
      bullet("Verify that alert routes, escalation paths, and on-call schedules reference Catalog entries (not PagerDuty IDs) before removing the PD connection."),
      bullet("After all 19 teams have completed their sprints and Catalog is fully decoupled: sever the PagerDuty integration."),

      spacer(),
      heading2("5.2  Severing the PagerDuty integration"),

      body("The PagerDuty integration is severed only after all teams have completed cutover and Catalog decoupling is complete. This is a one-way operation \u2014 plan carefully."),

      spacer(),
      numberedItem("Confirm all 191 services are active on incident.io and have received at least one alert in the new system."),
      numberedItem("Confirm all schedules and escalation paths are live and have been used in at least one on-call rotation."),
      numberedItem("Communicate to all Salesloft engineers: PagerDuty routing is being disabled. Include a specific time and a rollback plan (if within hypercare window)."),
      numberedItem("Disable PagerDuty routing at the service level (not account deletion \u2014 retain PagerDuty account access for 30 days post-cutover for audit purposes)."),
      numberedItem("Monitor incident.io alert volume for 24 hours post-severance."),

      spacer(),
      divider(),

      // ── STREAM 6 ─────────────────────────────────────────────────────────────
      streamBanner(6, "User onboarding and cutover"),
      spacer(60),

      body("Stream 6 is the team-facing migration: training, dual-run, and cutover. Every team follows the same Test \u2192 Trial \u2192 Go-Live sequence. No engineer is left without paging coverage at any point."),

      spacer(),
      heading2("6.1  Cutover sequence: Test \u2192 Trial \u2192 Go-Live"),

      twoColTable([
        ["Phase", "What happens"],
        ["Test", "incident.io receives alerts in parallel with PagerDuty. Engineers receive no pages from incident.io yet. Used to validate alert routing, escalation paths, and Catalog enrichment. Typically 2\u20133 days per team."],
        ["Trial", "incident.io is the primary paging system. PagerDuty remains connected as a fallback \u2014 if an alert is missed in incident.io, PagerDuty catches it. Engineers install the mobile app and acknowledge their first real pages. Typically 3\u20135 days per team."],
        ["Go-Live", "PagerDuty routing disabled for this team. incident.io is the sole on-call system. Team is confirmed live."],
      ], 2000),

      spacer(),
      heading2("6.2  Sprint plan and team schedule"),

      sprintTable([
        ["Sprint", "Timeline", "Scope", "Exit criterion"],
        [
          "Sprint 0\n\u2605 Config",
          "Week 1\nApr 13\u201318",
          "Import services, schedules, EPs. Port all 3 Global Orchestrations. Scope all 4 in-scope CETs. Assign the 15 unassigned services. Resolve FireHydrant webhook. Validate Terraform template. Techops configs built and staged.",
          "All unknowns resolved. Techops ready. Global Orchestrations live. No unassigned services remain.",
        ],
        [
          "Sprint 1\nPilot",
          "Weeks 2\u20133\nApr 21 \u2013 May 2",
          "Techops (43 services) goes through Test \u2192 Trial \u2192 Go-Live. Engineers install mobile app and validate paging. CloudWatch CET resolved. Remaining 18 team configs pre-built and staged in parallel.",
          "Techops fully live. Zero missed pages. All Sprint 2 configs pre-validated.",
        ],
        [
          "\u2713 Sprint 2\nCutover",
          "Week 4\nMay 3\u20139",
          "All 18 remaining teams migrate: Deals, Little Five Endpoints, Wild Wild Data, Cloud9erz, Security, Analytics & Coaching, HSA, CCR, OMG, Conversation Intelligence, and 8 smaller teams. Each follows Test \u2192 Trial \u2192 Go-Live.",
          "All 191 services on incident.io. PagerDuty routing disabled. May 9 deadline met.",
        ],
      ]),

      spacer(),
      heading2("6.3  Team migration order (Sprint 2)"),

      body("Teams are migrated in order of service count and operational complexity. CETs are implemented in-sprint for the relevant team."),

      spacer(),

      twoColTable([
        ["Team", "Services  \u00B7  Sprint 2 week  \u00B7  Notes"],
        ["Deals", "24 services \u00B7 May 3\u20135"],
        ["Little Five Endpoints", "20 services \u00B7 May 3\u20135"],
        ["Wild Wild Data", "13 services \u00B7 May 5\u20136"],
        ["Cloud9erz", "11 services \u00B7 May 5\u20136"],
        ["HSA", "8 services \u00B7 May 6\u20137"],
        ["Conversation Intelligence", "8 services \u00B7 May 6\u20137"],
        ["Security Team", "7 services \u00B7 May 6\u20137  \u00B7  CloudWatch CET implemented this sprint"],
        ["Analytics and Coaching", "7 services \u00B7 May 7\u20138"],
        ["No Data Left Behind", "7 services \u00B7 May 7\u20138"],
        ["CCR", "6 services \u00B7 May 7\u20138"],
        ["OMG", "6 services \u00B7 May 7\u20138"],
        ["Workflow Pod", "5 services \u00B7 May 8\u20139"],
        ["Prospector Pod", "4 services \u00B7 May 8\u20139"],
        ["Support On-Call", "3 services \u00B7 May 8\u20139  \u00B7  Slack CET implemented this sprint"],
        ["DBE On-Call", "1 service \u00B7 May 8\u20139  \u00B7  DBE Critical Alerts CET implemented this sprint"],
        ["Lead IntelliAgent / RnB / Release Bot", "3 services \u00B7 May 8\u20139"],
      ], 2400),

      spacer(),
      heading2("6.4  Training and support"),

      bullet("incident.io will run a training session for each team before their cutover sprint. Sessions are 30\u201345 minutes, covering: mobile app setup, how to acknowledge and resolve incidents, how to use Slack-based incident commands, and escalation path validation."),
      bullet("Sessions are available across Salesloft\u2019s timezones \u2014 confirm engineer availability for each team\u2019s sprint week."),
      bullet("All engineers should have the incident.io mobile app installed and notifications configured before their team\u2019s Trial phase begins."),
      bullet("Slack channels: incident.io will post structured status updates to a designated Salesloft Slack channel throughout the migration."),

      spacer(),
      heading2("6.5  Hypercare and post-cutover"),

      body("Following the May 9 full cutover, incident.io provides a 2-week hypercare window:"),

      spacer(),
      bullet("Dedicated Slack channel with incident.io SA and CS for rapid-response support."),
      bullet("24-hour response SLA on any routing issues, missed alerts, or escalation path failures."),
      bullet("Weekly migration review calls through the hypercare period."),
      bullet("PagerDuty account remains connected (read-only) for 30 days post-cutover for audit and rollback reference. Routing is disabled, not the account."),

      spacer(),
      divider(),

      // ── Timeline Summary ─────────────────────────────────────────────────────
      heading1("Timeline at a glance"),

      body("All timelines are conservative estimates. incident.io\u2019s experience is that well-prepared teams move faster than projected \u2014 Sprint 0 completion and Techops pilot success are the primary signals for whether Sprint 2 can be compressed."),

      spacer(),

      twoColTable([
        ["Date", "Milestone"],
        ["Apr 13\u201318", "Sprint 0: Account setup, service import, CET scoping, Global Orchestrations ported, Techops staged"],
        ["Apr 21", "Sprint 1 begins: Techops Test phase starts"],
        ["Apr 28", "Techops Trial phase. Remaining team configs finalised."],
        ["May 2", "Techops Go-Live confirmed. Sprint 2 prep complete."],
        ["May 3", "Sprint 2 begins: Deals, Little Five Endpoints, Wild Wild Data enter Test phase"],
        ["May 5\u20137", "Rolling cutover: all remaining teams through Test \u2192 Trial \u2192 Go-Live"],
        ["May 9", "\u2705 Target: all 191 services live on incident.io. PagerDuty routing disabled."],
        ["May 9\u201323", "Hypercare window. Weekly syncs. Rapid-response Slack support."],
      ], 2000),

      spacer(),
      body("Note: Timeline assumes Salesloft team availability for Sprint 0 CET scoping and training sessions. Delays in CET sign-off (particularly DBE Critical Alerts) or late team assignment for the 15 unassigned services are the two most likely sources of schedule slip.", { italics: true, color: C.textGrey }),

      spacer(),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('/sessions/friendly-vigilant-ride/salesloft-migration-guide-2026-04-13.docx', buf);
  console.log('Done.');
}).catch(e => { console.error(e); process.exit(1); });

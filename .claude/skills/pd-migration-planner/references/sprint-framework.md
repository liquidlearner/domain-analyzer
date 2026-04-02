# Sprint Estimation Framework

All migration sprints are 3 weeks. Sprint 0 (Discovery) is 1 week.

---

## Real Migration Benchmarks

Ground all estimates in these real incident.io customer migrations before quoting timelines.
These are the actual numbers — use them to calibrate confidence.

| Customer | Size | Migration Time | Notes |
|----------|------|---------------|-------|
| 7shifts | 70 engineers | 2 weeks | Fast — small team, motivated champion, clean config |
| Trustly | 200 users | 6 weeks | Deadline-driven (OpsGenie contract expiry) |
| Starling Bank | Enterprise | Deadline-driven | Fast-tracked due to contract pressure |
| Mid-market (typical) | 50–150 teams | 3–5 months | Standard phased approach |
| Large enterprise (typical) | 150–300+ teams | 5–7 months | Multi-wave with dedicated integration sprints |

Key insight: **deadline pressure + executive sponsorship = fastest migrations.** When there's a contract renewal forcing a move, teams find a way. The 7shifts and Trustly cases both had external forcing functions. When framing timelines for procurement, ask: "Do you have a hard PD contract date?" If yes, compress accordingly and flag the parallel sprint option.

---

## Base Sprint Count (by active service count)

Active services are the migration scope. Stale services are archived, not migrated.

| Active Services | Base Sprints | Notes |
|----------------|--------------|-------|
| 1 – 25         | 3            | Small migration, can often run waves in parallel |
| 26 – 75        | 5            | Standard SMB/mid-market |
| 76 – 150       | 7            | Mid-market to enterprise |
| 151 – 300      | 9            | Enterprise — multi-wave needed |
| 301 – 500      | 11           | Large enterprise |
| 500+           | 13+          | Programmatic migration approach recommended |

These counts already include a foundation sprint and cutover sprint.

---

## Complexity Additions

Add these to the base count based on what's in the JSON:

| Signal | Addition | Notes |
|--------|----------|-------|
| ServiceNow (any depth) | +1 sprint | Integration migration and testing |
| ServiceNow deep (100+ webhooks) | +1 additional sprint | Parallel workstream needed |
| Complex incident workflows (any with 10+ steps) | +1 sprint per 2 workflows | Workshop + rebuild time |
| Automation actions (1–10) | +1 sprint | Mapping to Runbooks |
| Automation actions (11+) | +2 sprints | Larger runbook library |
| Unknown/custom webhook destinations | +1 sprint | Discovery + investigation before committing |
| Public status pages in use (public_total > 0) | +1 sprint | Content migration, subscriber list, custom domain, subscriber comms |
| Custom Event Transformers | +1 sprint | CETs need bespoke enrichment logic |
| Service event rules (many) | +1 sprint | Alert route mapping |
| Regulatory/compliance constraints | +1–2 sprints | Change management, audit trail sign-off |
| Hard deadline pressure | -1 (with risk) | Parallel waves, more resource-intensive |

---

## Timeline Compression: Parallel Sprints

If the customer has a hard deadline (e.g., PD contract renewal within 6 months), compression is available.
The default plan runs waves sequentially to minimise risk, but with additional resourcing:

- **Two wave teams can run simultaneously** — e.g., Wave 1 and Wave 2 can overlap with separate SE/customer
  engineering pairs if the teams are independent (no shared services or on-call dependencies)
- **Integration sprint can overlap with a migration wave** once the integration is proven in staging
- **Automation runbook sprint can be parallelised** with a late migration wave if separate engineers own it

When presenting a compressed plan to procurement, frame it as:

> "The standard plan is X sprints. If you need to be fully off PagerDuty by [date], we can run parallel
> workstreams — Wave 1 and Wave 2 simultaneously — which compresses the timeline to Y sprints with
> additional incident.io SE time allocated. Sprint 0 will confirm whether your team structure supports
> parallel waves safely."

Do not guarantee compression without Sprint 0 discovery confirming team independence.

---

## Standard Sprint Sequence

### Sprint 0 — Foundation & Discovery (1 week, not 3)

**Focus:** Set up the incident.io environment and identify any unknowns before committing to a final plan.

Sprint 0 is intentionally short. The goal is not to migrate anything — it's to prove the environment
works and lock the remaining sprint plan so procurement gets a firm commitment.

**Activities:**
- incident.io account provisioned, SSO/SCIM configured
- Terraform workspace scaffolded (repo, state backend, module structure)
- Pilot team selected (the simplest team: fewest services, cleanest escalation policy)
- All shadow integrations investigated — especially any unknown webhook destinations
- ServiceNow integration approach decided (migrate vs. retain vs. parallel run)
- Slack, Teams, and Zoom connection approach confirmed (via workflow steps)
- Migration wave plan finalized based on discovery findings

**End milestone:** _"incident.io environment live, integration strategy confirmed, pilot team ready to migrate — final sprint plan locked"_

---

### Sprint 1 — Pilot Wave (3 weeks)

**Focus:** Migrate 1–2 teams end-to-end to prove the migration pattern and build internal confidence.

Choose the simplest teams first: fewest active services, no complex integrations, ideally a team
that is already enthusiastic about the change.

**Activities:**
- Migrate pilot team's services, schedules, and escalation paths
- Validate alert routing (test alerts flowing through incident.io)
- Validate on-call and escalation (simulate an incident)
- First incident.io workflows configured (simple ones first)
- Dual-run period begins — PD still active for all other teams

**End milestone:** _"First [N] teams live on incident.io with proven alert-to-resolution flow. Dual-run confirmed stable."_

---

### Sprint 2–N — Migration Waves (3 weeks each)

Group teams into waves of 10–20 teams each. Wave size depends on team complexity and available
engineering bandwidth. Aim for self-contained groups (teams that work together or share services).

**Wave prioritization:**
- Wave 1: Simplest teams with fewest integrations — build momentum
- Wave 2–3: Mid-complexity teams — the bulk of the migration
- Later waves: Teams with ServiceNow dependencies or complex workflows (do these after the
  integration sprint, not before)

**Per wave, each sprint should include:**
- Service migration (alert sources, routing rules, catalog entries)
- On-call schedule and escalation path migration
- Team-specific workflow configuration
- Change management: team briefing, training session, feedback collection

**End milestone per wave:** _"[N] total teams live on incident.io ([X] active services migrated)"_

---

### Integration Sprint — ServiceNow and Major External Systems (3 weeks)

Run this sprint after the first 1–2 waves have proven the pattern, but before migrating
teams that depend on ServiceNow.

**Activities:**
- Configure incident.io ↔ ServiceNow integration (bidirectional sync)
- Map PD webhook behavior to incident.io Workflow actions
- Test P1/P2 automatic ticket creation
- Configure any analytics pipeline destinations (Datadog, Splunk, BigQuery, etc.)
- Validate all webhook destinations are accounted for (including previously unknown ones)

**End milestone:** _"ServiceNow bidirectional sync live and validated. All critical integrations confirmed working."_

---

### Major Incident Process Sprint (3 weeks)

If the account has complex "Declare Major Incident" or equivalent workflows (10+ steps),
give them a dedicated sprint. This is usually the most important process to get right and
the one that executives care most about.

**Activities:**
- Workshop: map the current PD workflow steps to incident.io Workflow steps
- Build and test the major incident workflow in incident.io
- War room / Slack / Teams channel setup validated
- Stakeholder notification flows tested
- Major incident runbook updated to reference incident.io

**End milestone:** _"Major incident declaration process live and tested in incident.io. Incident commanders signed off."_

---

### Automation Runbook Sprint (if automation actions present, 3 weeks)

**Activities:**
- Map each PD Automation Action to an incident.io Runbook
- Configure Runbook triggers (manual vs. automatic)
- Test each Runbook against a real or simulated incident
- Document Runbook catalog for the operations team

**End milestone:** _"[N] operational Runbooks live in incident.io. Automation coverage matches PagerDuty baseline."_

---

### Final Wave + Cutover Sprint (3 weeks)

**Activities:**
- Migrate remaining active services and teams
- Full regression test (all critical alert paths verified)
- Cutover decision gate: incident commanders and SRE leads sign off
- PagerDuty incident routing disabled (or set to forward to incident.io)
- Hypercare begins: incident.io SE available for rapid response for 2 weeks

**End milestone:** _"incident.io is the primary incident management platform. PagerDuty routing disabled."_

---

### Post-Cutover (not a sprint — 2–4 weeks)

- Stale service archival in PagerDuty (service catalog rationalization)
- PagerDuty decommission planning (or retention for specific use cases like LCR)
- Retrospective: what worked, what to document for future migrations
- PagerDuty contract termination / renewal decision

---

## Business Milestone Language

When presenting milestones to executives, use business outcomes not technical steps.
These phrasings work well:

| Sprint Event | Executive Language |
|-------------|-------------------|
| Foundation sprint complete | "incident.io environment provisioned and ready for team onboarding" |
| Pilot complete | "First engineering team fully live — incident response proven on new platform" |
| 50% of active services migrated | "Half of your on-call engineers are now on incident.io" |
| ServiceNow integration live | "IT ticketing integration confirmed — no change to ITSM process" |
| Major incident workflow live | "P1/P2 response process validated on incident.io by incident command team" |
| Full cutover | "PagerDuty routing disabled. incident.io is your incident management platform." |
| Hypercare complete | "Migration complete. PagerDuty contract can now be terminated." |

---

## Example Timeline: OrbitPay-scale Account

For an account with ~150 active services, 200+ teams, ServiceNow (250 webhooks),
2 complex major incident workflows, 14 automation actions, and 1 unknown webhook destination:

| Sprint | Duration | Theme | Milestone |
|--------|----------|-------|-----------|
| 0 | 1 week | Foundation & Discovery | Environment live; Heroku endpoint identified and assessed; final sprint plan locked |
| 1 | 3 weeks | Pilot (2 teams) | First teams live; dual-run stable |
| 2 | 3 weeks | Wave 1 (~15 teams) | 17 teams on incident.io |
| 3 | 3 weeks | ServiceNow Integration | PD→ServiceNow webhooks replaced with incident.io→ServiceNow |
| 4 | 3 weeks | Wave 2 (~20 teams) | 37 teams on incident.io; ServiceNow confirmed stable |
| 5 | 3 weeks | Major Incident Process | "Declare Major Incident" workflow live; incident commanders signed off |
| 6 | 3 weeks | Wave 3 (~25 teams) | 62 teams on incident.io |
| 7 | 3 weeks | Automation Runbooks (14 actions) | Full Runbook library live in incident.io |
| 8 | 3 weeks | Wave 4 — final active services | All 154 active services migrated |
| 9 | 3 weeks | Cutover | incident.io primary; PagerDuty routing disabled |
| +2 wks | 2 weeks | Hypercare | Stable; PD decommission planning begins |

**Total: ~7.5 months (Sprint 0 = 1 week + 9 × 3-week sprints + 2-week hypercare)**

With parallel sprints (if team structure allows): **compressible to 5–6 months.**

Range to quote: **9–11 sprints (28–34 weeks) for sequential. 7–8 sprints (22–25 weeks) if parallel waves.**

---

## Quoting the Timeline

Always give a range. The format that works well for procurement:

> "Based on your environment data, we estimate a **9–11 sprint migration (28–34 weeks)**.
> If you need to be off PagerDuty sooner — for example, to avoid a contract renewal — we can
> run parallel waves and compress to **22–25 weeks** with additional resourcing.
> The final timeline is confirmed in Sprint 0 (1 week) after we investigate [specific unknowns —
> e.g., the custom webhook destination, ServiceNow integration scope]. Sprint 0 results in a
> locked plan with firm sprint commitments."

This format does four things:
1. Gives a concrete number (not "several months")
2. Gives a range (honest about uncertainty)
3. Names the compression option (shows you've thought about deadline pressure)
4. Explains how the uncertainty gets resolved (Sprint 0) and when they get a committed plan

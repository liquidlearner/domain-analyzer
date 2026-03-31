import { router, protectedProcedure, seProcedure, adminProcedure } from "../trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { PagerDutyClient } from "@/server/services/pd/client";
import { encryptToken, decryptToken } from "@/server/db/encryption";
import { logAudit } from "@/server/services/audit";
import {
  connectDomainSchema,
  updateTokenSchema,
  validateConnectionSchema,
} from "@/lib/validators/domain";

export const domainRouter = router({
  /**
   * Connect a new PagerDuty domain
   * Only SA_SE and ADMIN users can connect domains
   */
  connect: seProcedure
    .input(connectDomainSchema)
    .mutation(async ({ ctx, input }) => {
      const { customerId, subdomain, apiToken } = input;

      // Verify the customer exists and user has access
      const customer = await ctx.prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Customer not found",
        });
      }

      // Verify user created the customer (unless they're admin)
      if (ctx.user.role !== "ADMIN" && customer.createdById !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to connect domains for this customer",
        });
      }

      // Check if domain already exists for this customer
      const existingDomain = await ctx.prisma.pdDomain.findFirst({
        where: {
          customerId,
          subdomain,
        },
      });

      if (existingDomain && existingDomain.status !== "DISCONNECTED") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A domain with this subdomain is already connected for this customer",
        });
      }

      // Validate the token with PD API
      const pdClient = new PagerDutyClient({ token: apiToken, subdomain });
      const validation = await pdClient.validateToken();

      if (!validation.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid PagerDuty API token: ${validation.error || "Unknown error"}`,
        });
      }

      // Extract last 4 characters of token for reference
      const tokenLast4 = apiToken.slice(-4);

      // Encrypt and store the token
      const encryptedToken = encryptToken(apiToken);

      // Create or update the domain — validation already passed above
      const domain = await ctx.prisma.pdDomain.upsert({
        where: {
          id: existingDomain?.id || "new",
        },
        update: {
          apiTokenEnc: encryptedToken,
          tokenLast4,
          status: "CONNECTED",
          lastValidated: new Date(),
        },
        create: {
          customerId,
          subdomain,
          apiTokenEnc: encryptedToken,
          tokenLast4,
          status: "CONNECTED",
          lastValidated: new Date(),
        },
      });

      // Log audit event
      await logAudit({
        userId: ctx.user.id,
        action: existingDomain ? "UPDATE_TOKEN" : "CONNECT_DOMAIN",
        entityType: "PdDomain",
        entityId: domain.id,
        metadata: {
          customerId,
          subdomain,
          tokenLast4,
        },
      });

      return {
        id: domain.id,
        customerId: domain.customerId,
        subdomain: domain.subdomain,
        status: domain.status,
        tokenLast4: domain.tokenLast4,
        connectedAt: domain.connectedAt,
      };
    }),

  /**
   * List domains for a customer
   * Users can only see domains for customers they created (unless admin)
   */
  list: protectedProcedure
    .input(
      z.object({
        customerId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const { customerId } = input;

      // Verify the customer exists
      const customer = await ctx.prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Customer not found",
        });
      }

      // Verify user has access (must be admin or the creator)
      if (ctx.user.role !== "ADMIN" && customer.createdById !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to view domains for this customer",
        });
      }

      const domains = await ctx.prisma.pdDomain.findMany({
        where: {
          customerId,
        },
        select: {
          id: true,
          customerId: true,
          subdomain: true,
          status: true,
          tokenLast4: true,
          connectedAt: true,
          lastValidated: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return domains;
    }),

  /**
   * Get a single domain by ID with config snapshot summary
   */
  getById: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const { id } = input;

      const domain = await ctx.prisma.pdDomain.findUnique({
        where: { id },
        include: {
          customer: true,
        },
      });

      if (!domain) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Domain not found",
        });
      }

      // Verify user has access
      if (
        ctx.user.role !== "ADMIN" &&
        domain.customer.createdById !== ctx.user.id
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to view this domain",
        });
      }

      // Get latest config snapshot
      const latestSnapshot = await ctx.prisma.configSnapshot.findFirst({
        where: { domainId: id },
        orderBy: { capturedAt: "desc" },
        take: 1,
        include: {
          resources: {
            select: {
              id: true,
              pdType: true,
              pdId: true,
              name: true,
              teamIds: true,
              isStale: true,
              lastActivity: true,
              dependencies: true,
              // Omit configJson — too heavy for listing (2-5KB per resource)
            },
          },
        },
      });

      let resourceCounts: Record<string, number> = {};
      let resources: Array<{
        id: string;
        pdType: string;
        pdId: string;
        name: string;
        teamIds: string[];
        isStale: boolean;
        lastActivity: Date | null;
        dependencies: string[];
      }> = [];
      if (latestSnapshot && typeof latestSnapshot.resourceCounts === "object") {
        resourceCounts = latestSnapshot.resourceCounts as Record<string, number>;
      }
      if (latestSnapshot && Array.isArray(latestSnapshot.resources)) {
        resources = latestSnapshot.resources;
      }

      return {
        id: domain.id,
        customerId: domain.customerId,
        subdomain: domain.subdomain,
        status: domain.status,
        tokenLast4: domain.tokenLast4,
        connectedAt: domain.connectedAt,
        lastValidated: domain.lastValidated,
        createdAt: domain.createdAt,
        updatedAt: domain.updatedAt,
        latestSnapshot: latestSnapshot
          ? {
              capturedAt: latestSnapshot.capturedAt,
              resourceCounts,
              resources,
            }
          : null,
      };
    }),

  /**
   * Update a domain's API token
   */
  updateToken: seProcedure
    .input(updateTokenSchema)
    .mutation(async ({ ctx, input }) => {
      const { domainId, apiToken } = input;

      const domain = await ctx.prisma.pdDomain.findUnique({
        where: { id: domainId },
        include: {
          customer: true,
        },
      });

      if (!domain) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Domain not found",
        });
      }

      // Verify user has access
      if (
        ctx.user.role !== "ADMIN" &&
        domain.customer.createdById !== ctx.user.id
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to update this domain",
        });
      }

      // Validate the new token
      const pdClient = new PagerDutyClient({
        token: apiToken,
        subdomain: domain.subdomain,
      });
      const validation = await pdClient.validateToken();

      if (!validation.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid PagerDuty API token: ${validation.error || "Unknown error"}`,
        });
      }

      // Encrypt and update
      const encryptedToken = encryptToken(apiToken);
      const tokenLast4 = apiToken.slice(-4);

      const updated = await ctx.prisma.pdDomain.update({
        where: { id: domainId },
        data: {
          apiTokenEnc: encryptedToken,
          tokenLast4,
          lastValidated: new Date(),
        },
      });

      // Log audit event
      await logAudit({
        userId: ctx.user.id,
        action: "UPDATE_TOKEN",
        entityType: "PdDomain",
        entityId: domainId,
        metadata: {
          tokenLast4,
        },
      });

      return {
        id: updated.id,
        tokenLast4: updated.tokenLast4,
        lastValidated: updated.lastValidated,
      };
    }),

  /**
   * Validate an existing connection by testing the token
   */
  validateConnection: protectedProcedure
    .input(validateConnectionSchema)
    .mutation(async ({ ctx, input }) => {
      const { domainId } = input;

      const domain = await ctx.prisma.pdDomain.findUnique({
        where: { id: domainId },
        include: {
          customer: true,
        },
      });

      if (!domain) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Domain not found",
        });
      }

      // Verify user has access
      if (
        ctx.user.role !== "ADMIN" &&
        domain.customer.createdById !== ctx.user.id
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to validate this domain",
        });
      }

      // Decrypt token and test
      let decryptedToken: string;
      try {
        decryptedToken = decryptToken(domain.apiTokenEnc);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Failed to decrypt API token. Try updating the token or reconnecting the domain.",
        });
      }
      const pdClient = new PagerDutyClient({
        token: decryptedToken,
        subdomain: domain.subdomain,
      });

      const validation = await pdClient.validateToken();

      if (!validation.valid) {
        // Update status to invalid
        await ctx.prisma.pdDomain.update({
          where: { id: domainId },
          data: {
            status: "INVALID",
          },
        });

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Token validation failed: ${validation.error || "Unknown error"}`,
        });
      }

      // Update lastValidated timestamp
      const updated = await ctx.prisma.pdDomain.update({
        where: { id: domainId },
        data: {
          lastValidated: new Date(),
          status: "CONNECTED",
        },
      });

      // Log audit event
      await logAudit({
        userId: ctx.user.id,
        action: "VALIDATE_CONNECTION",
        entityType: "PdDomain",
        entityId: domainId,
        metadata: {
          valid: true,
        },
      });

      return {
        id: updated.id,
        status: updated.status,
        lastValidated: updated.lastValidated,
      };
    }),

  /**
   * Sync PagerDuty config: pull all resources and create a config snapshot.
   * Runs synchronously (no Inngest required).
   */
  syncConfig: seProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { domainId } = input;

      const domain = await ctx.prisma.pdDomain.findUnique({
        where: { id: domainId },
        include: { customer: true },
      });

      if (!domain) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Domain not found",
        });
      }

      if (
        ctx.user.role !== "ADMIN" &&
        domain.customer.createdById !== ctx.user.id
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to sync this domain",
        });
      }

      let token: string;
      try {
        token = decryptToken(domain.apiTokenEnc);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Failed to decrypt API token. The token may need to be re-entered. " +
            "Try updating the token or reconnecting the domain.",
        });
      }
      const pdClient = new PagerDutyClient({
        token,
        subdomain: domain.subdomain,
      });

      // Validate token first
      const validation = await pdClient.validateToken();
      if (!validation.valid) {
        await ctx.prisma.pdDomain.update({
          where: { id: domainId },
          data: { status: "INVALID" },
        });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Token validation failed: ${validation.error}`,
        });
      }

      // Pull all config/structure resource types from PD
      // NOTE: No incidents are pulled here. Incident data is pulled during
      // analysis (Module 2) when the user selects scope + time window.
      const [
        services,
        rawTeams,
        schedules,
        escalationPolicies,
        users,
        businessServices,
        rulesets,
        eventOrchestrations,
        extensions,
        webhookSubscriptions,
        incidentWorkflowsList,
        slackConnections,
        automationActions,
        automationRunners,
        serviceDependencies,
      ] = await Promise.all([
        pdClient.listServices(),
        pdClient.listTeams(),
        pdClient.listSchedules(),
        pdClient.listEscalationPolicies(),
        pdClient.listUsers(),
        pdClient.listBusinessServices(),
        pdClient.getRulesets(),
        pdClient.listEventOrchestrations(),
        pdClient.listExtensions().catch(() => []),
        pdClient.listWebhookSubscriptions(),
        pdClient.listIncidentWorkflows(),
        pdClient.getSlackConnections(),
        pdClient.listAutomationActions(),
        pdClient.listAutomationRunners(),
        pdClient.listServiceDependencies(),
      ]);

      // Enrich teams with member roles (batched, 10 concurrent)
      console.log(`[Sync Config] Fetching members for ${rawTeams.length} teams...`);
      const teams = await pdClient.enrichTeamsWithMembers(rawTeams);

      // Build technical service dependency map for folding into service records
      const techDepMap = new Map<string, { dependsOn: string[]; dependedOnBy: string[] }>();
      for (const dep of serviceDependencies) {
        const depId = dep.dependent_service.id;
        const supId = dep.supporting_service.id;
        if (!techDepMap.has(depId)) techDepMap.set(depId, { dependsOn: [], dependedOnBy: [] });
        if (!techDepMap.has(supId)) techDepMap.set(supId, { dependsOn: [], dependedOnBy: [] });
        techDepMap.get(depId)!.dependsOn.push(supId);
        techDepMap.get(supId)!.dependedOnBy.push(depId);
      }

      // Enrich business services with their supporting technical services (batched)
      console.log(`[Sync Config] Fetching dependencies for ${businessServices.length} business services...`);
      const bsDepsResults = await Promise.allSettled(
        businessServices.map((bs) => pdClient.getBusinessServiceDependencies(bs.id))
      );
      const bsDepsMap = new Map<string, string[]>();
      businessServices.forEach((bs, i) => {
        const r = bsDepsResults[i];
        const supportingIds = r.status === "fulfilled"
          ? r.value.map((d) => d.supporting_service.id)
          : [];
        bsDepsMap.set(bs.id, supportingIds);
      });

      // Fetch full detail (steps + triggers) for each workflow
      // The list endpoint does NOT return steps/triggers — must fetch individually
      console.log(`[Sync Config] Fetching details for ${incidentWorkflowsList.length} workflows...`);
      const workflowDetailResults = await Promise.allSettled(
        incidentWorkflowsList.map((wf) => pdClient.getIncidentWorkflowDetail(wf.id))
      );

      const incidentWorkflows = incidentWorkflowsList.map((wf, i) => {
        const detail = workflowDetailResults[i];
        if (detail.status === 'fulfilled' && detail.value) {
          const d = detail.value;
          console.log(`[Sync Config] Workflow "${wf.name}" (${wf.id}): ${d.steps?.length ?? 0} steps, ${d.triggers?.length ?? 0} triggers`);
          if (d.steps && d.steps.length > 0) {
            const actionIds = d.steps.map((s: any) => s.action_configuration?.action_id).filter(Boolean);
            console.log(`[Sync Config]   action_ids: ${actionIds.join(', ')}`);
          }
          return { ...wf, steps: d.steps, triggers: d.triggers };
        }
        if (detail.status === 'rejected') {
          console.warn(`[Sync Config] Workflow "${wf.name}" detail fetch rejected:`, (detail as PromiseRejectedResult).reason);
        } else {
          console.warn(`[Sync Config] Workflow "${wf.name}" detail fetch returned null`);
        }
        return wf;
      });

      const withSteps = incidentWorkflows.filter(wf => wf.steps && wf.steps.length > 0);
      console.log(`[Sync Config] Workflow enrichment: ${withSteps.length}/${incidentWorkflows.length} workflows have steps`);

      // Fetch invocation history for each automation action (parallel, capped)
      console.log(`[Sync Config] Fetching invocations for ${automationActions.length} automation actions...`);
      const invocationResults = await Promise.allSettled(
        automationActions.map((action) =>
          pdClient.getAutomationActionInvocations(action.id, 5000)
        )
      );

      // Build enriched automation action data with invocation summaries
      const enrichedAutomationActions = automationActions.map((action, i) => {
        const invResult = invocationResults[i];
        const invocations = invResult.status === 'fulfilled' ? invResult.value : [];

        // Count invocations by source type
        const sourceCounts: Record<string, number> = {};
        const stateCounts: Record<string, number> = {};
        const monthlyCounts: Record<string, number> = {};

        for (const inv of invocations) {
          const agentType = inv.metadata?.agent?.type || 'unknown';
          sourceCounts[agentType] = (sourceCounts[agentType] || 0) + 1;

          const state = inv.state || 'unknown';
          stateCounts[state] = (stateCounts[state] || 0) + 1;

          // Monthly bucketing
          const timing = inv.timing || [];
          for (const t of timing) {
            if (t.state === 'created' && t.creation_timestamp) {
              const month = t.creation_timestamp.slice(0, 7); // YYYY-MM
              monthlyCounts[month] = (monthlyCounts[month] || 0) + 1;
              break;
            }
          }
        }

        console.log(`[Sync Config]   Action "${action.name}": ${invocations.length} invocations`);

        return {
          ...action,
          _invocationCount: invocations.length,
          _sourceCounts: sourceCounts,
          _stateCounts: stateCounts,
          _monthlyCounts: monthlyCounts,
        };
      });

      // Build resource records with full PD config stored per resource
      type ResourceEntry = {
        pdId: string;
        type: string;
        name: string;
        teamIds: string[];
        dependencies: string[];
        configJson: Record<string, any>;
      };
      const resources: Record<string, ResourceEntry> = {};

      for (const s of services) {
        const techDeps = techDepMap.get(s.id);
        resources[s.id] = {
          pdId: s.id,
          type: "SERVICE",
          name: s.name || "",
          teamIds: s.teams?.map((t) => t.id) || [],
          dependencies: s.escalation_policy?.id ? [s.escalation_policy.id] : [],
          configJson: {
            ...s,
            _dependsOn: techDeps?.dependsOn ?? [],
            _dependedOnBy: techDeps?.dependedOnBy ?? [],
          },
        };
      }
      for (const t of teams) {
        resources[t.id] = {
          pdId: t.id,
          type: "TEAM",
          name: t.name || "",
          teamIds: [t.id],
          dependencies: [],
          configJson: t,
        };
      }
      for (const sch of schedules) {
        resources[sch.id] = {
          pdId: sch.id,
          type: "SCHEDULE",
          name: sch.name || "",
          teamIds: sch.teams?.map((t) => t.id) || [],
          dependencies: [],
          configJson: sch,
        };
      }
      for (const ep of escalationPolicies) {
        const deps: string[] = [];
        if (ep.escalation_rules) {
          for (const rule of ep.escalation_rules) {
            if (rule.targets) {
              for (const target of rule.targets) {
                if (target.type === "schedule_reference" && target.id) {
                  deps.push(target.id);
                }
              }
            }
          }
        }
        resources[ep.id] = {
          pdId: ep.id,
          type: "ESCALATION_POLICY",
          name: ep.name || "",
          teamIds: ep.teams?.map((t) => t.id) || [],
          dependencies: deps,
          configJson: ep,
        };
      }
      for (const u of users) {
        resources[u.id] = {
          pdId: u.id,
          type: "USER",
          name: u.name || "",
          teamIds: (u as any).teams?.map((t: any) => t.id) || [],
          dependencies: [],
          configJson: u,
        };
      }
      for (const bs of businessServices) {
        const supportingIds = bsDepsMap.get(bs.id) ?? [];
        resources[bs.id] = {
          pdId: bs.id,
          type: "BUSINESS_SERVICE",
          name: bs.name || "",
          teamIds: [],
          dependencies: supportingIds,
          configJson: {
            ...bs,
            _supportingServices: supportingIds,
          },
        };
      }
      for (const rs of rulesets) {
        resources[rs.id] = {
          pdId: rs.id,
          type: "RULESET",
          name: rs.name || "",
          teamIds: rs.teams?.map((t) => t.id) || [],
          dependencies: [],
          configJson: rs,
        };
      }
      // Pull orchestration router rules in parallel (reveals dynamic routing to services)
      const eoRouterResults = await Promise.allSettled(
        eventOrchestrations.map((eo) => pdClient.getOrchestrationRouter(eo.id))
      );

      for (let i = 0; i < eventOrchestrations.length; i++) {
        const eo = eventOrchestrations[i];
        const routerResult = eoRouterResults[i];
        const routerRules = routerResult.status === 'fulfilled' ? routerResult.value : null;

        // Extract service IDs that this orchestration routes to
        // PD API returns route_to in multiple formats:
        //   - Static: route_to: "SERVICE_ID" (plain string)
        //   - Static nested: route_to: { service: { id: "SERVICE_ID" } }
        //   - Dynamic: dynamic_route_to: { lookup_by, regex, source }
        const routedServiceIds: string[] = [];
        let dynamicRouteCount = 0;
        let staticRouteCount = 0;

        const extractRouteToServiceId = (actions: any): string | null => {
          if (!actions) return null;
          const routeTo = actions.route_to;
          if (!routeTo || routeTo === 'unrouted') return null;
          // Plain string service ID
          if (typeof routeTo === 'string') return routeTo;
          // Nested object { service: { id: "..." } }
          if (routeTo?.service?.id) return routeTo.service.id;
          // Direct ID field
          if (routeTo?.id) return routeTo.id;
          return null;
        };

        if (routerRules?.sets) {
          for (const set of routerRules.sets) {
            for (const rule of (set.rules || [])) {
              // Check for dynamic routing
              if (rule?.actions?.dynamic_route_to) {
                dynamicRouteCount++;
              }
              // Check for static routing
              const serviceId = extractRouteToServiceId(rule?.actions);
              if (serviceId) {
                routedServiceIds.push(serviceId);
                staticRouteCount++;
              }
            }
          }
        }
        // Also check catch_all
        const catchAllServiceId = extractRouteToServiceId(routerRules?.catch_all?.actions);
        if (catchAllServiceId) {
          routedServiceIds.push(catchAllServiceId);
          staticRouteCount++;
        }

        const totalRuleCount = (routerRules?.sets || []).reduce(
          (n: number, s: any) => n + (s.rules?.length || 0), 0
        );

        resources[eo.id] = {
          pdId: eo.id,
          type: "EVENT_ORCHESTRATION",
          name: eo.name || "",
          teamIds: eo.team?.id ? [eo.team.id] : [],
          dependencies: routedServiceIds, // Services this EO routes to
          configJson: {
            ...eo,
            _routerRules: routerRules,
            _routedServiceIds: routedServiceIds,
            _dynamicRouteCount: dynamicRouteCount,
            _staticRouteCount: staticRouteCount,
            _totalRuleCount: totalRuleCount,
          },
        };
      }

      // Add extensions (ServiceNow, Slack, JIRA, MS Teams, etc.)
      for (const ext of extensions) {
        const extServiceIds = (ext.extension_objects || [])
          .filter((eo: any) => eo.type === 'service_reference')
          .map((eo: any) => eo.id);
        resources[ext.id] = {
          pdId: ext.id,
          type: "EXTENSION",
          name: ext.name || ext.extension_schema?.summary || 'Extension',
          teamIds: [],
          dependencies: extServiceIds,
          configJson: {
            extension_schema: ext.extension_schema,
            endpoint_url: ext.endpoint_url,
            extension_objects: ext.extension_objects,
            temporarily_disabled: ext.temporarily_disabled,
          },
        };
      }

      // Add webhook subscriptions
      for (const wh of webhookSubscriptions) {
        resources[wh.id] = {
          pdId: wh.id,
          type: "WEBHOOK_SUBSCRIPTION",
          name: wh.description || `Webhook → ${wh.delivery_method?.url || 'unknown'}`,
          teamIds: [],
          dependencies: wh.filter?.id ? [wh.filter.id] : [],
          configJson: {
            delivery_method: wh.delivery_method,
            events: wh.events,
            filter: wh.filter,
            active: wh.active,
          },
        };
      }

      // Add incident workflows with full step/trigger detail for integration detection
      for (const wf of incidentWorkflows) {
        resources[wf.id] = {
          pdId: wf.id,
          type: "INCIDENT_WORKFLOW",
          name: wf.name || 'Incident Workflow',
          teamIds: wf.team?.id ? [wf.team.id] : [],
          dependencies: [],
          configJson: {
            steps: wf.steps || [],
            triggers: (wf as any).triggers || [],
            team: wf.team,
            description: wf.description,
            _slackConnections: slackConnections.length > 0 ? slackConnections : undefined,
          },
        };
      }

      // Add automation actions with invocation data
      for (const action of enrichedAutomationActions) {
        resources[action.id] = {
          pdId: action.id,
          type: "AUTOMATION_ACTION",
          name: action.name || 'Automation Action',
          teamIds: [],
          dependencies: action.services?.map((s: any) => s.id) || [],
          configJson: {
            action_type: action.action_type,
            runner_type: action.runner_type,
            runner: action.runner,
            description: action.description,
            creation_time: action.creation_time,
            last_run: action.last_run,
            last_run_by: action.last_run_by,
            allow_invocation_manually: action.allow_invocation_manually,
            allow_invocation_from_event_orchestration: action.allow_invocation_from_event_orchestration,
            map_to_all_services: action.map_to_all_services,
            action_data_reference: action.action_data_reference,
            services: action.services,
            _invocationCount: action._invocationCount,
            _sourceCounts: action._sourceCounts,
            _stateCounts: action._stateCounts,
            _monthlyCounts: action._monthlyCounts,
          },
        };
      }

      // Add automation runners
      for (const runner of automationRunners) {
        resources[runner.id] = {
          pdId: runner.id,
          type: "AUTOMATION_RUNNER",
          name: runner.name || 'Automation Runner',
          teamIds: [],
          dependencies: [],
          configJson: {
            runner_type: runner.runner_type,
            status: runner.status,
            description: runner.description,
            last_seen: runner.last_seen,
            creation_time: runner.creation_time,
          },
        };
      }

      // Build resource counts
      const resourceCounts: Record<string, number> = {
        SERVICE: services.length,
        TEAM: teams.length,
        SCHEDULE: schedules.length,
        ESCALATION_POLICY: escalationPolicies.length,
        USER: users.length,
        BUSINESS_SERVICE: businessServices.length,
        RULESET: rulesets.length,
        EVENT_ORCHESTRATION: eventOrchestrations.length,
        EXTENSION: extensions.length,
        WEBHOOK_SUBSCRIPTION: webhookSubscriptions.length,
        INCIDENT_WORKFLOW: incidentWorkflows.length,
        AUTOMATION_ACTION: automationActions.length,
        AUTOMATION_RUNNER: automationRunners.length,
      };

      // Store snapshot — resourcesJson contains the full indexed config map
      const snapshot = await ctx.prisma.configSnapshot.create({
        data: {
          domainId,
          capturedAt: new Date(),
          terraformState: Buffer.from(JSON.stringify({ placeholder: true })),
          resourcesJson: Buffer.from(JSON.stringify(resources)),
          resourceCounts,
          staleResources: {}, // Staleness is determined during analysis, not config sync
          status: "COMPLETED",
        },
      });

      // Create individual PdResource records in batches for performance
      const CHUNK_SIZE = 500;
      const resourceEntries = Object.values(resources);
      for (let i = 0; i < resourceEntries.length; i += CHUNK_SIZE) {
        await ctx.prisma.pdResource.createMany({
          data: resourceEntries.slice(i, i + CHUNK_SIZE).map((resource) => ({
            snapshotId: snapshot.id,
            pdType: resource.type as any,
            pdId: resource.pdId,
            name: resource.name,
            teamIds: resource.teamIds,
            configJson: Buffer.from(JSON.stringify(resource.configJson)),
            isStale: false,
            dependencies: resource.dependencies,
          })),
        });
      }

      // Update domain validation timestamp
      await ctx.prisma.pdDomain.update({
        where: { id: domainId },
        data: { lastValidated: new Date() },
      });

      await logAudit({
        userId: ctx.user.id,
        action: "SYNC_CONFIG",
        entityType: "PdDomain",
        entityId: domainId,
        metadata: {
          resourceCounts,
          snapshotId: snapshot.id,
        },
      });

      return {
        snapshotId: snapshot.id,
        resourceCounts,
      };
    }),

  /**
   * Soft delete a domain (disconnect it)
   */
  disconnect: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id } = input;

      const domain = await ctx.prisma.pdDomain.findUnique({
        where: { id },
      });

      if (!domain) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Domain not found",
        });
      }

      // Soft delete by setting status to DISCONNECTED
      const updated = await ctx.prisma.pdDomain.update({
        where: { id },
        data: {
          status: "DISCONNECTED",
        },
      });

      // Log audit event
      await logAudit({
        userId: ctx.user.id,
        action: "DISCONNECT_DOMAIN",
        entityType: "PdDomain",
        entityId: id,
        metadata: {
          subdomain: domain.subdomain,
          customerId: domain.customerId,
        },
      });

      return {
        id: updated.id,
        status: updated.status,
      };
    }),
});

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
        include: { resources: true },
      });

      let resourceCounts: Record<string, number> = {};
      let resources: Array<{
        id: string;
        snapshotId: string;
        pdType: string;
        pdId: string;
        name: string;
        teamIds: string[];
        configJson: Uint8Array;
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
        teams,
        schedules,
        escalationPolicies,
        users,
        businessServices,
        rulesets,
        eventOrchestrations,
      ] = await Promise.all([
        pdClient.listServices(),
        pdClient.listTeams(),
        pdClient.listSchedules(),
        pdClient.listEscalationPolicies(),
        pdClient.listUsers(),
        pdClient.listBusinessServices(),
        pdClient.getRulesets(),
        pdClient.listEventOrchestrations(),
      ]);

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
        resources[s.id] = {
          pdId: s.id,
          type: "SERVICE",
          name: s.name || "",
          teamIds: s.teams?.map((t) => t.id) || [],
          dependencies: s.escalation_policy?.id ? [s.escalation_policy.id] : [],
          configJson: s,
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
        resources[bs.id] = {
          pdId: bs.id,
          type: "BUSINESS_SERVICE",
          name: bs.name || "",
          teamIds: [],
          dependencies: [],
          configJson: bs,
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
      for (const eo of eventOrchestrations) {
        resources[eo.id] = {
          pdId: eo.id,
          type: "EVENT_ORCHESTRATION",
          name: eo.name || "",
          teamIds: eo.team?.id ? [eo.team.id] : [],
          dependencies: [],
          configJson: eo,
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

      // Create individual PdResource records with full PD config stored
      // Use createMany for performance on large domains
      const resourceEntries = Object.values(resources);
      const BATCH_SIZE = 50;
      for (let i = 0; i < resourceEntries.length; i += BATCH_SIZE) {
        const batch = resourceEntries.slice(i, i + BATCH_SIZE);
        await ctx.prisma.pdResource.createMany({
          data: batch.map((resource) => ({
            snapshotId: snapshot.id,
            pdType: resource.type as any,
            pdId: resource.pdId,
            name: resource.name,
            teamIds: resource.teamIds,
            configJson: Buffer.from(JSON.stringify(resource.configJson)),
            isStale: false, // Determined during analysis
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

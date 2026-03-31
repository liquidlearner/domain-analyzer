import { z } from 'zod'
import { router, protectedProcedure, seProcedure, adminProcedure } from '../trpc'
import { prisma } from '@/server/db/client'
import { TRPCError } from '@trpc/server'
import { runEvaluationAnalysis } from '@/server/services/evaluation-runner'
import { decompressJson } from '@/lib/compression'

// Input validators
const createEvaluationInput = z.object({
  domainId: z.string().cuid(),
  scopeType: z.enum(['TEAM', 'SERVICE']),
  scopeIds: z.array(z.string()),
  timeRangeDays: z.enum(['1', '7', '30', '90', '365']).default('30'),
  isFullDomain: z.boolean().optional().default(false),
  configOnly: z.boolean().optional().default(false),
})

const evaluationIdInput = z.object({
  id: z.string().cuid(),
})

const listEvaluationsInput = z.object({
  domainId: z.string().cuid().optional(),
})

export const evaluationRouter = router({
  /**
   * Create a new evaluation and trigger analysis directly
   */
  create: seProcedure
    .input(createEvaluationInput)
    .mutation(async ({ ctx, input }) => {
      const { domainId, scopeType, scopeIds, timeRangeDays, isFullDomain, configOnly } = input

      // Verify domain exists and user has access
      const domain = await prisma.pdDomain.findUnique({
        where: { id: domainId },
        include: {
          customer: true,
        },
      })

      if (!domain) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Domain not found',
        })
      }

      // For full domain or config-only analysis, resolve all service IDs from the latest snapshot
      let resolvedScopeIds = scopeIds
      if (isFullDomain || configOnly) {
        const latestSnapshot = await prisma.configSnapshot.findFirst({
          where: { domainId, status: 'COMPLETED' },
          orderBy: { capturedAt: 'desc' },
          select: { id: true },
        })
        if (!latestSnapshot) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'No config snapshot found. Run a config sync first.',
          })
        }
        const allServices = await prisma.pdResource.findMany({
          where: { snapshotId: latestSnapshot.id, pdType: 'SERVICE' },
          select: { pdId: true },
        })
        if (allServices.length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'No services found in config snapshot.',
          })
        }
        resolvedScopeIds = allServices.map((s) => s.pdId)
      } else if (resolvedScopeIds.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Please select at least one team or service.',
        })
      }

      // Create evaluation with time range
      const evaluation = await prisma.evaluation.create({
        data: {
          domainId,
          createdById: ctx.user.id,
          scopeType: (isFullDomain || configOnly) ? 'SERVICE' : scopeType,
          scopeIds: resolvedScopeIds,
          timeRangeDays: parseInt(timeRangeDays, 10),
          isFullDomain,
          configOnly,
          status: 'PENDING',
        },
      })

      // Fire-and-forget: start the analysis directly (no Inngest needed)
      runEvaluationAnalysis(evaluation.id).catch((err) => {
        console.error('Evaluation analysis failed:', err)
      })

      return evaluation
    }),

  /**
   * List evaluations, optionally filtered by domain
   */
  list: protectedProcedure
    .input(listEvaluationsInput)
    .query(async ({ input }) => {
      const { domainId } = input

      const evaluations = await prisma.evaluation.findMany({
        where: domainId ? { domainId } : undefined,
        include: {
          domain: true,
          createdBy: true,
          incidentAnalyses: {
            take: 1,
            orderBy: { periodStart: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      return evaluations
    }),

  /**
   * Get evaluation by ID with full details
   */
  getById: protectedProcedure
    .input(evaluationIdInput)
    .query(async ({ ctx, input }) => {
      const { id } = input

      const evaluation = await prisma.evaluation.findUnique({
        where: { id },
        include: {
          domain: true,
          createdBy: true,
          configSnapshot: {
            include: {
              resources: {
                select: {
                  id: true,
                  pdType: true,
                  pdId: true,
                  name: true,
                  teamIds: true,
                  isStale: true,
                  dependencies: true,
                  // Omit configJson — it's huge and not needed for display
                },
              },
            },
          },
          incidentAnalyses: {
            take: 1,
            orderBy: { periodStart: 'desc' },
          },
          migrationMappings: {
            include: {
              pdResource: {
                select: {
                  id: true,
                  pdType: true,
                  pdId: true,
                  name: true,
                  teamIds: true,
                  // Omit configJson and snapshot — too heavy for listing
                },
              },
            },
          },
        },
      })

      if (!evaluation) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Evaluation not found',
        })
      }

      // Access control: user can only view evaluations they created or if admin
      if (
        ctx.user.role !== 'ADMIN' &&
        evaluation.createdById !== ctx.user.id
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to view this evaluation',
        })
      }

      return evaluation
    }),

  /**
   * Get deserialized analysis data for a completed evaluation.
   * Reads sourcesJson + patternsJson from IncidentAnalysis and returns typed JSON
   * so the client never has to handle raw Bytes.
   */
  getAnalysisData: protectedProcedure
    .input(evaluationIdInput)
    .query(async ({ input }) => {
      const { id } = input

      const analysis = await prisma.incidentAnalysis.findFirst({
        where: { evaluationId: id },
        orderBy: { periodStart: 'desc' },
      })

      if (!analysis) return null

      let sourcesData: any = {}
      let patternsData: any = {}

      try {
        sourcesData = decompressJson(analysis.sourcesJson)
      } catch {
        // sourcesJson parse failed
      }

      try {
        patternsData = decompressJson(analysis.patternsJson)
      } catch {
        // patternsJson parse failed
      }

      return {
        volume: sourcesData.volume || null,
        sources: sourcesData.sources || null,
        risk: sourcesData.risk || null,
        shadowStack: sourcesData.shadowStack || null,
        projectPlan: sourcesData.projectPlan || null,
        noise: patternsData,
        scopedCounts: sourcesData.scopedCounts || null,
        meta: {
          incidentCount: analysis.incidentCount,
          alertCount: analysis.alertCount,
          noiseRatio: analysis.noiseRatio,
          mttrP50: analysis.mttrP50,
          mttrP95: analysis.mttrP95,
          periodStart: analysis.periodStart,
          periodEnd: analysis.periodEnd,
          shadowSignals: analysis.shadowSignals,
        },
      }
    }),

  /**
   * Get structured on-call config data (teams, schedules, EPs, services) from the
   * config snapshot linked to this evaluation. Reads configJson at query time —
   * no re-analysis required. Used to power the On-Call Structure report tab.
   */
  getOnCallStructure: protectedProcedure
    .input(evaluationIdInput)
    .query(async ({ ctx, input }) => {
      const { id } = input

      const evaluation = await prisma.evaluation.findUnique({
        where: { id },
        select: { configSnapshotId: true, createdById: true },
      })

      if (!evaluation?.configSnapshotId) return null

      // Access control
      const fullEval = await prisma.evaluation.findUnique({ where: { id }, select: { createdById: true } })
      if (ctx.user.role !== 'ADMIN' && fullEval?.createdById !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' })
      }

      // Load all structural resource types with configJson in one query
      const resources = await prisma.pdResource.findMany({
        where: {
          snapshotId: evaluation.configSnapshotId,
          pdType: { in: ['TEAM', 'USER', 'SCHEDULE', 'ESCALATION_POLICY', 'SERVICE'] as any[] },
        },
        select: { pdId: true, pdType: true, name: true, configJson: true, teamIds: true, dependencies: true },
      })

      // Parse all configJson
      const parsed = resources.map((r) => ({
        ...r,
        config: decompressJson(r.configJson) as any,
      }))

      // Build lookup maps for target resolution
      const userMap = new Map(parsed.filter((r) => r.pdType === 'USER').map((r) => [r.pdId, r]))
      const scheduleMap = new Map(parsed.filter((r) => r.pdType === 'SCHEDULE').map((r) => [r.pdId, r]))
      const epMap = new Map(parsed.filter((r) => r.pdType === 'ESCALATION_POLICY').map((r) => [r.pdId, r]))

      // Shape teams with member list
      const teams = parsed
        .filter((r) => r.pdType === 'TEAM')
        .map((r) => ({
          id: r.pdId,
          name: r.name,
          members: (r.config.members || []).map((m: any) => ({
            name: m.user?.name || 'Unknown',
            email: m.user?.email || '',
            role: m.role || 'responder',
          })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      // Shape escalation policies with resolved target names
      const escalationPolicies = parsed
        .filter((r) => r.pdType === 'ESCALATION_POLICY')
        .map((r) => ({
          id: r.pdId,
          name: r.name,
          teamIds: r.teamIds,
          numLoops: r.config.num_loops ?? 0,
          rules: (r.config.escalation_rules || []).map((rule: any, idx: number) => ({
            ruleNumber: idx + 1,
            escalationDelayMinutes: rule.escalation_delay_in_minutes ?? 0,
            targets: (rule.targets || []).map((target: any) => {
              const isSchedule = (target.type || '').includes('schedule')
              const resolvedName = isSchedule
                ? (scheduleMap.get(target.id)?.name ?? target.summary ?? target.id)
                : (userMap.get(target.id)?.name ?? target.summary ?? target.id)
              return { id: target.id, type: target.type, name: resolvedName, isSchedule }
            }),
          })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      // Shape schedules with layers
      const schedules = parsed
        .filter((r) => r.pdType === 'SCHEDULE')
        .map((r) => ({
          id: r.pdId,
          name: r.name,
          teamIds: r.teamIds,
          timeZone: r.config.time_zone || '',
          layers: (r.config.schedule_layers || []).map((layer: any) => ({
            name: layer.name || '',
            rotationTurnLengthSeconds: layer.rotation_turn_length_seconds ?? 0,
            users: (layer.users || []).map((u: any) => {
              const userId = u.user?.id || u.id
              return userMap.get(userId)?.name ?? u.user?.summary ?? userId
            }),
            restrictions: (layer.restrictions || []).map((res: any) => ({
              type: res.type,
              durationSeconds: res.duration_seconds,
              startDayOfWeek: res.start_day_of_week,
              startTimeOfDay: res.start_time_of_day,
            })),
          })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      // Shape services summary
      const services = parsed
        .filter((r) => r.pdType === 'SERVICE')
        .map((r) => {
          const epId = r.config.escalation_policy?.id
          const epName = epId ? (epMap.get(epId)?.name ?? r.config.escalation_policy?.summary ?? '') : ''
          return {
            id: r.pdId,
            name: r.name,
            teamIds: r.teamIds,
            status: r.config.status || 'active',
            escalationPolicyName: epName,
            integrationCount: (r.config.integrations || []).length,
            alertGroupingType: r.config.alert_grouping_parameters?.type ?? null,
            autoResolveTimeout: r.config.auto_resolve_timeout ?? null,
            acknowledgementTimeout: r.config.acknowledgement_timeout ?? null,
            hasDependencies: (r.config._dependsOn?.length ?? 0) > 0 || (r.config._dependedOnBy?.length ?? 0) > 0,
            dependsOn: r.config._dependsOn ?? [],
            dependedOnBy: r.config._dependedOnBy ?? [],
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))

      return { teams, escalationPolicies, schedules, services }
    }),

  /**
   * Get entitlement data for an evaluation: account abilities + user license breakdown.
   * Reads the ACCOUNT_INFO and USER resources from the linked config snapshot.
   */
  getEntitlements: protectedProcedure
    .input(evaluationIdInput)
    .query(async ({ ctx, input }) => {
      const { id } = input

      const evaluation = await prisma.evaluation.findUnique({
        where: { id },
        select: { configSnapshotId: true, createdById: true },
      })

      if (!evaluation?.configSnapshotId) return null

      // Access control
      if (ctx.user.role !== 'ADMIN' && evaluation.createdById !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' })
      }

      // Load ACCOUNT_INFO and USER resources from the snapshot
      const resources = await prisma.pdResource.findMany({
        where: {
          snapshotId: evaluation.configSnapshotId,
          pdType: { in: ['ACCOUNT_INFO', 'USER'] as any[] },
        },
        select: { pdId: true, pdType: true, configJson: true },
      })

      // Extract abilities from ACCOUNT_INFO resource
      const accountInfoResource = resources.find((r) => r.pdType === 'ACCOUNT_INFO')
      let abilities: string[] = []
      if (accountInfoResource) {
        try {
          const parsed = decompressJson(accountInfoResource.configJson) as any
          abilities = parsed.abilities || []
        } catch {
          // ignore parse errors
        }
      }

      // Count users by role type
      const usersByRole: Record<string, number> = {}
      for (const r of resources.filter((r) => r.pdType === 'USER')) {
        try {
          const parsed = decompressJson(r.configJson) as any
          const role = parsed.role || 'user'
          usersByRole[role] = (usersByRole[role] || 0) + 1
        } catch {
          usersByRole['user'] = (usersByRole['user'] || 0) + 1
        }
      }

      return { abilities, usersByRole, hasAccountInfo: !!accountInfoResource }
    }),

  /**
   * Cancel an evaluation
   */
  cancel: seProcedure
    .input(evaluationIdInput)
    .mutation(async ({ input }) => {
      const { id } = input

      const evaluation = await prisma.evaluation.findUnique({
        where: { id },
      })

      if (!evaluation) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Evaluation not found',
        })
      }

      const updated = await prisma.evaluation.update({
        where: { id },
        data: { status: 'CANCELLED' },
      })

      return updated
    }),

  /**
   * Retry a failed evaluation (reset status and re-trigger)
   */
  retry: seProcedure
    .input(evaluationIdInput)
    .mutation(async ({ input }) => {
      const { id } = input

      const evaluation = await prisma.evaluation.findUnique({
        where: { id },
      })

      if (!evaluation) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Evaluation not found',
        })
      }

      if (evaluation.status !== 'FAILED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only failed evaluations can be retried',
        })
      }

      // Reset status to PENDING
      const updated = await prisma.evaluation.update({
        where: { id },
        data: { status: 'PENDING', startedAt: null, completedAt: null },
      })

      // Fire-and-forget: re-run analysis directly
      runEvaluationAnalysis(id).catch((err) => {
        console.error('Evaluation retry failed:', err)
      })

      return updated
    }),

  /**
   * Delete an evaluation and all related data
   */
  delete: adminProcedure
    .input(evaluationIdInput)
    .mutation(async ({ input }) => {
      const { id } = input

      const evaluation = await prisma.evaluation.findUnique({
        where: { id },
      })

      if (!evaluation) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Evaluation not found',
        })
      }

      // Delete related incident analyses
      await prisma.incidentAnalysis.deleteMany({
        where: { evaluationId: id },
      })

      // Delete related migration mappings
      await prisma.migrationMapping.deleteMany({
        where: { evaluationId: id },
      })

      // Delete evaluation
      await prisma.evaluation.delete({
        where: { id },
      })

      return { deleted: true, evaluationId: id }
    }),
})

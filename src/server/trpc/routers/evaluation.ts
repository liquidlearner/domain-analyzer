import { z } from 'zod'
import { router, protectedProcedure, seProcedure, adminProcedure } from '../trpc'
import { prisma } from '@/server/db/client'
import { TRPCError } from '@trpc/server'
import { runEvaluationAnalysis } from '@/server/services/evaluation-runner'

// Input validators
const createEvaluationInput = z.object({
  domainId: z.string().cuid(),
  scopeType: z.enum(['TEAM', 'SERVICE']),
  scopeIds: z.array(z.string()).min(1),
  timeRangeDays: z.enum(['30', '90', '365']).default('30'),
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
      const { domainId, scopeType, scopeIds, timeRangeDays } = input

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

      // Create evaluation with time range
      const evaluation = await prisma.evaluation.create({
        data: {
          domainId,
          createdById: ctx.user.id,
          scopeType,
          scopeIds,
          timeRangeDays: parseInt(timeRangeDays, 10),
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

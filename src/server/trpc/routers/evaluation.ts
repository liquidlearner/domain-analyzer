import { z } from 'zod'
import { router, protectedProcedure, seProcedure, adminProcedure } from '../trpc'
import { prisma } from '@/server/db/client'
import { inngest } from '@/server/jobs/inngest'
import { TRPCError } from '@trpc/server'

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
   * Create a new evaluation and trigger incident data pull
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

      // Create evaluation
      const evaluation = await prisma.evaluation.create({
        data: {
          domainId,
          createdById: ctx.user.id,
          scopeType,
          scopeIds,
          status: 'PENDING',
        },
      })

      // Trigger incident data pull via Inngest
      await inngest.send({
        name: 'evaluation/incident-pull.requested',
        data: { evaluationId: evaluation.id },
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
              resources: true,
            },
          },
          incidentAnalyses: {
            orderBy: { periodStart: 'desc' },
          },
          migrationMappings: {
            include: {
              pdResource: {
                include: {
                  snapshot: true,
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

      // Re-trigger incident data pull
      await inngest.send({
        name: 'evaluation/incident-pull.requested',
        data: { evaluationId: id },
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

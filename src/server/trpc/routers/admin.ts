import { z } from 'zod'
import { router, protectedProcedure, adminProcedure } from '../trpc'
import { prisma } from '@/server/db/client'
import { logAudit } from '@/server/services/audit'
import { TRPCError } from '@trpc/server'

// Input validators
const listUsersInput = z.object({
  search: z.string().optional(),
  page: z.number().default(1),
  limit: z.number().default(10),
})

const updateUserRoleInput = z.object({
  userId: z.string().cuid(),
  role: z.enum(['ADMIN', 'SA_SE', 'VIEWER']),
})

const listAuditLogsInput = z.object({
  page: z.number().default(1),
  limit: z.number().default(50),
  action: z.string().optional(),
  entityType: z.string().optional(),
  userId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

export const adminRouter = router({
  /**
   * List users with optional search
   */
  listUsers: adminProcedure
    .input(listUsersInput)
    .query(async ({ input }) => {
      const { search, page, limit } = input
      const skip = (page - 1) * limit

      const where = search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' as const } },
              { name: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.user.count({ where }),
      ])

      return {
        users,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      }
    }),

  /**
   * Update user role (admin-only)
   * Cannot demote yourself from admin
   */
  updateUserRole: adminProcedure
    .input(updateUserRoleInput)
    .mutation(async ({ ctx, input }) => {
      const { userId, role } = input

      // Check if trying to demote self
      if (userId === ctx.user.id && role !== 'ADMIN') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot demote yourself from admin role',
        })
      }

      // Get user's current role for audit log
      const user = await prisma.user.findUnique({
        where: { id: userId },
      })

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        })
      }

      // Update role
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { role },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      })

      // Log audit event
      await logAudit({
        userId: ctx.user.id,
        action: 'UPDATE_ROLE',
        entityType: 'USER',
        entityId: userId,
        metadata: {
          oldRole: user.role,
          newRole: role,
          targetEmail: user.email,
        },
      })

      return updated
    }),

  /**
   * List audit logs with filtering and pagination
   */
  listAuditLogs: adminProcedure
    .input(listAuditLogsInput)
    .query(async ({ input }) => {
      const { page, limit, action, entityType, userId, startDate, endDate } =
        input
      const skip = (page - 1) * limit

      const where: any = {}

      if (action) where.action = action
      if (entityType) where.entityType = entityType
      if (userId) where.userId = userId
      if (startDate || endDate) {
        where.createdAt = {}
        if (startDate) where.createdAt.gte = new Date(startDate)
        if (endDate) where.createdAt.lte = new Date(endDate)
      }

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          include: {
            user: {
              select: { id: true, email: true, name: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.auditLog.count({ where }),
      ])

      return {
        logs,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      }
    }),

  /**
   * Get dashboard stats (accessible to all authenticated users)
   */
  getStats: protectedProcedure.query(async () => {
    const [
      totalCustomers,
      totalDomains,
      domainsByStatus,
      evaluationsByStatus,
      recentActivityCount,
    ] = await Promise.all([
      prisma.customer.count(),
      prisma.pdDomain.count(),
      prisma.pdDomain.groupBy({
        by: ['status'],
        _count: true,
      }),
      prisma.evaluation.groupBy({
        by: ['status'],
        _count: true,
      }),
      prisma.evaluation.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
      }),
    ])

    const statusMap = (items: any[]) => {
      const result: Record<string, number> = {}
      items.forEach((item) => {
        result[item._count ? Object.keys(item)[0] : 'unknown'] =
          item._count || 0
      })
      return result
    }

    return {
      totalCustomers,
      totalDomains,
      domainsByStatus: domainsByStatus.reduce(
        (acc: Record<string, number>, item: any) => {
          acc[item.status] = item._count
          return acc
        },
        {}
      ),
      evaluationsByStatus: evaluationsByStatus.reduce(
        (acc: Record<string, number>, item: any) => {
          acc[item.status] = item._count
          return acc
        },
        {}
      ),
      recentActivityCount,
    }
  }),
})

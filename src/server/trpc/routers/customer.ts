import { router, protectedProcedure, seProcedure, adminProcedure } from "../trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { logAudit } from "@/server/services/audit";

export const customerRouter = router({
  /**
   * List customers with optional search and pagination
   * Non-admins only see customers they created
   */
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        page: z.number().int().positive().default(1),
        limit: z.number().int().positive().max(100).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const { search, page, limit } = input;
      const skip = (page - 1) * limit;

      // Build where clause
      const where = {
        ...(ctx.user.role !== "ADMIN" && {
          createdById: ctx.user.id,
        }),
        ...(search && {
          name: {
            contains: search,
            mode: "insensitive" as const,
          },
        }),
      };

      // Get total count
      const total = await ctx.prisma.customer.count({ where });

      // Get paginated results
      const customers = await ctx.prisma.customer.findMany({
        where,
        include: {
          _count: {
            select: {
              pdDomains: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
      });

      return {
        customers: customers.map((c: any) => ({
          id: c.id,
          name: c.name,
          industry: c.industry,
          pdContractRenewal: c.pdContractRenewal,
          domainCount: c._count.pdDomains,
          createdAt: c.createdAt,
        })),
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      };
    }),

  /**
   * Get a single customer by ID with PdDomain relations
   */
  getById: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const { id } = input;

      const customer = await ctx.prisma.customer.findUnique({
        where: { id },
        include: {
          createdBy: {
            select: {
              name: true,
              email: true,
            },
          },
          pdDomains: {
            select: {
              id: true,
              subdomain: true,
              status: true,
              tokenLast4: true,
              lastValidated: true,
              connectedAt: true,
            },
          },
        },
      });

      if (!customer) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Customer not found",
        });
      }

      // Verify access - non-admins can only see customers they created
      if (ctx.user.role !== "ADMIN" && customer.createdById !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to view this customer",
        });
      }

      return {
        id: customer.id,
        name: customer.name,
        industry: customer.industry,
        pdContractRenewal: customer.pdContractRenewal,
        notes: customer.notes,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
        createdBy: customer.createdBy,
        pdDomains: customer.pdDomains,
      };
    }),

  /**
   * Create a new customer
   */
  create: seProcedure
    .input(
      z.object({
        name: z.string().min(1, "Customer name is required").max(255),
        industry: z.string().optional(),
        pdContractRenewal: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { name, industry, pdContractRenewal, notes } = input;

      const customer = await ctx.prisma.customer.create({
        data: {
          name,
          industry: industry || null,
          pdContractRenewal: pdContractRenewal ? new Date(pdContractRenewal) : null,
          notes: notes || null,
          createdById: ctx.user.id,
        },
        include: {
          createdBy: {
            select: {
              name: true,
            },
          },
        },
      });

      // Log audit event
      await logAudit({
        userId: ctx.user.id,
        action: "CREATE_CUSTOMER",
        entityType: "Customer",
        entityId: customer.id,
        metadata: {
          name,
          industry,
        },
      });

      return {
        id: customer.id,
        name: customer.name,
        industry: customer.industry,
        pdContractRenewal: customer.pdContractRenewal,
        notes: customer.notes,
        createdAt: customer.createdAt,
      };
    }),

  /**
   * Update a customer (partial update)
   * Requires ownership or admin role
   */
  update: seProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(255).optional(),
        industry: z.string().optional(),
        pdContractRenewal: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, name, industry, pdContractRenewal, notes } = input;

      // Get the customer to check ownership
      const customer = await ctx.prisma.customer.findUnique({
        where: { id },
      });

      if (!customer) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Customer not found",
        });
      }

      // Verify ownership or admin role
      if (ctx.user.role !== "ADMIN" && customer.createdById !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to update this customer",
        });
      }

      // Build update data
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (industry !== undefined) updateData.industry = industry || null;
      if (pdContractRenewal !== undefined)
        updateData.pdContractRenewal = pdContractRenewal ? new Date(pdContractRenewal) : null;
      if (notes !== undefined) updateData.notes = notes || null;

      const updated = await ctx.prisma.customer.update({
        where: { id },
        data: updateData,
      });

      // Log audit event
      await logAudit({
        userId: ctx.user.id,
        action: "UPDATE_CUSTOMER",
        entityType: "Customer",
        entityId: id,
        metadata: {
          changes: updateData,
        },
      });

      return {
        id: updated.id,
        name: updated.name,
        industry: updated.industry,
        pdContractRenewal: updated.pdContractRenewal,
        notes: updated.notes,
        updatedAt: updated.updatedAt,
      };
    }),

  /**
   * Delete a customer (hard delete with cascading)
   * Admin only
   */
  delete: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id } = input;

      const customer = await ctx.prisma.customer.findUnique({
        where: { id },
      });

      if (!customer) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Customer not found",
        });
      }

      // Delete customer (cascade will handle pdDomains, evaluations, etc.)
      await ctx.prisma.customer.delete({
        where: { id },
      });

      // Log audit event
      await logAudit({
        userId: ctx.user.id,
        action: "DELETE_CUSTOMER",
        entityType: "Customer",
        entityId: id,
        metadata: {
          name: customer.name,
        },
      });

      return {
        id,
        success: true,
      };
    }),
});

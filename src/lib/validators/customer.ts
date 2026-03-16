import { z } from "zod";

/**
 * Schema for creating a customer
 */
export const createCustomerSchema = z.object({
  name: z
    .string()
    .min(1, "Customer name is required")
    .max(255, "Customer name is too long"),
  industry: z
    .string()
    .max(255, "Industry name is too long")
    .optional(),
  pdContractRenewal: z
    .string()
    .optional()
    .describe("PD contract renewal date as ISO 8601 string"),
  notes: z
    .string()
    .optional()
    .describe("Additional notes about the customer"),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/**
 * Schema for updating a customer
 */
export const updateCustomerSchema = z.object({
  id: z
    .string()
    .min(1, "Customer ID is required"),
  name: z
    .string()
    .min(1, "Customer name is required")
    .max(255, "Customer name is too long")
    .optional(),
  industry: z
    .string()
    .max(255, "Industry name is too long")
    .optional(),
  pdContractRenewal: z
    .string()
    .optional(),
  notes: z
    .string()
    .optional(),
});

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

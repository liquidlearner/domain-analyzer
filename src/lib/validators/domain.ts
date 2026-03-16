import { z } from "zod";

/**
 * Schema for connecting a PagerDuty domain
 */
export const connectDomainSchema = z.object({
  customerId: z
    .string()
    .min(1, "Customer ID is required")
    .describe("ID of the customer"),
  subdomain: z
    .string()
    .min(1, "Subdomain is required")
    .max(255, "Subdomain is too long")
    .regex(/^[a-zA-Z0-9-]+$/, "Subdomain can only contain letters, numbers, and hyphens")
    .describe("PagerDuty account subdomain (e.g., 'acme-corp')"),
  apiToken: z
    .string()
    .min(20, "API token must be at least 20 characters")
    .describe("PagerDuty API token"),
});

export type ConnectDomainInput = z.infer<typeof connectDomainSchema>;

/**
 * Schema for updating a domain's API token
 */
export const updateTokenSchema = z.object({
  domainId: z
    .string()
    .min(1, "Domain ID is required")
    .describe("ID of the PdDomain to update"),
  apiToken: z
    .string()
    .min(20, "API token must be at least 20 characters")
    .describe("New PagerDuty API token"),
});

export type UpdateTokenInput = z.infer<typeof updateTokenSchema>;

/**
 * Schema for validating an existing connection
 */
export const validateConnectionSchema = z.object({
  domainId: z
    .string()
    .min(1, "Domain ID is required")
    .describe("ID of the PdDomain to validate"),
});

export type ValidateConnectionInput = z.infer<
  typeof validateConnectionSchema
>;

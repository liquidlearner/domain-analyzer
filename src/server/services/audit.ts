import { prisma } from "@/server/db/client";

/**
 * Log an audit event to the database
 * Used for tracking domain connections, token updates, and disconnections
 */
export async function logAudit(params: {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        metadataJson: params.metadata || {},
        ipAddress: params.ipAddress,
      },
    });
  } catch (error) {
    // Log to console but don't throw - audit logging should not break operations
    console.error("Failed to log audit event:", error);
  }
}

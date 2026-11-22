import { prisma } from './db';

export interface CreateAuditLogParams {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValues?: any;
  newValues?: any;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
  tx?: any;
}

export async function logAuditEvent(params: CreateAuditLogParams) {
  try {
    const client = params.tx || prisma;
    return await client.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        oldValues: params.oldValues ? JSON.stringify(params.oldValues) : null,
        newValues: params.newValues ? JSON.stringify(params.newValues) : null,
        reason: params.reason,
        ipAddress: params.ipAddress || '127.0.0.1',
        userAgent: params.userAgent || 'Web/Browser',
      },
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

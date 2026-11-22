import { prisma } from './db';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'refreshtoken',
  'accesstoken',
  'secret',
  'jwt',
  'apikey',
  'authorization',
  'pin',
  'cvv',
  'creditcard',
  'cardnumber',
]);

/**
 * Recursively redacts sensitive keys such as passwords, tokens, API keys, and hashes
 * to guarantee that confidential credentials are never leaked into audit logs.
 */
export function sanitizeAuditData(data: any, seen = new WeakSet()): any {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  // Prevent circular reference explosions
  if (seen.has(data)) return '[Circular]';
  seen.add(data);

  if (data instanceof Date) return data.toISOString();

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeAuditData(item, seen));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (
      SENSITIVE_KEYS.has(lowerKey) ||
      lowerKey.includes('password') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('token')
    ) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeAuditData(value, seen);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

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
  status?: 'SUCCESS' | 'FAILED' | string;
  tx?: any;
}

export async function logAuditEvent(params: CreateAuditLogParams) {
  const client = params.tx || prisma;
  const status =
    params.status ||
    (params.action.includes('FAILED') || params.action.includes('REJECT') ? 'FAILED' : 'SUCCESS');

  const sanitizedOld = params.oldValues ? sanitizeAuditData(params.oldValues) : null;
  const sanitizedNew = params.newValues ? sanitizeAuditData(params.newValues) : null;

  try {
    return await client.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        oldValues: sanitizedOld ? JSON.stringify(sanitizedOld) : null,
        newValues: sanitizedNew ? JSON.stringify(sanitizedNew) : null,
        reason: params.reason,
        ipAddress: params.ipAddress || '127.0.0.1',
        userAgent: params.userAgent || 'Web/Browser',
        status,
      },
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
    // If inside a database transaction, re-throw to abort and rollback financial mutation without audit
    if (params.tx) {
      throw new Error(
        `Audit log creation failed in atomic transaction: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

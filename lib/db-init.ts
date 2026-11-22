import { prisma } from './db';

let schemaEnsured = false;
let schemaPromise: Promise<void> | null = null;

/**
 * Ensures required database schema additions (such as AuditLog.status, indexes,
 * and clearing account types) exist in PostgreSQL.
 *
 * This provides zero-downtime, self-healing compatibility for deployments
 * (e.g. Render, Vercel, Railway) where migrations might not have been applied
 * to the remote database prior to container launch.
 */
export async function ensureDatabaseSchema(): Promise<void> {
  if (schemaEnsured) return;

  if (!schemaPromise) {
    schemaPromise = (async () => {
      try {
        // 1. Ensure status column on AuditLog exists
        await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'SUCCESS'`);

        // 2. Ensure indexes on AuditLog exist for high performance queries
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AuditLog_entityType_idx" ON "AuditLog"("entityType")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AuditLog_userId_idx" ON "AuditLog"("userId")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AuditLog_status_idx" ON "AuditLog"("status")`);

        // 3. Ensure clearing accounts are marked as clearing
        await prisma.$executeRawUnsafe(`
          UPDATE "Account" 
          SET "accountType" = 'clearing' 
          WHERE "accountCode" IN ('1060', '1065') 
            AND ("accountType" IS NULL OR "accountType" != 'clearing')
        `);

        schemaEnsured = true;
      } catch (err) {
        console.warn('[DB-INIT] Warning: Could not auto-apply schema update at runtime:', err);
      } finally {
        schemaPromise = null;
      }
    })();
  }

  return schemaPromise;
}

export function resetSchemaEnsuredFlag(): void {
  schemaEnsured = false;
}

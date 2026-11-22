-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'SUCCESS';

-- Update existing failed / rejected actions to 'FAILED'
UPDATE "AuditLog" SET "status" = 'FAILED' WHERE "action" LIKE '%FAILED%' OR "action" LIKE '%REJECT%';

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_idx" ON "AuditLog"("entityType");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX IF NOT EXISTS "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX IF NOT EXISTS "AuditLog_status_idx" ON "AuditLog"("status");

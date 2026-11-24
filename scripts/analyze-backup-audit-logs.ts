import * as fs from 'fs';
import * as path from 'path';

const backupPath = path.join(process.cwd(), 'backups', 'production-pre-cleanup-2026-11-23T08-54-14-081Z.json');
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

const auditLogs = backup.auditLogs || [];
console.log(`Total Audit Logs in backup: ${auditLogs.length}`);

// Group by action and entityType
const summary: Record<string, number> = {};
const details: any[] = [];

for (const log of auditLogs) {
  const key = `${log.action} | ${log.entityType}`;
  summary[key] = (summary[key] || 0) + 1;
  details.push({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    reason: log.reason,
    userId: log.userId,
    createdAt: log.createdAt,
    ipAddress: log.ipAddress,
  });
}

console.log('--- SUMMARY BY ACTION & ENTITY TYPE ---');
console.table(summary);

console.log('--- SAMPLE OF ALL DISTINCT ACTIONS & REASONS ---');
const distinctActions = Array.from(new Set(auditLogs.map((l: any) => `${l.action} (${l.entityType}) -> ${l.reason}`)));
console.log(distinctActions.join('\n'));

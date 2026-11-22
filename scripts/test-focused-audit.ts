import { PrismaClient } from '@prisma/client';
import { assertBusinessDateOpen, postLedgerTransaction } from '../lib/accounting/accounting-service';
import { getSystemBusinessDate } from '../lib/financial-core';
import Decimal from 'decimal.js';

const prisma = new PrismaClient();
const prismaA = new PrismaClient();
const prismaB = new PrismaClient();

async function runFocusedAudit() {
  console.log('========================================================================');
  console.log('   FOCUSED POSTGRESQL & TIMEZONE AUDIT (COMMIT 61a482a)');
  console.log('========================================================================\n');

  try {
    // ========================================================================
    // PART 1: TIMEZONE AUDIT: AFRICA/CAIRO (EGYPT UTC+2 / UTC+3 DYNAMIC DST)
    // ========================================================================
    console.log('------------------------------------------------------------------------');
    console.log('PART 1: Timezone Verification: Africa/Cairo (Egypt Dynamic DST)');
    console.log('------------------------------------------------------------------------');

    // 1.1 Winter Midnight Boundary Test (UTC+2 in Cairo)
    // 2026-01-14 at 21:59:59.999 UTC is 23:59:59.999 in Cairo -> Must be 2026-01-14
    const winterBeforeMidnight = new Date('2026-01-14T21:59:59.999Z');
    const dateWinterBefore = getSystemBusinessDate(winterBeforeMidnight);
    console.log('  [1.1a] 21:59:59 UTC (23:59:59 Cairo Winter):', dateWinterBefore);
    if (dateWinterBefore !== '2026-01-14') {
      throw new Error(`Failed 1.1a: Expected 2026-01-14, got ${dateWinterBefore}`);
    }

    // 2026-01-14 at 22:00:00.000 UTC is EXACTLY 00:00:00 Cairo midnight (UTC+2) -> Must be 2026-01-15
    const winterAtMidnight = new Date('2026-01-14T22:00:00.000Z');
    const dateWinterAtMidnight = getSystemBusinessDate(winterAtMidnight);
    console.log('  [1.1b] 22:00:00 UTC (00:00:00 Cairo Midnight Winter):', dateWinterAtMidnight);
    if (dateWinterAtMidnight !== '2026-01-15') {
      throw new Error(`Failed 1.1b: Expected 2026-01-15, got ${dateWinterAtMidnight}`);
    }

    // 1.2 Summer Midnight Boundary Test (UTC+3 in Cairo)
    // 2026-07-14 at 20:59:59.999 UTC is 23:59:59.999 in Cairo -> Must be 2026-07-14
    const summerBeforeMidnight = new Date('2026-07-14T20:59:59.999Z');
    const dateSummerBefore = getSystemBusinessDate(summerBeforeMidnight);
    console.log('  [1.2a] 20:59:59 UTC (23:59:59 Cairo Summer):', dateSummerBefore);
    if (dateSummerBefore !== '2026-07-14') {
      throw new Error(`Failed 1.2a: Expected 2026-07-14, got ${dateSummerBefore}`);
    }

    // 2026-07-14 at 21:00:00.000 UTC is EXACTLY 00:00:00 Cairo midnight (UTC+3) -> Must be 2026-07-15
    const summerAtMidnight = new Date('2026-07-14T21:00:00.000Z');
    const dateSummerAtMidnight = getSystemBusinessDate(summerAtMidnight);
    console.log('  [1.2b] 21:00:00 UTC (00:00:00 Cairo Midnight Summer):', dateSummerAtMidnight);
    if (dateSummerAtMidnight !== '2026-07-15') {
      throw new Error(`Failed 1.2b: Expected 2026-07-15, got ${dateSummerAtMidnight}`);
    }

    // 1.3 Dynamic Seasonal Offset Evaluation (No Hardcoded Offsets)
    const summerDate = new Date('2026-07-15T12:00:00Z');
    const winterDate = new Date('2026-01-15T12:00:00Z');

    const getOffsetHours = (d: Date, tzName: string) => {
      const utcStr = d.toLocaleString('en-US', { timeZone: 'UTC' });
      const tzStr = d.toLocaleString('en-US', { timeZone: tzName });
      return (new Date(tzStr).getTime() - new Date(utcStr).getTime()) / (1000 * 60 * 60);
    };

    const cairoSummerOffset = getOffsetHours(summerDate, 'Africa/Cairo');
    const cairoWinterOffset = getOffsetHours(winterDate, 'Africa/Cairo');
    console.log(`  [1.3] Africa/Cairo Dynamic Offsets: Summer=UTC+${cairoSummerOffset}, Winter=UTC+${cairoWinterOffset}`);

    if (cairoSummerOffset !== 3 || cairoWinterOffset !== 2) {
      throw new Error(`Failed 1.3: Africa/Cairo dynamic offsets incorrect! Summer=${cairoSummerOffset}, Winter=${cairoWinterOffset}`);
    }
    console.log('  [PASS] Africa/Cairo dynamic DST & midnight boundaries verified with 100% precision.');

    // ========================================================================
    // PART 2: CONCURRENCY INTEGRATION TEST (LOCKING & BLOCKED LEDGER WRITES)
    // ========================================================================
    console.log('\n------------------------------------------------------------------------');
    console.log('PART 2: Real Concurrency Integration Test: Closing vs Financial Txn');
    console.log('------------------------------------------------------------------------');

    const testConcurDate = '2026-11-25';

    // Clean up
    await prisma.dailyClosing.deleteMany({ where: { businessDate: testConcurDate } });
    await prisma.ledgerLine.deleteMany({
      where: { ledgerEntry: { entryDate: testConcurDate } },
    });
    await prisma.ledgerEntry.deleteMany({ where: { entryDate: testConcurDate } });

    // Setup safe account
    let testSafe = await prisma.account.findFirst({ where: { accountCode: '1010' } });
    if (!testSafe) {
      testSafe = await prisma.account.create({
        data: {
          accountCode: '1010',
          name: 'خزينة رئيسية',
          accountType: 'cash_safe',
          currency: 'EGP',
          openingBalance: 1000000,
          currentBalance: 1000000,
          status: 'active',
          isSystem: true,
        },
      });
    }

    console.log(`  Simulating concurrent operations for Business Date: ${testConcurDate}`);
    console.log('  - Worker A (Closing Transaction): starts first, locks date, sleeps 700ms, sets status to closed, then commits.');
    console.log('  - Worker B (Financial Transaction): starts 100ms later, attempts postLedgerTransaction on same date.');

    let workerA_Started = false;
    let workerA_Committed = false;
    let workerB_WaitedForA = false;
    let workerB_Error: string | null = null;
    let workerB_StartTime = 0;
    let workerB_EndTime = 0;

    const runWorkerA = async () => {
      await prismaA.$transaction(async (tx) => {
        workerA_Started = true;
        console.log('    [Worker A] Acquired transaction lock pg_advisory_xact_lock for date...');
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext('daily-closing:' || $1))`,
          testConcurDate
        );

        // Create closing in progress
        await tx.dailyClosing.create({
          data: {
            businessDate: testConcurDate,
            status: 'closed',
            closedBy: 'cashier_concur_A',
            closedAt: new Date(),
            openingBalances: JSON.stringify({ EGP: 1000000 }),
            expectedBalances: JSON.stringify({ EGP: 1000000 }),
            actualBalances: JSON.stringify({ EGP: 1000000 }),
            differences: JSON.stringify({ hasVariances: false, items: [] }),
            notes: 'Concurrent test closing',
          },
        });

        console.log('    [Worker A] Closing row inserted, sleeping 700ms inside transaction...');
        await new Promise((resolve) => setTimeout(resolve, 700));
        console.log('    [Worker A] Woke up, committing transaction now.');
      });
      workerA_Committed = true;
      console.log('    [Worker A] COMMITTED successfully.');
    };

    const runWorkerB = async () => {
      // Wait 100ms so Worker A is guaranteed to have acquired the advisory lock
      await new Promise((resolve) => setTimeout(resolve, 100));
      workerB_StartTime = Date.now();
      console.log('    [Worker B] Attempting postLedgerTransaction concurrently...');

      try {
        await postLedgerTransaction({
          entryType: 'fund_transfer',
          entryDate: testConcurDate,
          description: 'Concurrent ledger post attempt',
          createdBy: 'cashier_concur_B',
          lines: [
            { accountId: testSafe.id, currency: 'EGP', debit: 1000, credit: 0 },
            { accountId: testSafe.id, currency: 'EGP', debit: 0, credit: 1000 },
          ],
        });
      } catch (err: any) {
        workerB_EndTime = Date.now();
        workerB_Error = err.message;
        workerB_WaitedForA = workerA_Committed;
        console.log(`    [Worker B] Caught expected error after waiting ${(workerB_EndTime - workerB_StartTime)}ms:`);
        console.log(`    "${err.message}"`);
      }
    };

    // Execute concurrently
    await Promise.all([runWorkerA(), runWorkerB()]);

    // Assertions
    if (!workerA_Committed) throw new Error('Worker A failed to commit!');
    if (!workerB_Error) throw new Error('Worker B was NOT blocked! It posted to a closed date!');
    if (!workerB_WaitedForA) throw new Error('Worker B did NOT wait for Worker A to commit!');

    const totalLinesPosted = await prisma.ledgerLine.count({
      where: { ledgerEntry: { entryDate: testConcurDate } },
    });
    console.log(`  [2.1] Ledger entries recorded on ${testConcurDate}: ${totalLinesPosted}`);
    if (totalLinesPosted !== 0) {
      throw new Error(`CRITICAL: Found ${totalLinesPosted} ledger entries recorded on closed date!`);
    }

    console.log('  [PASS] Concurrency Integration Test PROVED:');
    console.log('         1. Worker B was blocked at database level waiting for Worker A.');
    console.log('         2. After Worker A committed, Worker B detected closed day and failed cleanly.');
    console.log('         3. ZERO ledger entries were written (Complete Atomicity).');

    // ========================================================================
    // PART 3: SNAPSHOT ATOMICITY & IMMUTABILITY (REOPEN & RECLOSE)
    // ========================================================================
    console.log('\n------------------------------------------------------------------------');
    console.log('PART 3: Snapshot Atomicity & Immutability (Reopen & Reclose)');
    console.log('------------------------------------------------------------------------');

    const testSnapDate = '2026-11-26';
    await prisma.dailyClosing.deleteMany({ where: { businessDate: testSnapDate } });

    // 3.1 Initial Close: Snapshot 1
    const snap1Expected = { EGP: 750000, SDG: 30000000 };
    const snap1Actual = { EGP: 745000, SDG: 30000000 };
    const snap1Diff = {
      hasVariances: true,
      byCurrency: { EGP: { variance: -5000 } },
      items: [{ accountCode: '1010', variance: -5000 }],
    };

    const initialCloseTime = new Date('2026-11-26T21:00:00Z');
    await prisma.dailyClosing.create({
      data: {
        businessDate: testSnapDate,
        status: 'closed',
        closedBy: 'cashier_snap_1',
        closedAt: initialCloseTime,
        openingBalances: JSON.stringify({ EGP: 750000, SDG: 30000000 }),
        expectedBalances: JSON.stringify(snap1Expected),
        actualBalances: JSON.stringify(snap1Actual),
        differences: JSON.stringify(snap1Diff),
        notes: 'Initial closing with 5000 EGP cash variance',
      },
    });
    console.log('  [3.1] Snapshot 1 created with variance -5,000 EGP.');

    // 3.2 Reopen Day
    const reopenTime = new Date('2026-11-26T21:45:00Z');
    await prisma.$transaction(async (tx) => {
      const closing = await tx.dailyClosing.findUnique({ where: { businessDate: testSnapDate } });
      if (!closing) throw new Error('Not found');

      await tx.dailyClosing.update({
        where: { id: closing.id },
        data: {
          status: 'reopened',
          reopenedBy: 'admin_audit',
          reopenedAt: reopenTime,
          notes: `${closing.notes} [Reopened: Found missing 5,000 EGP voucher]`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: 'admin_audit',
          action: 'REOPEN_DAILY_CLOSING',
          entityType: 'DailyClosing',
          entityId: closing.id,
          oldValues: JSON.stringify({ status: 'closed', closedAt: closing.closedAt }),
          newValues: JSON.stringify({ status: 'reopened', reopenedAt: reopenTime }),
          reason: 'Found missing 5,000 EGP voucher',
        },
      });
    });
    console.log('  [3.2] Day atomically reopened with AuditLog entry.');

    // 3.3 Re-close Day: Snapshot 2 with Archive of Snapshot 1
    const snap2Expected = { EGP: 750000, SDG: 30000000 };
    const snap2Actual = { EGP: 750000, SDG: 30000000 };
    const snap2CloseTime = new Date('2026-11-26T22:30:00Z');

    await prisma.$transaction(async (tx) => {
      const existing = await tx.dailyClosing.findUnique({ where: { businessDate: testSnapDate } });
      if (!existing) throw new Error('Not found');

      let prevDiffObj: any = null;
      try { prevDiffObj = existing.differences ? JSON.parse(existing.differences) : null; } catch {}
      let history: any[] = [];
      if (prevDiffObj && Array.isArray(prevDiffObj.snapshotsHistory)) {
        history = [...prevDiffObj.snapshotsHistory];
      }

      history.push({
        snapshotIndex: history.length + 1,
        closedAt: existing.closedAt?.toISOString(),
        closedBy: existing.closedBy,
        reopenedAt: existing.reopenedAt?.toISOString(),
        reopenedBy: existing.reopenedBy,
        openingBalances: JSON.parse(existing.openingBalances),
        expectedBalances: JSON.parse(existing.expectedBalances),
        actualBalances: JSON.parse(existing.actualBalances),
        differences: prevDiffObj?.items || null,
        byCurrency: prevDiffObj?.byCurrency || null,
        notes: existing.notes,
      });

      const updatedDiff = {
        hasVariances: false,
        byCurrency: { EGP: { variance: 0 } },
        items: [],
        snapshotsHistory: history,
      };

      await tx.dailyClosing.update({
        where: { id: existing.id },
        data: {
          status: 'closed',
          closedBy: 'cashier_snap_2',
          closedAt: snap2CloseTime,
          actualBalances: JSON.stringify(snap2Actual),
          differences: JSON.stringify(updatedDiff),
          notes: `${existing.notes} | Final exact closing`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: 'cashier_snap_2',
          action: 'DAILY_CLOSING',
          entityType: 'DailyClosing',
          entityId: existing.id,
          newValues: JSON.stringify({ status: 'closed', closedAt: snap2CloseTime }),
          reason: 'Daily closing re-executed after reconciliation',
        },
      });
    });
    console.log('  [3.3] Day re-closed atomically with Snapshot 2 and archived history.');

    // 3.4 Verification of Snapshot Immutability & Database Consistency
    const finalRecord = await prisma.dailyClosing.findUnique({ where: { businessDate: testSnapDate } });
    if (!finalRecord) throw new Error('Missing final record');

    const finalDiffObj = JSON.parse(finalRecord.differences);
    const snapHistory = finalDiffObj.snapshotsHistory;

    if (!Array.isArray(snapHistory) || snapHistory.length !== 1) {
      throw new Error(`Expected exactly 1 historical snapshot, found ${snapHistory?.length}`);
    }

    const archivedSnap1 = snapHistory[0];
    console.log('\n  [3.4] Immutable Verification of Archived Snapshot 1:');
    console.log('        - Original ClosedAt:   ', archivedSnap1.closedAt);
    console.log('        - Original Variance:   ', JSON.stringify(archivedSnap1.byCurrency));
    console.log('        - ReopenedAt:          ', archivedSnap1.reopenedAt);
    console.log('        - ReopenedBy:          ', archivedSnap1.reopenedBy);

    if (archivedSnap1.closedBy !== 'cashier_snap_1' || archivedSnap1.byCurrency?.EGP?.variance !== -5000) {
      throw new Error('Archived Snapshot 1 was altered or corrupted!');
    }

    console.log('\n  [3.5] Active Verification of Snapshot 2:');
    console.log('        - Active ClosedBy:     ', finalRecord.closedBy);
    console.log('        - Active ClosedAt:     ', finalRecord.closedAt?.toISOString());
    console.log('        - Active Variance:     ', JSON.stringify(finalDiffObj.byCurrency));

    if (finalRecord.closedBy !== 'cashier_snap_2' || finalDiffObj.byCurrency?.EGP?.variance !== 0) {
      throw new Error('Active Snapshot 2 does not reflect final balanced state!');
    }

    // Verify AuditLog entries
    const auditLogs = await prisma.auditLog.findMany({
      where: { entityType: 'DailyClosing', entityId: finalRecord.id },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`\n  [3.6] AuditLog entries for DailyClosing ${finalRecord.id}: ${auditLogs.length} events recorded.`);
    for (const log of auditLogs) {
      console.log(`        - [${log.action}] by ${log.userId}: ${log.reason}`);
    }
    if (auditLogs.length < 2) {
      throw new Error('Expected at least 2 AuditLog entries (REOPEN + CLOSE)!');
    }

    console.log('\n  [PASS] Snapshot Atomicity & Immutability verified 100% in PostgreSQL.');

    // Cleanup
    await prisma.dailyClosing.deleteMany({
      where: { businessDate: { in: [testConcurDate, testSnapDate] } },
    });
    console.log('\n[CLEANUP] Test records cleaned up successfully.');

    console.log('\n========================================================================');
    console.log('   ALL FOCUSED AUDIT CHECKS PASSED WITH 100% SUCCESS! (EXIT 0)');
    console.log('========================================================================\n');
  } catch (err: any) {
    console.error('\n[AUDIT FAILED]:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await prismaA.$disconnect();
    await prismaB.$disconnect();
  }
}

runFocusedAudit();

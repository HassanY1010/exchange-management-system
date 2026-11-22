import { PrismaClient } from '@prisma/client';
import { assertBusinessDateOpen, postLedgerTransaction } from '../lib/accounting/accounting-service';
import { getSystemBusinessDate } from '../lib/financial-core';
import Decimal from 'decimal.js';

const prisma = new PrismaClient();

async function runCairoTimezoneAudit() {
  console.log('========================================================================');
  console.log('   EGYPT (AFRICA/CAIRO) TIMEZONE & DYNAMIC DST AUDIT VERIFICATION');
  console.log('========================================================================\n');

  try {
    const tz = 'Africa/Cairo';

    const getOffsetHours = (d: Date) => {
      const utcStr = d.toLocaleString('en-US', { timeZone: 'UTC' });
      const tzStr = d.toLocaleString('en-US', { timeZone: tz });
      return (new Date(tzStr).getTime() - new Date(utcStr).getTime()) / (1000 * 60 * 60);
    };

    // ========================================================================
    // 1. WINTER TIME AUDIT (Standard Time: UTC+2)
    // ========================================================================
    console.log('------------------------------------------------------------------------');
    console.log('TEST 1: Winter Standard Time (UTC+2) in Cairo');
    console.log('------------------------------------------------------------------------');

    const winterDate = new Date('2026-01-15T12:00:00Z');
    const winterOffset = getOffsetHours(winterDate);
    console.log(`  [1.1] Winter Offset (Jan 15, 2026): UTC+${winterOffset}`);
    if (winterOffset !== 2) {
      throw new Error(`Expected Winter Offset UTC+2, got UTC+${winterOffset}`);
    }

    // 1.2 Winter Midnight Boundaries
    // 21:59:59 UTC on Jan 14 is 23:59:59 Cairo time -> Must be 2026-01-14
    const wBeforeMidnight = new Date('2026-01-14T21:59:59.999Z');
    const wBeforeRes = getSystemBusinessDate(wBeforeMidnight);
    console.log('  [1.2a] 21:59:59 UTC (23:59:59 Cairo Winter):', wBeforeRes);
    if (wBeforeRes !== '2026-01-14') {
      throw new Error(`Winter before midnight failed: expected 2026-01-14, got ${wBeforeRes}`);
    }

    // 22:00:00 UTC on Jan 14 is EXACTLY 00:00:00 Cairo midnight (UTC+2) -> Must be 2026-01-15
    const wAtMidnight = new Date('2026-01-14T22:00:00.000Z');
    const wAtRes = getSystemBusinessDate(wAtMidnight);
    console.log('  [1.2b] 22:00:00 UTC (00:00:00 Cairo Midnight Winter):', wAtRes);
    if (wAtRes !== '2026-01-15') {
      throw new Error(`Winter at midnight failed: expected 2026-01-15, got ${wAtRes}`);
    }

    // 22:30:00 UTC on Jan 14 is 00:30:00 Cairo time -> Must be 2026-01-15
    const wAfterMidnight = new Date('2026-01-14T22:30:00.000Z');
    const wAfterRes = getSystemBusinessDate(wAfterMidnight);
    console.log('  [1.2c] 22:30:00 UTC (00:30:00 Cairo Winter):', wAfterRes);
    if (wAfterRes !== '2026-01-15') {
      throw new Error(`Winter 12:30 AM failed: expected 2026-01-15, got ${wAfterRes}`);
    }

    // 00:00:00 UTC on Jan 15 is 02:00:00 Cairo time -> Must be 2026-01-15
    const wUtcMidnight = new Date('2026-01-15T00:00:00.000Z');
    const wUtcRes = getSystemBusinessDate(wUtcMidnight);
    console.log('  [1.2d] 00:00:00 UTC (02:00:00 Cairo Winter):', wUtcRes);
    if (wUtcRes !== '2026-01-15') {
      throw new Error(`Winter UTC midnight failed: expected 2026-01-15, got ${wUtcRes}`);
    }
    console.log('  [PASS] Cairo Winter (UTC+2) boundaries verified with 100% precision.');

    // ========================================================================
    // 2. SUMMER TIME AUDIT (Daylight Saving Time: UTC+3)
    // ========================================================================
    console.log('\n------------------------------------------------------------------------');
    console.log('TEST 2: Summer Daylight Saving Time (UTC+3) in Cairo');
    console.log('------------------------------------------------------------------------');

    const summerDate = new Date('2026-07-15T12:00:00Z');
    const summerOffset = getOffsetHours(summerDate);
    console.log(`  [2.1] Summer Offset (Jul 15, 2026): UTC+${summerOffset}`);
    if (summerOffset !== 3) {
      throw new Error(`Expected Summer Offset UTC+3, got UTC+${summerOffset}`);
    }

    // 2.2 Summer Midnight Boundaries
    // 20:59:59 UTC on Jul 14 is 23:59:59 Cairo time (UTC+3) -> Must be 2026-07-14
    const sBeforeMidnight = new Date('2026-07-14T20:59:59.999Z');
    const sBeforeRes = getSystemBusinessDate(sBeforeMidnight);
    console.log('  [2.2a] 20:59:59 UTC (23:59:59 Cairo Summer):', sBeforeRes);
    if (sBeforeRes !== '2026-07-14') {
      throw new Error(`Summer before midnight failed: expected 2026-07-14, got ${sBeforeRes}`);
    }

    // 21:00:00 UTC on Jul 14 is EXACTLY 00:00:00 Cairo midnight (UTC+3) -> Must be 2026-07-15
    const sAtMidnight = new Date('2026-07-14T21:00:00.000Z');
    const sAtRes = getSystemBusinessDate(sAtMidnight);
    console.log('  [2.2b] 21:00:00 UTC (00:00:00 Cairo Midnight Summer):', sAtRes);
    if (sAtRes !== '2026-07-15') {
      throw new Error(`Summer at midnight failed: expected 2026-07-15, got ${sAtRes}`);
    }

    // 21:30:00 UTC on Jul 14 is 00:30:00 Cairo time -> Must be 2026-07-15
    const sAfterMidnight = new Date('2026-07-14T21:30:00.000Z');
    const sAfterRes = getSystemBusinessDate(sAfterMidnight);
    console.log('  [2.2c] 21:30:00 UTC (00:30:00 Cairo Summer):', sAfterRes);
    if (sAfterRes !== '2026-07-15') {
      throw new Error(`Summer 12:30 AM failed: expected 2026-07-15, got ${sAfterRes}`);
    }

    // 00:00:00 UTC on Jul 15 is 03:00:00 Cairo time -> Must be 2026-07-15
    const sUtcMidnight = new Date('2026-07-15T00:00:00.000Z');
    const sUtcRes = getSystemBusinessDate(sUtcMidnight);
    console.log('  [2.2d] 00:00:00 UTC (03:00:00 Cairo Summer):', sUtcRes);
    if (sUtcRes !== '2026-07-15') {
      throw new Error(`Summer UTC midnight failed: expected 2026-07-15, got ${sUtcRes}`);
    }
    console.log('  [PASS] Cairo Summer (UTC+3) boundaries verified with 100% precision.');

    // ========================================================================
    // 3. DST TRANSITIONS IN CAIRO (SPRING FORWARD & FALL BACK)
    // ========================================================================
    console.log('\n------------------------------------------------------------------------');
    console.log('TEST 3: Egypt Daylight Saving Transition Boundaries (Law No. 24/2023)');
    console.log('------------------------------------------------------------------------');

    // 3.1 Spring Forward: Last Friday of April (April 24, 2026)
    // On April 23 at 20:00 UTC -> Cairo is 22:00 (UTC+2)
    const springBefore = new Date('2026-04-23T20:00:00Z');
    const springBeforeDate = getSystemBusinessDate(springBefore);
    const springBeforeOffset = getOffsetHours(springBefore);
    console.log(`  [3.1a] Before Spring switch (April 23): Date=${springBeforeDate}, Offset=UTC+${springBeforeOffset}`);
    if (springBeforeDate !== '2026-04-23' || springBeforeOffset !== 2) {
      throw new Error(`Spring pre-switch failed!`);
    }

    // On April 24 at 12:00 UTC -> Cairo is 15:00 (UTC+3)
    const springAfter = new Date('2026-04-24T12:00:00Z');
    const springAfterDate = getSystemBusinessDate(springAfter);
    const springAfterOffset = getOffsetHours(springAfter);
    console.log(`  [3.1b] After Spring switch (April 24): Date=${springAfterDate}, Offset=UTC+${springAfterOffset}`);
    if (springAfterDate !== '2026-04-24' || springAfterOffset !== 3) {
      throw new Error(`Spring post-switch failed!`);
    }

    // 3.2 Fall Back: Last Thursday/Friday of October (October 29/30, 2026)
    // On Oct 28 at 12:00 UTC -> Cairo is 15:00 (UTC+3)
    const fallBefore = new Date('2026-10-28T12:00:00Z');
    const fallBeforeDate = getSystemBusinessDate(fallBefore);
    const fallBeforeOffset = getOffsetHours(fallBefore);
    console.log(`  [3.2a] Before Fall switch (Oct 28): Date=${fallBeforeDate}, Offset=UTC+${fallBeforeOffset}`);
    if (fallBeforeDate !== '2026-10-28' || fallBeforeOffset !== 3) {
      throw new Error(`Fall pre-switch failed!`);
    }

    // On Oct 31 at 12:00 UTC -> Cairo is 14:00 (UTC+2)
    const fallAfter = new Date('2026-10-31T12:00:00Z');
    const fallAfterDate = getSystemBusinessDate(fallAfter);
    const fallAfterOffset = getOffsetHours(fallAfter);
    console.log(`  [3.2b] After Fall switch (Oct 31): Date=${fallAfterDate}, Offset=UTC+${fallAfterOffset}`);
    if (fallAfterDate !== '2026-10-31' || fallAfterOffset !== 2) {
      throw new Error(`Fall post-switch failed!`);
    }
    console.log('  [PASS] Egypt DST Spring Forward and Fall Back transitions verified dynamically.');

    // ========================================================================
    // 4. DATABASE INTEGRATION: CLOSED-DAY PROTECTION AT CAIRO MIDNIGHT
    // ========================================================================
    console.log('\n------------------------------------------------------------------------');
    console.log('TEST 4: PostgreSQL Database Closed-Day Protection at Cairo 12:30 AM');
    console.log('------------------------------------------------------------------------');

    // Test Winter 12:30 AM Cairo time: 2026-01-14T22:30:00Z -> maps to 2026-01-15
    const winterCairoMidnight = new Date('2026-01-14T22:30:00.000Z');
    const targetWinterDate = getSystemBusinessDate(winterCairoMidnight);

    // Clean up
    await prisma.dailyClosing.deleteMany({ where: { businessDate: targetWinterDate } });

    // Close targetWinterDate
    await prisma.dailyClosing.create({
      data: {
        businessDate: targetWinterDate,
        status: 'closed',
        closedBy: 'cairo_auditor',
        closedAt: new Date(),
        openingBalances: JSON.stringify({ EGP: 1000000 }),
        expectedBalances: JSON.stringify({ EGP: 1000000 }),
        actualBalances: JSON.stringify({ EGP: 1000000 }),
        differences: JSON.stringify({ hasVariances: false, items: [] }),
        notes: 'Winter Cairo closed day test',
      },
    });

    // Attempt financial operation on that date
    let threwAtWinterMidnight = false;
    try {
      await assertBusinessDateOpen(targetWinterDate);
    } catch (err: any) {
      threwAtWinterMidnight = true;
      console.log('  [PASS] Operation at Cairo winter midnight correctly blocked on closed day:');
      console.log(`         "${err.message}"`);
    }
    if (!threwAtWinterMidnight) {
      throw new Error('Failed to block operation at Cairo winter midnight!');
    }

    // Test Summer 12:30 AM Cairo time: 2026-07-14T21:30:00Z -> maps to 2026-07-15
    const summerCairoMidnight = new Date('2026-07-14T21:30:00.000Z');
    const targetSummerDate = getSystemBusinessDate(summerCairoMidnight);

    await prisma.dailyClosing.deleteMany({ where: { businessDate: targetSummerDate } });

    // Close targetSummerDate
    await prisma.dailyClosing.create({
      data: {
        businessDate: targetSummerDate,
        status: 'closed',
        closedBy: 'cairo_auditor',
        closedAt: new Date(),
        openingBalances: JSON.stringify({ EGP: 1000000 }),
        expectedBalances: JSON.stringify({ EGP: 1000000 }),
        actualBalances: JSON.stringify({ EGP: 1000000 }),
        differences: JSON.stringify({ hasVariances: false, items: [] }),
        notes: 'Summer Cairo closed day test',
      },
    });

    let threwAtSummerMidnight = false;
    try {
      await assertBusinessDateOpen(targetSummerDate);
    } catch (err: any) {
      threwAtSummerMidnight = true;
      console.log('  [PASS] Operation at Cairo summer midnight correctly blocked on closed day:');
      console.log(`         "${err.message}"`);
    }
    if (!threwAtSummerMidnight) {
      throw new Error('Failed to block operation at Cairo summer midnight!');
    }

    // Clean up
    await prisma.dailyClosing.deleteMany({
      where: { businessDate: { in: [targetWinterDate, targetSummerDate] } },
    });
    console.log('  [CLEANUP] Cleaned up temporary test closing records.');

    console.log('\n========================================================================');
    console.log('   ALL EGYPT (AFRICA/CAIRO) TIMEZONE AUDIT CHECKS PASSED (EXIT 0)');
    console.log('========================================================================\n');
  } catch (error: any) {
    console.error('\n[AUDIT FAILED]:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runCairoTimezoneAudit();

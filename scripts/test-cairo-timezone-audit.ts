import { PrismaClient } from '@prisma/client';
import { assertBusinessDateOpen, postLedgerTransaction } from '../lib/accounting/accounting-service';
import { getSystemBusinessDate, getSystemStartOfDay, getSystemDayRange } from '../lib/financial-core';
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
    // 3. DST TRANSITIONS IN CAIRO (DOWN TO THE EXACT SECOND & START OF DAY)
    // ========================================================================
    console.log('\n------------------------------------------------------------------------');
    console.log('TEST 3: Egypt Daylight Saving Transition Boundaries Down to the Second');
    console.log('------------------------------------------------------------------------');

    const fmtLocal = (d: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(d);

    // 3.1 Spring Forward: Exact Transition Second (April 23 -> April 24, 2026)
    // 21:59:59 UTC on April 23: 23:59:59 in Cairo (Winter, UTC+2)
    const springSecBefore = new Date('2026-04-23T21:59:59.000Z');
    const sSecBeforeDate = getSystemBusinessDate(springSecBefore);
    console.log('  [3.1a] 1 second before Spring switch (21:59:59 UTC):');
    console.log(`         Local Cairo: ${fmtLocal(springSecBefore)} | BusinessDate: ${sSecBeforeDate}`);
    if (sSecBeforeDate !== '2026-04-23') {
      throw new Error(`Expected 2026-04-23 before spring jump, got ${sSecBeforeDate}`);
    }

    // 22:00:00 UTC on April 23: Clock jumps from 00:00 to 01:00:00 on April 24 (Summer, UTC+3)
    const springSecAt = new Date('2026-04-23T22:00:00.000Z');
    const sSecAtDate = getSystemBusinessDate(springSecAt);
    console.log('  [3.1b] Exact second of Spring switch (22:00:00 UTC):');
    console.log(`         Local Cairo: ${fmtLocal(springSecAt)} | BusinessDate: ${sSecAtDate}`);
    if (sSecAtDate !== '2026-04-24') {
      throw new Error(`Expected 2026-04-24 at spring jump, got ${sSecAtDate}`);
    }

    // 3.1c Exact Start of Day verification for Spring Transition Day (April 24)
    // The skipped hour (00:00 to 01:00) means the civil day of April 24 begins exactly at 22:00:00 UTC!
    const apr24StartOfDay = getSystemStartOfDay('2026-04-24');
    console.log('  [3.1c] getSystemStartOfDay("2026-04-24"):', apr24StartOfDay.toISOString());
    if (apr24StartOfDay.toISOString() !== '2026-04-23T22:00:00.000Z') {
      throw new Error(`Expected April 24 startOfDay to be 2026-04-23T22:00:00.000Z, got ${apr24StartOfDay.toISOString()}`);
    }
    // Verify that 1 millisecond before is indeed April 23
    const apr24PreMs = new Date(apr24StartOfDay.getTime() - 1);
    if (getSystemBusinessDate(apr24PreMs) !== '2026-04-23') {
      throw new Error(`1ms before startOfDay did not map to 2026-04-23!`);
    }
    console.log('  [PASS] Spring transition: no lost hour, perfect start-of-day boundary at 22:00:00 UTC.');

    // 3.2 Fall Back: Exact Transition Second (October 29 -> October 30, 2026)
    // 20:59:59 UTC on Oct 29: 23:59:59 in Cairo (Summer pass, UTC+3)
    const fallSecSummerPass = new Date('2026-10-29T20:59:59.000Z');
    const fSecSummerDate = getSystemBusinessDate(fallSecSummerPass);
    console.log('  [3.2a] 1 second before Fall step-back (20:59:59 UTC):');
    console.log(`         Local Cairo: ${fmtLocal(fallSecSummerPass)} | BusinessDate: ${fSecSummerDate}`);
    if (fSecSummerDate !== '2026-10-29') {
      throw new Error(`Expected 2026-10-29 before fall step-back, got ${fSecSummerDate}`);
    }

    // 21:00:00 UTC on Oct 29: Clock turns back 1 hour from 24:00 to 23:00 (Winter pass, UTC+2)
    const fallSecWinterPass = new Date('2026-10-29T21:00:00.000Z');
    const fSecWinterDate = getSystemBusinessDate(fallSecWinterPass);
    console.log('  [3.2b] Exact second of Fall step-back (21:00:00 UTC):');
    console.log(`         Local Cairo: ${fmtLocal(fallSecWinterPass)} | BusinessDate: ${fSecWinterDate}`);
    if (fSecWinterDate !== '2026-10-29') {
      throw new Error(`Expected 2026-10-29 during repeated 23:00 hour, got ${fSecWinterDate}`);
    }

    // 21:59:59 UTC on Oct 29: End of repeated 23:00 hour (Winter pass)
    const fallSecEndRepeated = new Date('2026-10-29T21:59:59.000Z');
    const fSecEndRepeatedDate = getSystemBusinessDate(fallSecEndRepeated);
    if (fSecEndRepeatedDate !== '2026-10-29') {
      throw new Error(`Expected 2026-10-29 at end of repeated hour, got ${fSecEndRepeatedDate}`);
    }

    // 22:00:00 UTC on Oct 29: True winter midnight 00:00:00 of Friday October 30 (UTC+2)
    const fallSecMidnight = new Date('2026-10-29T22:00:00.000Z');
    const fSecMidnightDate = getSystemBusinessDate(fallSecMidnight);
    console.log('  [3.2c] True winter midnight (22:00:00 UTC):');
    console.log(`         Local Cairo: ${fmtLocal(fallSecMidnight)} | BusinessDate: ${fSecMidnightDate}`);
    if (fSecMidnightDate !== '2026-10-30') {
      throw new Error(`Expected 2026-10-30 at true winter midnight, got ${fSecMidnightDate}`);
    }

    // 3.2d Exact Start of Day verification for October 30
    const oct30StartOfDay = getSystemStartOfDay('2026-10-30');
    console.log('  [3.2d] getSystemStartOfDay("2026-10-30"):', oct30StartOfDay.toISOString());
    if (oct30StartOfDay.toISOString() !== '2026-10-29T22:00:00.000Z') {
      throw new Error(`Expected October 30 startOfDay to be 2026-10-29T22:00:00.000Z, got ${oct30StartOfDay.toISOString()}`);
    }
    const oct30PreMs = new Date(oct30StartOfDay.getTime() - 1);
    if (getSystemBusinessDate(oct30PreMs) !== '2026-10-29') {
      throw new Error(`1ms before startOfDay did not map to 2026-10-29!`);
    }
    console.log('  [PASS] Fall transition: no duplicate hour misattribution, start-of-day boundary exact at 22:00:00 UTC.');

    // 3.3 Continuous Day Range Verification across Transition
    const apr23Range = getSystemDayRange('2026-04-23');
    const apr24Range = getSystemDayRange('2026-04-24');
    console.log('  [3.3] Transition Continuity Check:');
    console.log(`        April 23 Range: ${apr23Range.startOfDay.toISOString()} to ${apr23Range.endOfDay.toISOString()}`);
    console.log(`        April 24 Range: ${apr24Range.startOfDay.toISOString()} to ${apr24Range.endOfDay.toISOString()}`);
    if (apr24Range.startOfDay.getTime() - apr23Range.endOfDay.getTime() !== 1) {
      throw new Error(`Gap detected between April 23 and April 24! Difference=${apr24Range.startOfDay.getTime() - apr23Range.endOfDay.getTime()}ms`);
    }
    console.log('  [PASS] Day ranges are 100% continuous without even 1 millisecond gap or overlap!');

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

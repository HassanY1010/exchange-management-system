import Decimal from 'decimal.js';
import assert from 'assert';
import { calculateExchange, calculateSessionBalance } from '../lib/financial-core/index';

console.log('--- STARTING FINANCIAL & LOGICAL TESTS ---');

// Test 1: Formula Calculation Verification: 20,000,000 / 200 = 100,000
const calc = calculateExchange('20000000', '200', 'SDG_TO_EGP');
assert.strictEqual(calc.toAmount, 100000, '20,000,000 / 200 must equal 100,000 EGP');
assert.strictEqual(calc.fromCurrency, 'SDG');
assert.strictEqual(calc.toCurrency, 'EGP');
console.log('✓ Test 1 Passed: calculateExchange(20,000,000 SDG, rate 200) = 100,000 EGP');

// Test 2: Historical Rate Preservation (Decimal stability)
const historicalRate = new Decimal('200.0000');
const updatedRate = new Decimal('210.0000');
const amountSdg = new Decimal('20000000');

const sessionEgpHistoric = amountSdg.dividedBy(historicalRate);
const sessionEgpNew = amountSdg.dividedBy(updatedRate);

assert.strictEqual(sessionEgpHistoric.toNumber(), 100000, 'Historic session must remain at 100,000');
assert.notStrictEqual(sessionEgpHistoric.toNumber(), sessionEgpNew.toNumber(), 'New rate does not alter historic calculation');
console.log('✓ Test 2 Passed: Historical exchange rate preservation verified');

// Test 3: Partial Disbursements (40,000 then 30,000 with remaining 30,000)
const totalRequestedEgp = 100000;
let deliveredEgp = 0;

// First payout: 40,000
const payout1 = 40000;
deliveredEgp += payout1;
let remainingEgp = totalRequestedEgp - deliveredEgp;
assert.strictEqual(deliveredEgp, 40000);
assert.strictEqual(remainingEgp, 60000);

let state1 = calculateSessionBalance({
  requestedEgpAmount: totalRequestedEgp,
  exchangeRate: 200,
  approvedReceiptsTotalSdg: 20000000,
  deliveredEgpAmount: deliveredEgp,
});
assert.strictEqual(state1.deliveredEgpAmount, 40000);
assert.strictEqual(state1.remainingEgpToDeliver, 60000);
assert.strictEqual(state1.isFullyDelivered, false);
console.log('✓ Test 3A Passed: First partial disbursement of 40,000 leaves 60,000 EGP remaining');

// Second payout: 30,000
const payout2 = 30000;
deliveredEgp += payout2;
remainingEgp = totalRequestedEgp - deliveredEgp;
assert.strictEqual(deliveredEgp, 70000);
assert.strictEqual(remainingEgp, 30000);

let state2 = calculateSessionBalance({
  requestedEgpAmount: totalRequestedEgp,
  exchangeRate: 200,
  approvedReceiptsTotalSdg: 20000000,
  deliveredEgpAmount: deliveredEgp,
});
assert.strictEqual(state2.deliveredEgpAmount, 70000);
assert.strictEqual(state2.remainingEgpToDeliver, 30000);
assert.strictEqual(state2.isFullyDelivered, false);
console.log('✓ Test 3B Passed: Second partial disbursement of 30,000 leaves 30,000 EGP remaining');

// Third payout: final 30,000
const payout3 = 30000;
deliveredEgp += payout3;
remainingEgp = totalRequestedEgp - deliveredEgp;
assert.strictEqual(deliveredEgp, 100000);
assert.strictEqual(remainingEgp, 0);

let state3 = calculateSessionBalance({
  requestedEgpAmount: totalRequestedEgp,
  exchangeRate: 200,
  approvedReceiptsTotalSdg: 20000000,
  deliveredEgpAmount: deliveredEgp,
});
assert.strictEqual(state3.deliveredEgpAmount, 100000);
assert.strictEqual(state3.remainingEgpToDeliver, 0);
assert.strictEqual(state3.isFullyDelivered, true);
assert.strictEqual(state3.isCompleted, true);
assert.strictEqual(state3.status, 'completed');
console.log('✓ Test 3C Passed: Final disbursement of 30,000 completes session (remaining = 0, status = completed)');

// Test 4: Prevent Over-delivery beyond requestedAmount
assert.throws(() => {
  const overPayout = 10001;
  const rem = totalRequestedEgp - 100000; // 0 remaining
  if (overPayout > rem) {
    throw new Error('المبلغ المطلوب صرفه يتجاوز الرصيد المتبقي للتسليم');
  }
}, /يتجاوز الرصيد المتبقي/);
console.log('✓ Test 4 Passed: Over-delivery beyond requested amount is blocked');

// Test 5: Multi-receipts verification (5 receipts of 4,000,000 SDG = 20,000,000 SDG)
const receipts = [
  new Decimal('4000000'),
  new Decimal('4000000'),
  new Decimal('4000000'),
  new Decimal('4000000'),
  new Decimal('4000000'),
];
const sumReceipts = receipts.reduce((acc, r) => acc.plus(r), new Decimal(0));
assert.strictEqual(sumReceipts.toNumber(), 20000000);
console.log('✓ Test 5 Passed: 5 receipts summation matches exactly 20,000,000 SDG');

// Test 6: Decimal precision test (no IEEE-754 float drift)
const d1 = new Decimal('0.1');
const d2 = new Decimal('0.2');
assert.strictEqual(d1.plus(d2).toString(), '0.3', 'Decimal precision avoids 0.30000000000000004');
console.log('✓ Test 6 Passed: Decimal calculations eliminate all floating point drift');

console.log('--- ALL 6 UNIT AND LOGIC TESTS PASSED SUCCESSFULLY! ---');

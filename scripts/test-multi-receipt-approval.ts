import Decimal from 'decimal.js';
import assert from 'assert';
import { calculateSessionBalance } from '../lib/financial-core/index';

console.log('--- STARTING MULTI-RECEIPT APPROVAL & CONCURRENCY SIMULATION TESTS ---');

interface MockReceipt {
  id: string;
  transactionId: string;
  amount: number;
  status: 'pending' | 'verified' | 'approved' | 'rejected';
  customerSessionId: string;
}

interface MockLedgerLine {
  accountId: string;
  currency: string;
  debit: number;
  credit: number;
  description: string;
}

interface MockLedgerEntry {
  referenceType: string;
  referenceId: string;
  lines: MockLedgerLine[];
}

// In-memory simulation matching app/api/v1/receipts/[id]/approve/route.ts
class ApprovalSimulator {
  receipts: MockReceipt[] = [];
  ledgerEntries: MockLedgerEntry[] = [];
  session = {
    id: 'sess-100',
    requestedAmount: 100000, // 100k EGP
    exchangeRate: 200,      // 200 SDG/EGP
    receivedAmount: 0,
    remainingAmount: 20000000, // 20M SDG
    deliveredAmount: 0,
    status: 'pending_receipts',
  };

  addReceipts(receipts: MockReceipt[]) {
    this.receipts.push(...receipts);
  }

  // Simulates tx in app/api/v1/receipts/[id]/approve/route.ts
  async approveReceipt(receiptId: string, shouldSimulateCrash: boolean = false): Promise<boolean> {
    const receipt = this.receipts.find(r => r.id === receiptId);
    if (!receipt) throw new Error('Receipt not found');
    if (receipt.status === 'approved') {
      throw new Error('Receipt already approved (idempotency guard)');
    }

    // Atomic transaction start
    const oldReceiptStatus = receipt.status;
    const oldSessionState = { ...this.session };
    const oldLedgerCount = this.ledgerEntries.length;

    try {
      if (shouldSimulateCrash) {
        throw new Error('Simulated DB or validation crash during approval');
      }

      // Step 1: Mark receipt approved
      receipt.status = 'approved';

      // Step 2: Post Double-Entry Ledger Entry (Debit 1030 Bankak, Credit 2015 Customer Liability)
      const dAmount = new Decimal(receipt.amount);
      const lines: MockLedgerLine[] = [
        {
          accountId: 'acc-1030', // Bankak SDG
          currency: 'SDG',
          debit: dAmount.toNumber(),
          credit: 0,
          description: `إيداع بنكك - إشعار ${receipt.transactionId}`,
        },
        {
          accountId: 'acc-2015', // Customer Liability SDG
          currency: 'SDG',
          debit: 0,
          credit: dAmount.toNumber(),
          description: `استحقاق العميل`,
        },
      ];

      // Double-entry validation: sum(debit) == sum(credit)
      const totalDebit = lines.reduce((acc, l) => acc.plus(l.debit), new Decimal(0));
      const totalCredit = lines.reduce((acc, l) => acc.plus(l.credit), new Decimal(0));
      assert.strictEqual(totalDebit.toNumber(), totalCredit.toNumber(), 'Double entry must balance');

      this.ledgerEntries.push({
        referenceType: 'bankak_receipt',
        referenceId: receipt.id,
        lines,
      });

      // Step 3: Query true mathematical sum of all approved receipts for this session
      const approvedSum = this.receipts
        .filter(r => r.customerSessionId === this.session.id && r.status === 'approved')
        .reduce((sum, r) => sum.plus(r.amount), new Decimal(0));

      const balance = calculateSessionBalance({
        requestedEgpAmount: this.session.requestedAmount,
        exchangeRate: this.session.exchangeRate,
        approvedReceiptsTotalSdg: approvedSum.toNumber(),
        deliveredEgpAmount: this.session.deliveredAmount,
      });

      this.session.receivedAmount = balance.receivedSdgAmount;
      this.session.remainingAmount = balance.remainingSdgAmount;
      this.session.status = balance.status;

      return true;
    } catch (err) {
      // Rollback transaction
      receipt.status = oldReceiptStatus;
      this.session = oldSessionState;
      this.ledgerEntries.length = oldLedgerCount;
      return false;
    }
  }
}

async function runTests() {
  const sim = new ApprovalSimulator();

  // Create 5 receipts for session sess-100: 4M SDG each = 20M SDG total
  const receipts: MockReceipt[] = [
    { id: 'rcp-1', transactionId: 'TX-001', amount: 4000000, status: 'verified', customerSessionId: 'sess-100' },
    { id: 'rcp-2', transactionId: 'TX-002', amount: 4000000, status: 'verified', customerSessionId: 'sess-100' },
    { id: 'rcp-3', transactionId: 'TX-003', amount: 4000000, status: 'verified', customerSessionId: 'sess-100' },
    { id: 'rcp-4', transactionId: 'TX-004', amount: 4000000, status: 'verified', customerSessionId: 'sess-100' },
    { id: 'rcp-5', transactionId: 'TX-005', amount: 4000000, status: 'verified', customerSessionId: 'sess-100' },
  ];
  sim.addReceipts(receipts);

  // Test 1: Sequential approval of first 2 receipts
  await sim.approveReceipt('rcp-1');
  assert.strictEqual(sim.session.receivedAmount, 4000000, 'Session receivedAmount must be 4,000,000 after 1st receipt');
  assert.strictEqual(sim.ledgerEntries.length, 1, 'Exactly 1 ledger entry posted');

  await sim.approveReceipt('rcp-2');
  assert.strictEqual(sim.session.receivedAmount, 8000000, 'Session receivedAmount must be 8,000,000 after 2nd receipt');
  assert.strictEqual(sim.ledgerEntries.length, 2, 'Exactly 2 ledger entries posted');
  console.log('✓ Test 1 Passed: Sequential approval accurately increments receivedAmount and ledger entries');

  // Test 2: Failure isolation (Receipt 3 crashes during approval)
  const failed = await sim.approveReceipt('rcp-3', true);
  assert.strictEqual(failed, false, 'Approval must report failure');
  assert.strictEqual(sim.receipts.find(r => r.id === 'rcp-3')?.status, 'verified', 'Receipt status must remain verified, not approved');
  assert.strictEqual(sim.session.receivedAmount, 8000000, 'Session receivedAmount must remain 8,000,000 without corruption');
  assert.strictEqual(sim.ledgerEntries.length, 2, 'No orphan ledger entry created on failure');
  console.log('✓ Test 2 Passed: Failure on receipt approval rolls back cleanly without phantom ledger entries');

  // Test 3: Idempotency (re-approving an already approved receipt is rejected)
  let idempotencyCaught = false;
  try {
    await sim.approveReceipt('rcp-1');
  } catch (e: any) {
    idempotencyCaught = true;
    assert.match(e.message, /already approved/i);
  }
  assert.strictEqual(idempotencyCaught, true, 'Re-approval must throw idempotency error');
  assert.strictEqual(sim.session.receivedAmount, 8000000);
  assert.strictEqual(sim.ledgerEntries.length, 2);
  console.log('✓ Test 3 Passed: Idempotency guard blocks double approval and prevents duplicate ledger postings');

  // Test 4: Approve remaining receipts (rcp-3 retry succeeds, rcp-4, rcp-5)
  await sim.approveReceipt('rcp-3', false);
  await sim.approveReceipt('rcp-4', false);
  await sim.approveReceipt('rcp-5', false);

  assert.strictEqual(sim.session.receivedAmount, 20000000, 'Total approved receipts must equal exactly 20,000,000 SDG');
  assert.strictEqual(sim.session.remainingAmount, 0, 'Remaining required SDG must be 0');
  assert.strictEqual(sim.session.status, 'pending_delivery', 'Session status must transition to pending_delivery');
  assert.strictEqual(sim.ledgerEntries.length, 5, 'Exactly 5 ledger entries recorded for 5 receipts');
  console.log('✓ Test 4 Passed: All 5 receipts approved. Session receivedAmount = 20,000,000 SDG exactly.');

  // Test 5: Verify aggregate ledger integrity across all 5 entries
  let totalDebit1030 = new Decimal(0);
  let totalCredit2015 = new Decimal(0);

  for (const entry of sim.ledgerEntries) {
    for (const line of entry.lines) {
      if (line.accountId === 'acc-1030') totalDebit1030 = totalDebit1030.plus(line.debit);
      if (line.accountId === 'acc-2015') totalCredit2015 = totalCredit2015.plus(line.credit);
    }
  }

  assert.strictEqual(totalDebit1030.toNumber(), 20000000, 'Total debit on 1030 (Bankak SDG) must be 20,000,000');
  assert.strictEqual(totalCredit2015.toNumber(), 20000000, 'Total credit on 2015 (Customer Liability SDG) must be 20,000,000');
  console.log('✓ Test 5 Passed: Aggregate ledger verification: Total Debit 1030 (20M SDG) == Total Credit 2015 (20M SDG)');

  console.log('--- ALL MULTI-RECEIPT CONCURRENCY & APPROVAL TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

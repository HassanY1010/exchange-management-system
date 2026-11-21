import { prisma } from '../db';
import { validateDoubleEntry } from '../financial-core';
import { logAuditEvent } from '../audit';
import Decimal from 'decimal.js';

export interface PostLedgerParams {
  entryType: string;
  referenceType?: string;
  referenceId?: string;
  entryDate?: string;
  description: string;
  createdBy: string;
  lines: {
    accountId: string;
    currency: string;
    debit: number;
    credit: number;
    description?: string;
  }[];
}

/**
 * Executes an atomic financial transaction:
 * 1. Validates double-entry (Total Debit == Total Credit)
 * 2. Writes LedgerEntry and LedgerLines
 * 3. Updates Account balances safely
 * 4. Records Audit Log
 */
export async function postLedgerTransaction(params: PostLedgerParams) {
  // Validate double entry
  const validation = validateDoubleEntry(params.lines);
  if (!validation.isValid) {
    throw new Error(validation.errorMessage || 'القيد المحاسبي غير متوازن');
  }

  const dateStr = params.entryDate || new Date().toISOString().split('T')[0];
  const entryNumber = `JE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  return await prisma.$transaction(async (tx) => {
    // 1. Lock all affected accounts in deterministic sorted order before any inserts to eliminate deadlocks and race conditions
    const uniqueAccountIds = Array.from(new Set(params.lines.map((l) => l.accountId))).sort();
    const lockedAccountsMap = new Map<string, any>();

    for (const accId of uniqueAccountIds) {
      const rows = await tx.$queryRawUnsafe<any[]>(
        'SELECT id, "accountCode", "name", "accountType", "currency", "currentBalance" FROM "Account" WHERE id = $1 FOR UPDATE',
        accId
      );
      if (!rows || rows.length === 0) {
        throw new Error(`الحساب المالي رقم ${accId} غير موجود`);
      }
      lockedAccountsMap.set(accId, rows[0]);
    }

    // 2. Pre-verify that withdrawals do not cause negative balances
    for (const line of params.lines) {
      const account = lockedAccountsMap.get(line.accountId);
      const dCurrent = new Decimal(account.currentBalance?.toString() || '0');
      const dDebit = new Decimal(line.debit || 0);
      const dCredit = new Decimal(line.credit || 0);

      if (['cash_safe', 'bank', 'bankak', 'employee_custody', 'expense'].includes(account.accountType)) {
        const after = dCurrent.plus(dDebit).minus(dCredit);
        if (after.isNegative() && ['cash_safe', 'employee_custody'].includes(account.accountType) && !['1060', '1065'].includes(account.accountCode) && account.accountType !== 'clearing') {
          throw new Error(`رصيد الحساب ${account.name} غير كافٍ. الرصيد المتاح: ${dCurrent.toFixed(2)}، والمطلوب خصمه: ${dCredit.toFixed(2)}`);
        }
      }
    }

    // 3. Create Ledger Entry
    const entry = await tx.ledgerEntry.create({
      data: {
        entryNumber,
        entryType: params.entryType,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        entryDate: dateStr,
        description: params.description,
        status: 'posted',
        createdBy: params.createdBy,
        lines: {
          create: params.lines.map((l) => ({
            accountId: l.accountId,
            currency: l.currency,
            debit: new Decimal(l.debit || 0).toFixed(4),
            credit: new Decimal(l.credit || 0).toFixed(4),
            description: l.description || params.description,
          })),
        },
      },
      include: {
        lines: true,
      },
    });

    // 4. Update current balances of all affected accounts based on account type
    for (const line of params.lines) {
      const account = lockedAccountsMap.get(line.accountId);
      const dCurrent = new Decimal(account.currentBalance?.toString() || '0');
      const dDebit = new Decimal(line.debit || 0);
      const dCredit = new Decimal(line.credit || 0);

      let newBalance: Decimal;
      if (['cash_safe', 'bank', 'bankak', 'employee_custody', 'expense'].includes(account.accountType)) {
        newBalance = dCurrent.plus(dDebit).minus(dCredit);
      } else {
        newBalance = dCurrent.plus(dCredit).minus(dDebit);
      }

      await tx.account.update({
        where: { id: account.id },
        data: { currentBalance: newBalance.toFixed(4) },
      });
      // Update local map balance in case the same account appears multiple times in lines
      account.currentBalance = newBalance.toFixed(4);
    }

    // Log to Audit Trail
    await logAuditEvent({
      userId: params.createdBy,
      action: 'POST_LEDGER_ENTRY',
      entityType: 'LedgerEntry',
      entityId: entry.id,
      newValues: { entryNumber, linesCount: params.lines.length, amount: validation.totalDebit },
      reason: params.description,
    });

    return entry;
  });
}

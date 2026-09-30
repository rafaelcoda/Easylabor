import { ledger } from '@diaria/core';
import type { Sql } from '../db';

/** Grava lançamentos do ledger. O gatilho deferido do banco confere o balanço ao fim da transação. */
export async function writeLedger(tx: Sql, bookingId: string, entries: ledger.LedgerEntry[]): Promise<void> {
  if (entries.length === 0) return;
  ledger.assertBalanced(entries);
  const rows = entries.map((e) => ({
    transaction_id: e.transactionId,
    account: e.account,
    direction: e.direction,
    amount_cents: e.amountCents,
    booking_id: bookingId,
    reference_type: e.referenceType,
    reference_id: e.referenceId,
  }));
  await tx`INSERT INTO ledger_entries ${tx(rows)}`;
}

export const newRef = (referenceType: string, referenceId: string) => ({
  transactionId: crypto.randomUUID(),
  referenceType,
  referenceId,
});

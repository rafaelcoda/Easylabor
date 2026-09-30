import type { Cents } from './money';
import type { Quote } from './pricing';

export type LedgerAccount = 'bank' | 'escrow' | 'professional' | 'platform_revenue' | 'provider_fees' | 'insurance';
export type Direction = 'debit' | 'credit';

export interface LedgerEntry {
  transactionId: string;
  account: LedgerAccount;
  direction: Direction;
  amountCents: Cents;
  referenceType: string;
  referenceId: string;
}

interface Ref {
  transactionId: string;
  referenceType: string;
  referenceId: string;
}

const pair = (ref: Ref, debit: LedgerAccount, credit: LedgerAccount, amountCents: Cents): LedgerEntry[] =>
  amountCents === 0
    ? []
    : [
        { ...ref, account: debit, direction: 'debit', amountCents },
        { ...ref, account: credit, direction: 'credit', amountCents },
      ];

/** Pagamento confirmado: débito em bank, crédito em escrow (especificação 7.3). */
export const paymentConfirmed = (ref: Ref, totalCents: Cents) => pair(ref, 'bank', 'escrow', totalCents);

/** Pedido aprovado: escrow paga o profissional (diária − comissão) e a plataforma (taxa + comissão). */
export function bookingApproved(ref: Ref, q: Quote): LedgerEntry[] {
  return [
    ...pair(ref, 'escrow', 'professional', q.professionalNetCents),
    ...pair(ref, 'escrow', 'platform_revenue', q.clientFeeCents + q.commissionCents),
  ];
}

/** Custo do provedor (tarifa de Pix ou cartão). */
export const providerFee = (ref: Ref, feeCents: Cents) => pair(ref, 'provider_fees', 'bank', feeCents);

/** Repasse pago ao profissional. */
export const payoutPaid = (ref: Ref, netCents: Cents) => pair(ref, 'professional', 'bank', netCents);

/** Estorno (total ou parcial) ao cliente. */
export const refund = (ref: Ref, amountCents: Cents) => pair(ref, 'escrow', 'bank', amountCents);

/** Compensação retida (cancelamento tardio ou no-show do cliente): escrow para o profissional. */
export const compensation = (ref: Ref, amountCents: Cents) => pair(ref, 'escrow', 'professional', amountCents);

export function assertBalanced(entries: LedgerEntry[]): void {
  const byTx = new Map<string, number>();
  for (const e of entries) {
    const signed = e.direction === 'debit' ? e.amountCents : -e.amountCents;
    byTx.set(e.transactionId, (byTx.get(e.transactionId) ?? 0) + signed);
  }
  for (const [tx, sum] of byTx) {
    if (sum !== 0) throw new Error(`Transação ${tx} desbalanceada em ${sum} centavos`);
  }
}

/** Saldo de uma conta: débitos menos créditos. */
export function balance(entries: LedgerEntry[], account: LedgerAccount): Cents {
  return entries
    .filter((e) => e.account === account)
    .reduce((acc, e) => acc + (e.direction === 'debit' ? e.amountCents : -e.amountCents), 0);
}

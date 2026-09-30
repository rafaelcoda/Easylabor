import { describe, expect, it } from 'vitest';
import { ledger, quote, type Quote } from '../src';

const ref = (n: string) => ({ transactionId: `tx-${n}`, referenceType: 'booking', referenceId: 'bkg-1' });
const q: Quote = quote(20000);

describe('ledger em partidas dobradas', () => {
  it('todo lançamento é balanceado', () => {
    const all = [
      ...ledger.paymentConfirmed(ref('1'), q.totalCents),
      ...ledger.bookingApproved(ref('2'), q),
      ...ledger.providerFee(ref('3'), 210),
      ...ledger.payoutPaid(ref('4'), q.professionalNetCents),
      ...ledger.refund(ref('5'), 5000),
      ...ledger.compensation(ref('6'), 4000),
    ];
    expect(() => ledger.assertBalanced(all)).not.toThrow();
  });

  it('detecta lançamento desbalanceado', () => {
    const bad = [{ ...ref('x'), account: 'bank' as const, direction: 'debit' as const, amountCents: 100, referenceType: 'booking', referenceId: 'b' }];
    expect(() => ledger.assertBalanced(bad)).toThrow(/desbalanceada/);
  });

  it('ciclo completo: o escrow zera e a plataforma fica com taxa + comissão', () => {
    const entries = [
      ...ledger.paymentConfirmed(ref('1'), q.totalCents),
      ...ledger.bookingApproved(ref('2'), q),
      ...ledger.payoutPaid(ref('4'), q.professionalNetCents),
    ];
    expect(ledger.balance(entries, 'escrow')).toBe(0);
    expect(ledger.balance(entries, 'professional')).toBe(0);
    expect(-ledger.balance(entries, 'platform_revenue')).toBe(q.clientFeeCents + q.commissionCents); // 3400
    expect(ledger.balance(entries, 'bank')).toBe(q.totalCents - q.professionalNetCents); // dinheiro que sobra no banco
  });

  it('estorno total devolve ao cliente e zera o escrow', () => {
    const entries = [...ledger.paymentConfirmed(ref('1'), q.totalCents), ...ledger.refund(ref('2'), q.totalCents)];
    expect(ledger.balance(entries, 'escrow')).toBe(0);
    expect(ledger.balance(entries, 'bank')).toBe(0);
  });

  it('cancelamento tardio: compensação ao profissional e estorno do resto fecham o escrow', () => {
    const entries = [
      ...ledger.paymentConfirmed(ref('1'), q.totalCents),
      ...ledger.compensation(ref('2'), 4000),
      ...ledger.refund(ref('3'), q.totalCents - 4000),
    ];
    expect(ledger.balance(entries, 'escrow')).toBe(0);
    expect(-ledger.balance(entries, 'professional')).toBe(4000);
  });

  it('valores zero não geram lançamentos', () => {
    expect(ledger.providerFee(ref('z'), 0)).toEqual([]);
  });
});

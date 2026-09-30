import { describe, expect, it } from 'vitest';
import { advanceQuote, applyBps, formatBRL, quote } from '../src';

describe('pricing', () => {
  it('reproduz o exemplo do PRD: diária de R$ 200', () => {
    expect(quote(20000)).toEqual({
      dailyRateCents: 20000,
      clientFeeCents: 1000,
      totalCents: 21000,
      commissionCents: 2400,
      professionalNetCents: 17600,
      currency: 'BRL',
    });
  });

  it('arredonda meio para cima e mantém inteiros', () => {
    const q = quote(15050); // 5% = 752,5 -> 753; 12% = 1806
    expect(q.clientFeeCents).toBe(753);
    expect(q.commissionCents).toBe(1806);
    expect(Number.isInteger(q.totalCents)).toBe(true);
    expect(q.totalCents).toBe(q.dailyRateCents + q.clientFeeCents);
    expect(q.professionalNetCents).toBe(q.dailyRateCents - q.commissionCents);
  });

  it('recusa valores inválidos', () => {
    expect(() => quote(-1)).toThrow(RangeError);
    expect(() => quote(10.5)).toThrow(RangeError);
    expect(() => applyBps(100, 1.5)).toThrow(RangeError);
  });

  it('antecipação de R$ 176,00 a 3% gera taxa de R$ 5,28', () => {
    expect(advanceQuote(17600)).toEqual({ netBeforeFeeCents: 17600, advanceFeeCents: 528, advanceCents: 17072, feeBps: 300 });
  });

  it('formata em reais', () => {
    expect(formatBRL(21000)).toBe('R$ 210,00');
    expect(formatBRL(5)).toBe('R$ 0,05');
  });
});

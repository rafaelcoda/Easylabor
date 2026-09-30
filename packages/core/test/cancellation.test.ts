import { describe, expect, it } from 'vitest';
import { afterUnaccepted, clientCancellation, clientNoShow, professionalCancellation, professionalNoShow, quote, shouldSuspend } from '../src';

const q = quote(20000); // total 21000, diária 20000

describe('cancelamento pelo cliente (PRD 7.2)', () => {
  it('antes do aceite: sem custo', () => {
    expect(clientCancellation({ status: 'requested', hoursUntilStart: 2, enRoute: false, quote: q })).toEqual({ refundCents: 21000, compensationCents: 0, strike: false });
  });

  it('antes do pagamento confirmado não há o que estornar', () => {
    expect(clientCancellation({ status: 'awaiting_payment', hoursUntilStart: 48, enRoute: false, quote: q }).refundCents).toBe(0);
  });

  it('aceito, com mais de 24 h: estorno integral', () => {
    const o = clientCancellation({ status: 'accepted', hoursUntilStart: 30, enRoute: false, quote: q });
    expect(o).toEqual({ refundCents: 21000, compensationCents: 0, strike: false });
  });

  it('aceito, entre 24 h e 4 h: retém 20% da diária', () => {
    const o = clientCancellation({ status: 'accepted', hoursUntilStart: 10, enRoute: false, quote: q });
    expect(o.compensationCents).toBe(4000);
    expect(o.refundCents).toBe(17000);
  });

  it('aceito, com menos de 4 h: retém 50% da diária', () => {
    const o = clientCancellation({ status: 'accepted', hoursUntilStart: 3, enRoute: false, quote: q });
    expect(o.compensationCents).toBe(10000);
    expect(o.refundCents).toBe(11000);
  });

  it('com o profissional a caminho: retém 50% mesmo com mais de 4 h', () => {
    const o = clientCancellation({ status: 'en_route', hoursUntilStart: 6, enRoute: true, quote: q });
    expect(o.compensationCents).toBe(10000);
  });

  it('reembolso mais compensação sempre fecha o total pago', () => {
    for (const h of [0, 1, 3.9, 4, 10, 23.9, 24, 100]) {
      const o = clientCancellation({ status: 'accepted', hoursUntilStart: h, enRoute: false, quote: q });
      expect(o.refundCents + o.compensationCents).toBe(q.totalCents);
    }
  });

  it('não permite cancelar depois do check-in', () => {
    expect(() => clientCancellation({ status: 'in_progress', hoursUntilStart: 0, enRoute: false, quote: q })).toThrow(RangeError);
  });
});

describe('cancelamento e no-show do profissional', () => {
  it('estorno integral; strike só com menos de 24 h', () => {
    expect(professionalCancellation(30, q)).toEqual({ refundCents: 21000, compensationCents: 0, strike: false });
    expect(professionalCancellation(23, q).strike).toBe(true);
  });

  it('no-show do profissional: estorno integral e strike', () => {
    expect(professionalNoShow(q)).toEqual({ refundCents: 21000, compensationCents: 0, strike: true });
  });

  it('no-show do cliente: profissional recebe 50% da diária', () => {
    const o = clientNoShow(q);
    expect(o.compensationCents).toBe(10000);
    expect(o.refundCents).toBe(11000);
  });

  it('suspende com 3 strikes em 30 dias', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    const d = (days: number) => new Date(now.getTime() - days * 86_400_000);
    expect(shouldSuspend([d(1), d(10), d(29)], now)).toBe(true);
    expect(shouldSuspend([d(1), d(10), d(31)], now)).toBe(false);
    expect(shouldSuspend([d(1), d(2)], now)).toBe(false);
  });
});

describe('reenvio após recusa ou prazo vencido', () => {
  it('reenvia até 3 tentativas e depois estorna', () => {
    expect(afterUnaccepted(1)).toBe('resend');
    expect(afterUnaccepted(2)).toBe('resend');
    expect(afterUnaccepted(3)).toBe('refund');
  });
});

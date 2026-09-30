import { DEFAULT_CONFIG, type Config } from './config';
import { applyBps, assertCents, type Cents } from './money';

export interface Quote {
  dailyRateCents: Cents;
  clientFeeCents: Cents;
  /** Total cobrado do cliente: diária + taxa de serviço. */
  totalCents: Cents;
  commissionCents: Cents;
  /** Valor líquido do profissional: diária − comissão. */
  professionalNetCents: Cents;
  currency: 'BRL';
}

export function quote(dailyRateCents: Cents, cfg: Config = DEFAULT_CONFIG): Quote {
  assertCents(dailyRateCents, 'diária');
  const clientFeeCents = applyBps(dailyRateCents, cfg.clientFeeBps);
  const commissionCents = applyBps(dailyRateCents, cfg.commissionBps);
  return {
    dailyRateCents,
    clientFeeCents,
    totalCents: dailyRateCents + clientFeeCents,
    commissionCents,
    professionalNetCents: dailyRateCents - commissionCents,
    currency: 'BRL',
  };
}

export interface AdvanceQuote {
  netBeforeFeeCents: Cents;
  advanceFeeCents: Cents;
  advanceCents: Cents;
  feeBps: number;
}

/** Antecipação do repasse (fase 2): valor líquido menos a taxa de antecipação. */
export function advanceQuote(netCents: Cents, feeBps: number = DEFAULT_CONFIG.advanceFeeBps): AdvanceQuote {
  assertCents(netCents, 'valor líquido');
  const advanceFeeCents = applyBps(netCents, feeBps);
  return { netBeforeFeeCents: netCents, advanceFeeCents, advanceCents: netCents - advanceFeeCents, feeBps };
}

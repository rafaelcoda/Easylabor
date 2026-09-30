import { DEFAULT_CONFIG, type Config } from './config';
import { applyBps, type Cents } from './money';
import type { Quote } from './pricing';
import type { BookingStatus } from './bookingStateMachine';

export interface CancellationOutcome {
  /** Valor devolvido ao cliente. */
  refundCents: Cents;
  /** Valor retido para compensar o profissional (PRD 7.2). */
  compensationCents: Cents;
  /** Penalidade (strike) ao autor do cancelamento. */
  strike: boolean;
}

export interface ClientCancelInput {
  status: BookingStatus;
  /** Horas até o início do serviço (pode ser negativo se já começou o horário). */
  hoursUntilStart: number;
  enRoute: boolean;
  quote: Quote;
}

/**
 * Cancelamento pelo cliente (PRD 7.2). A retenção incide sobre a diária; a taxa de
 * serviço é devolvida. Premissa a confirmar: a compensação vai integralmente ao profissional.
 */
export function clientCancellation(input: ClientCancelInput, cfg: Config = DEFAULT_CONFIG): CancellationOutcome {
  const { status, hoursUntilStart, enRoute, quote } = input;
  if (status === 'awaiting_payment' || status === 'requested') {
    return { refundCents: status === 'awaiting_payment' ? 0 : quote.totalCents, compensationCents: 0, strike: false };
  }
  if (status !== 'accepted' && status !== 'en_route') {
    throw new RangeError(`Cliente não pode cancelar no estado "${status}"`);
  }
  const c = cfg.cancellation;
  let retainBps = 0;
  if (enRoute || status === 'en_route' || hoursUntilStart < c.partialHours) retainBps = c.lateRetainBps;
  else if (hoursUntilStart < c.freeHours) retainBps = c.partialRetainBps;
  const compensationCents = applyBps(quote.dailyRateCents, retainBps);
  return { refundCents: quote.totalCents - compensationCents, compensationCents, strike: false };
}

/** Cancelamento pelo profissional: estorno integral ao cliente; strike se faltam menos de 24 h. */
export function professionalCancellation(
  hoursUntilStart: number,
  quote: Quote,
  cfg: Config = DEFAULT_CONFIG,
): CancellationOutcome {
  return { refundCents: quote.totalCents, compensationCents: 0, strike: hoursUntilStart < cfg.cancellation.freeHours };
}

/** No-show do profissional: estorno integral e strike. */
export function professionalNoShow(quote: Quote): CancellationOutcome {
  return { refundCents: quote.totalCents, compensationCents: 0, strike: true };
}

/** No-show do cliente: o profissional recebe 50% da diária; o restante é devolvido. */
export function clientNoShow(quote: Quote, cfg: Config = DEFAULT_CONFIG): CancellationOutcome {
  const compensationCents = applyBps(quote.dailyRateCents, cfg.clientNoShowCompensationBps);
  return { refundCents: quote.totalCents - compensationCents, compensationCents, strike: false };
}

/** Suspensão após N strikes dentro da janela (PRD 7.2: 3 em 30 dias). */
export function shouldSuspend(strikeDates: Date[], now: Date, cfg: Config = DEFAULT_CONFIG): boolean {
  const since = now.getTime() - cfg.strikeWindowDays * 86_400_000;
  return strikeDates.filter((d) => d.getTime() >= since && d.getTime() <= now.getTime()).length >= cfg.strikesToSuspend;
}

/** Após recusa ou prazo vencido: reenviar ao próximo do ranking ou estornar (PRD RF-33). */
export function afterUnaccepted(attempt: number, cfg: Config = DEFAULT_CONFIG): 'resend' | 'refund' {
  return attempt < cfg.maxResendAttempts ? 'resend' : 'refund';
}

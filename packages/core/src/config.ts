/**
 * Parâmetros de negócio. Valores iniciais do PRD (seções 6, 7 e 12); todos devem
 * poder ser alterados por configuração (tabela config_settings), não no código.
 * Taxas em pontos-base (bps): 100 bps = 1%.
 */
export interface CancellationConfig {
  /** Acima disto (horas antes do início) o cliente cancela sem custo. */
  freeHours: number;
  /** Entre freeHours e partialHours retém partialRetainBps da diária. */
  partialHours: number;
  partialRetainBps: number;
  /** Abaixo de partialHours, ou com o profissional a caminho. */
  lateRetainBps: number;
}

export interface RankingWeights {
  proximity: number;
  rating: number;
  acceptance: number;
  price: number;
  attendance: number;
}

export interface Config {
  clientFeeBps: number;
  commissionBps: number;
  advanceFeeBps: number;

  acceptDeadlineMinutes: number;
  acceptDeadlineShortMinutes: number;
  shortNoticeThresholdMinutes: number;
  maxResendAttempts: number;
  pixExpiryMinutes: number;

  lateAlertMinutes: number;
  noShowMinutes: number;
  checkInWindowBeforeMinutes: number;
  checkInRadiusMeters: number;

  autoApproveHours: number;
  disputeWindowHours: number;
  payoutDelayHours: number;

  cancellation: CancellationConfig;
  clientNoShowCompensationBps: number;

  strikesToSuspend: number;
  strikeWindowDays: number;

  rankingWeights: RankingWeights;
}

export const DEFAULT_CONFIG: Config = {
  clientFeeBps: 500,
  commissionBps: 1200,
  advanceFeeBps: 300,

  acceptDeadlineMinutes: 15,
  acceptDeadlineShortMinutes: 5,
  shortNoticeThresholdMinutes: 120,
  maxResendAttempts: 3,
  pixExpiryMinutes: 30,

  lateAlertMinutes: 30,
  noShowMinutes: 60,
  checkInWindowBeforeMinutes: 30,
  checkInRadiusMeters: 300,

  autoApproveHours: 24,
  disputeWindowHours: 24,
  payoutDelayHours: 48,

  cancellation: { freeHours: 24, partialHours: 4, partialRetainBps: 2000, lateRetainBps: 5000 },
  clientNoShowCompensationBps: 5000,

  strikesToSuspend: 3,
  strikeWindowDays: 30,

  rankingWeights: { proximity: 0.3, rating: 0.25, acceptance: 0.2, price: 0.15, attendance: 0.1 },
};

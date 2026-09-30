import { DEFAULT_CONFIG, type Config } from './config';

const MIN = 60_000;
const HOUR = 3_600_000;
const add = (d: Date, ms: number) => new Date(d.getTime() + ms);

/** Prazo de aceite: 15 min, ou 5 min se o serviço começa em menos de 2 h. */
export function acceptDeadline(requestedAt: Date, startsAt: Date, cfg: Config = DEFAULT_CONFIG): Date {
  const short = startsAt.getTime() - requestedAt.getTime() < cfg.shortNoticeThresholdMinutes * MIN;
  return add(requestedAt, (short ? cfg.acceptDeadlineShortMinutes : cfg.acceptDeadlineMinutes) * MIN);
}

export const pixExpiresAt = (createdAt: Date, cfg: Config = DEFAULT_CONFIG) => add(createdAt, cfg.pixExpiryMinutes * MIN);
export const lateAlertAt = (startsAt: Date, cfg: Config = DEFAULT_CONFIG) => add(startsAt, cfg.lateAlertMinutes * MIN);
export const noShowAt = (startsAt: Date, cfg: Config = DEFAULT_CONFIG) => add(startsAt, cfg.noShowMinutes * MIN);
export const autoApproveAt = (checkOutAt: Date, cfg: Config = DEFAULT_CONFIG) => add(checkOutAt, cfg.autoApproveHours * HOUR);
export const autoApproveWarningAt = (checkOutAt: Date, cfg: Config = DEFAULT_CONFIG) => add(checkOutAt, (cfg.autoApproveHours / 2) * HOUR);
export const disputeDeadlineAt = (checkOutAt: Date, cfg: Config = DEFAULT_CONFIG) => add(checkOutAt, cfg.disputeWindowHours * HOUR);
export const payoutScheduledFor = (approvedAt: Date, cfg: Config = DEFAULT_CONFIG) => add(approvedAt, cfg.payoutDelayHours * HOUR);

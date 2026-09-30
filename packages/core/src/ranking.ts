import { DEFAULT_CONFIG, type Config } from './config';

export interface RankingInput {
  distanceM: number;
  /** Raio de atuação do profissional, em metros. */
  radiusM: number;
  /** Nota média de 0 a 5. */
  rating: number;
  /** Taxas de 0 a 1. */
  acceptanceRate: number;
  attendanceRate: number;
  dailyRateCents: number;
  /** Faixa de preço da categoria. */
  minRateCents: number;
  maxRateCents: number;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * Score de relevância (PRD 7.6): 0,30 proximidade + 0,25 nota + 0,20 aceite +
 * 0,15 preço (menor é melhor) + 0,10 presença. Cada fator normalizado de 0 a 1.
 */
export function relevanceScore(i: RankingInput, cfg: Config = DEFAULT_CONFIG): number {
  const w = cfg.rankingWeights;
  const proximity = 1 - clamp01(i.radiusM > 0 ? i.distanceM / i.radiusM : 1);
  const rating = clamp01(i.rating / 5);
  const span = i.maxRateCents - i.minRateCents;
  const price = span > 0 ? 1 - clamp01((i.dailyRateCents - i.minRateCents) / span) : 1;
  return (
    w.proximity * proximity +
    w.rating * rating +
    w.acceptance * clamp01(i.acceptanceRate) +
    w.price * price +
    w.attendance * clamp01(i.attendanceRate)
  );
}

export function rankProfessionals<T extends { id: string } & RankingInput>(items: T[], cfg: Config = DEFAULT_CONFIG): Array<T & { score: number }> {
  return items
    .map((i) => ({ ...i, score: relevanceScore(i, cfg) }))
    .sort((a, b) => b.score - a.score || a.distanceM - b.distanceM || a.id.localeCompare(b.id));
}

import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, rankProfessionals, relevanceScore, type RankingInput } from '../src';

const base: RankingInput = {
  distanceM: 3000, radiusM: 10_000, rating: 4.5, acceptanceRate: 0.8, attendanceRate: 0.95,
  dailyRateCents: 20000, minRateCents: 10000, maxRateCents: 30000,
};

describe('ranking', () => {
  it('os pesos somam 1', () => {
    const w = DEFAULT_CONFIG.rankingWeights;
    expect(w.proximity + w.rating + w.acceptance + w.price + w.attendance).toBeCloseTo(1, 10);
  });

  it('score fica entre 0 e 1', () => {
    const best = relevanceScore({ ...base, distanceM: 0, rating: 5, acceptanceRate: 1, attendanceRate: 1, dailyRateCents: 10000 });
    const worst = relevanceScore({ ...base, distanceM: 99_999, rating: 0, acceptanceRate: 0, attendanceRate: 0, dailyRateCents: 30000 });
    expect(best).toBeCloseTo(1, 10);
    expect(worst).toBeCloseTo(0, 10);
  });

  it('mais perto, melhor nota e preço menor aumentam o score', () => {
    const s = relevanceScore(base);
    expect(relevanceScore({ ...base, distanceM: 1000 })).toBeGreaterThan(s);
    expect(relevanceScore({ ...base, rating: 4.9 })).toBeGreaterThan(s);
    expect(relevanceScore({ ...base, dailyRateCents: 15000 })).toBeGreaterThan(s);
  });

  it('ordena do maior para o menor score, com desempate por distância', () => {
    const r = rankProfessionals([
      { id: 'b', ...base, rating: 4.0 },
      { id: 'a', ...base, rating: 4.9 },
      { id: 'c', ...base, rating: 4.0, distanceM: 2000 },
    ]);
    expect(r.map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });

  it('trata dados ausentes sem quebrar', () => {
    expect(relevanceScore({ ...base, acceptanceRate: Number.NaN })).toBeGreaterThan(0);
    expect(relevanceScore({ ...base, minRateCents: 100, maxRateCents: 100 })).toBeGreaterThan(0);
  });
});

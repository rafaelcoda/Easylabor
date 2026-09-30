import { DEFAULT_CONFIG, type Config } from './config';

export interface Point {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distância em metros entre dois pontos (fórmula de haversine). */
export function distanceMeters(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type CheckInResult =
  | { ok: true; distanceM: number }
  | { ok: false; code: 'checkin_too_far' | 'checkin_too_early'; distanceM: number };

/** Check-in liberado a até 300 m do endereço e a partir de 30 min antes do início (RF-41). */
export function validateCheckIn(
  input: { position: Point; address: Point; now: Date; startsAt: Date },
  cfg: Config = DEFAULT_CONFIG,
): CheckInResult {
  const distanceM = Math.round(distanceMeters(input.position, input.address));
  const opensAt = input.startsAt.getTime() - cfg.checkInWindowBeforeMinutes * 60_000;
  if (input.now.getTime() < opensAt) return { ok: false, code: 'checkin_too_early', distanceM };
  if (distanceM > cfg.checkInRadiusMeters) return { ok: false, code: 'checkin_too_far', distanceM };
  return { ok: true, distanceM };
}

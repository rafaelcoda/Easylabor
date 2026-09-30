import { describe, expect, it } from 'vitest';
import { distanceMeters, validateCheckIn } from '../src';

const address = { lat: -20.2731, lng: -40.2785 };
const startsAt = new Date('2026-10-07T11:00:00Z');

describe('check-in', () => {
  it('distância de um ponto para ele mesmo é zero', () => {
    expect(distanceMeters(address, address)).toBe(0);
  });

  it('1 grau de latitude vale cerca de 111 km', () => {
    const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('aceita a 48 m do endereço, no horário', () => {
    const r = validateCheckIn({ position: { lat: -20.27353, lng: -40.27881 }, address, now: new Date('2026-10-07T11:02:00Z'), startsAt });
    expect(r.ok).toBe(true);
  });

  it('recusa a mais de 300 m', () => {
    const r = validateCheckIn({ position: { lat: -20.2781, lng: -40.2785 }, address, now: startsAt, startsAt });
    expect(r).toMatchObject({ ok: false, code: 'checkin_too_far' });
  });

  it('só abre 30 min antes do início', () => {
    const tooEarly = validateCheckIn({ position: address, address, now: new Date('2026-10-07T10:29:00Z'), startsAt });
    expect(tooEarly).toMatchObject({ ok: false, code: 'checkin_too_early' });
    const opens = validateCheckIn({ position: address, address, now: new Date('2026-10-07T10:30:00Z'), startsAt });
    expect(opens.ok).toBe(true);
  });
});

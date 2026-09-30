import { describe, expect, it } from 'vitest';
import { acceptDeadline, autoApproveAt, autoApproveWarningAt, disputeDeadlineAt, lateAlertAt, noShowAt, payoutScheduledFor, pixExpiresAt } from '../src';

const t = (s: string) => new Date(s);

describe('prazos', () => {
  it('aceite em 15 min com antecedência normal', () => {
    expect(acceptDeadline(t('2026-10-06T10:00:00Z'), t('2026-10-07T11:00:00Z')).toISOString()).toBe('2026-10-06T10:15:00.000Z');
  });

  it('aceite em 5 min quando o serviço começa em menos de 2 h', () => {
    expect(acceptDeadline(t('2026-10-07T10:00:00Z'), t('2026-10-07T11:30:00Z')).toISOString()).toBe('2026-10-07T10:05:00.000Z');
  });

  it('demais prazos do PRD', () => {
    expect(pixExpiresAt(t('2026-10-07T10:00:00Z')).toISOString()).toBe('2026-10-07T10:30:00.000Z');
    expect(lateAlertAt(t('2026-10-07T11:00:00Z')).toISOString()).toBe('2026-10-07T11:30:00.000Z');
    expect(noShowAt(t('2026-10-07T11:00:00Z')).toISOString()).toBe('2026-10-07T12:00:00.000Z');
    expect(autoApproveWarningAt(t('2026-10-07T19:00:00Z')).toISOString()).toBe('2026-10-08T07:00:00.000Z');
    expect(autoApproveAt(t('2026-10-07T19:00:00Z')).toISOString()).toBe('2026-10-08T19:00:00.000Z');
    expect(disputeDeadlineAt(t('2026-10-07T19:00:00Z')).toISOString()).toBe('2026-10-08T19:00:00.000Z');
    expect(payoutScheduledFor(t('2026-10-08T19:00:00Z')).toISOString()).toBe('2026-10-10T19:00:00.000Z');
  });
});

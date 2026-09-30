import { describe, expect, it } from 'vitest';
import {
  InvalidTransitionError,
  TRANSITIONS,
  availableActions,
  isTerminal,
  transition,
  type BookingAction,
  type BookingStatus,
} from '../src';

describe('máquina de estados do pedido', () => {
  it('percorre o caminho feliz até o pagamento', () => {
    let s: BookingStatus = 'awaiting_payment';
    s = transition(s, 'payment_confirmed', 'system');
    s = transition(s, 'accept', 'professional');
    s = transition(s, 'en_route', 'professional');
    s = transition(s, 'check_in', 'professional');
    s = transition(s, 'check_out', 'professional');
    s = transition(s, 'approve', 'client');
    s = transition(s, 'payout_paid', 'system');
    expect(s).toBe('paid');
    expect(isTerminal(s)).toBe(true);
  });

  it('disputa termina em aprovação ou reembolso, decididos só pelo admin', () => {
    expect(transition('completed', 'dispute', 'client')).toBe('disputed');
    expect(transition('disputed', 'resolve_release', 'admin')).toBe('approved');
    expect(transition('disputed', 'resolve_refund', 'admin')).toBe('refunded');
    expect(() => transition('disputed', 'resolve_refund', 'client')).toThrow(InvalidTransitionError);
  });

  it('rejeita transição fora da tabela com código invalid_transition', () => {
    try {
      transition('in_progress', 'cancel_by_client', 'client');
      throw new Error('deveria falhar');
    } catch (e) {
      expect((e as InvalidTransitionError).code).toBe('invalid_transition');
    }
  });

  it('rejeita ator não autorizado com código forbidden_actor', () => {
    try {
      transition('requested', 'accept', 'client');
      throw new Error('deveria falhar');
    } catch (e) {
      expect((e as InvalidTransitionError).code).toBe('forbidden_actor');
    }
  });

  it('estados terminais não aceitam nenhuma ação', () => {
    const terminals: BookingStatus[] = ['declined', 'expired', 'paid', 'refunded', 'cancelled_by_client', 'cancelled_by_professional', 'no_show_professional', 'no_show_client'];
    for (const s of terminals) {
      for (const actor of ['client', 'professional', 'admin', 'system'] as const) {
        expect(availableActions(s, actor)).toEqual([]);
      }
    }
  });

  it('o cliente só cancela antes da execução', () => {
    for (const s of ['awaiting_payment', 'requested', 'accepted', 'en_route'] as BookingStatus[]) {
      expect(transition(s, 'cancel_by_client', 'client')).toBe('cancelled_by_client');
    }
    for (const s of ['in_progress', 'completed', 'approved', 'paid'] as BookingStatus[]) {
      expect(() => transition(s, 'cancel_by_client', 'client')).toThrow(InvalidTransitionError);
    }
  });

  it('toda regra aponta para estados conhecidos e tem ao menos um ator', () => {
    const known = new Set<string>([
      'awaiting_payment', 'requested', 'accepted', 'declined', 'expired', 'en_route', 'in_progress', 'completed',
      'approved', 'disputed', 'paid', 'refunded', 'cancelled_by_client', 'cancelled_by_professional',
      'no_show_professional', 'no_show_client',
    ]);
    for (const [action, rule] of Object.entries(TRANSITIONS) as [BookingAction, (typeof TRANSITIONS)[BookingAction]][]) {
      expect(known.has(rule.to), action).toBe(true);
      expect(rule.from.length, action).toBeGreaterThan(0);
      for (const f of rule.from) expect(known.has(f), action).toBe(true);
      expect(rule.actors.length, action).toBeGreaterThan(0);
    }
  });
});

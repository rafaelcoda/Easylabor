/**
 * Máquina de estados do pedido (especificação técnica, seção 4.1).
 * `bookings.status` só muda por esta função; transição fora da tabela é rejeitada.
 */
export type BookingStatus =
  | 'awaiting_payment'
  | 'requested'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'en_route'
  | 'in_progress'
  | 'completed'
  | 'approved'
  | 'disputed'
  | 'paid'
  | 'refunded'
  | 'cancelled_by_client'
  | 'cancelled_by_professional'
  | 'no_show_professional'
  | 'no_show_client';

export type Actor = 'client' | 'professional' | 'admin' | 'system';

export type BookingAction =
  | 'payment_confirmed'
  | 'payment_expired'
  | 'accept'
  | 'decline'
  | 'accept_deadline_expired'
  | 'en_route'
  | 'cancel_by_client'
  | 'cancel_by_professional'
  | 'no_show_professional'
  | 'no_show_client'
  | 'check_in'
  | 'check_out'
  | 'approve'
  | 'dispute'
  | 'resolve_release'
  | 'resolve_refund'
  | 'payout_paid';

interface Rule {
  from: readonly BookingStatus[];
  to: BookingStatus;
  actors: readonly Actor[];
}

export const TRANSITIONS: Readonly<Record<BookingAction, Rule>> = {
  payment_confirmed: { from: ['awaiting_payment'], to: 'requested', actors: ['system'] },
  payment_expired: { from: ['awaiting_payment'], to: 'expired', actors: ['system'] },
  accept: { from: ['requested'], to: 'accepted', actors: ['professional'] },
  decline: { from: ['requested'], to: 'declined', actors: ['professional'] },
  accept_deadline_expired: { from: ['requested'], to: 'expired', actors: ['system'] },
  en_route: { from: ['accepted'], to: 'en_route', actors: ['professional'] },
  // Desvio da especificação 4.1: cancelamento sem custo antes do aceite (RF-35).
  cancel_by_client: {
    from: ['awaiting_payment', 'requested', 'accepted', 'en_route'],
    to: 'cancelled_by_client',
    actors: ['client', 'admin'],
  },
  cancel_by_professional: { from: ['accepted', 'en_route'], to: 'cancelled_by_professional', actors: ['professional', 'admin'] },
  no_show_professional: { from: ['accepted', 'en_route'], to: 'no_show_professional', actors: ['system', 'admin'] },
  no_show_client: { from: ['accepted', 'en_route'], to: 'no_show_client', actors: ['professional', 'admin'] },
  // Check-in pelo GPS (profissional) ou confirmação de chegada pelo cliente.
  check_in: { from: ['accepted', 'en_route'], to: 'in_progress', actors: ['professional', 'client', 'admin'] },
  check_out: { from: ['in_progress'], to: 'completed', actors: ['professional'] },
  approve: { from: ['completed'], to: 'approved', actors: ['client', 'system', 'admin'] },
  dispute: { from: ['completed'], to: 'disputed', actors: ['client'] },
  resolve_release: { from: ['disputed'], to: 'approved', actors: ['admin'] },
  resolve_refund: { from: ['disputed'], to: 'refunded', actors: ['admin'] },
  payout_paid: { from: ['approved'], to: 'paid', actors: ['system'] },
};

export const TERMINAL_STATUSES: readonly BookingStatus[] = [
  'declined',
  'expired',
  'paid',
  'refunded',
  'cancelled_by_client',
  'cancelled_by_professional',
  'no_show_professional',
  'no_show_client',
];

export class InvalidTransitionError extends Error {
  readonly code: 'invalid_transition' | 'forbidden_actor';
  constructor(code: 'invalid_transition' | 'forbidden_actor', message: string) {
    super(message);
    this.name = 'InvalidTransitionError';
    this.code = code;
  }
}

export function transition(status: BookingStatus, action: BookingAction, actor: Actor): BookingStatus {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(status)) {
    throw new InvalidTransitionError('invalid_transition', `Ação "${action}" não é permitida no estado "${status}"`);
  }
  if (!rule.actors.includes(actor)) {
    throw new InvalidTransitionError('forbidden_actor', `"${actor}" não pode executar "${action}"`);
  }
  return rule.to;
}

export function availableActions(status: BookingStatus, actor: Actor): BookingAction[] {
  return (Object.keys(TRANSITIONS) as BookingAction[]).filter((a) => {
    const r = TRANSITIONS[a];
    return r.from.includes(status) && r.actors.includes(actor);
  });
}

export function isTerminal(status: BookingStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

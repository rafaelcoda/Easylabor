import { ledger, transition } from '@diaria/core';
import { inTransaction } from '../db';
import { ApiError } from '../errors';
import type { ProviderEvent } from '../payments/provider';
import type { Ctx } from '../types';
import { applyAction } from './bookings';
import { newRef, writeLedger } from './ledgerWriter';

// ------------------------------------------------------------------ webhook do provedor
export interface EventResult {
  duplicate?: boolean;
  ignored?: boolean;
}

/**
 * Processa um evento verificado do provedor, de forma idempotente: o mesmo evento nunca é aplicado duas vezes
 * (tabela webhook_events, chave provedor + id do evento). Se o processamento falhar, o evento fica sem
 * `processed_at` e o reenvio do provedor tenta de novo.
 */
export async function handlePaymentEvent(ctx: Ctx, evt: ProviderEvent): Promise<EventResult> {
  const provider = ctx.provider.name;
  const ins = await ctx.sql`
    INSERT INTO webhook_events (provider, provider_event_id, payload)
    VALUES (${provider}, ${evt.id}, ${ctx.sql.json(evt as never)})
    ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`;
  let rowId = ins[0]?.id as string | undefined;
  if (!rowId) {
    const ex = (await ctx.sql`SELECT id, processed_at FROM webhook_events WHERE provider = ${provider} AND provider_event_id = ${evt.id}`)[0];
    if (!ex || ex.processed_at) return { duplicate: true };
    rowId = ex.id as string;
  }
  const result = await dispatch(ctx, evt);
  await ctx.sql`UPDATE webhook_events SET processed_at = now() WHERE id = ${rowId}`;
  return result;
}

async function dispatch(ctx: Ctx, evt: ProviderEvent): Promise<EventResult> {
  switch (evt.type) {
    case 'payment.confirmed': {
      const pay = (await ctx.sql`SELECT id, booking_id, status FROM payments WHERE provider_payment_id = ${evt.providerPaymentId}`)[0];
      if (!pay) return { ignored: true };
      const bookingId = pay.booking_id as string;
      // Já processado (pago, liberado ou estornado): ignora.
      if (!['pending', 'expired', 'failed'].includes(pay.status as string)) return { ignored: true };
      // A cobrança já tinha expirado, falhado ou sido cancelada: o dinheiro entrou e volta ao cliente.
      if (pay.status !== 'pending') {
        await refundLatePayment(ctx, pay.id as string, bookingId);
        return {};
      }
      try {
        await applyAction(ctx, { bookingId, action: 'payment_confirmed', user: null });
      } catch (e) {
        // O pedido não aceita mais pagamento (cancelado ou expirado): o dinheiro volta ao cliente.
        if (e instanceof ApiError && e.status === 409) await refundLatePayment(ctx, pay.id as string, bookingId);
        else throw e;
      }
      return {};
    }
    case 'payment.failed':
      await ctx.sql`UPDATE payments SET status = 'failed' WHERE provider_payment_id = ${evt.providerPaymentId} AND status = 'pending'`;
      return {};
    case 'payment.expired': {
      const pay = (await ctx.sql`SELECT booking_id, status FROM payments WHERE provider_payment_id = ${evt.providerPaymentId}`)[0];
      if (!pay || pay.status !== 'pending') return { ignored: true };
      await applyAction(ctx, { bookingId: pay.booking_id as string, action: 'payment_expired', user: null }).catch((e) => {
        if (!(e instanceof ApiError && e.status === 409)) throw e;
      });
      return {};
    }
    case 'refund.done':
    case 'refund.failed':
      await ctx.sql`UPDATE refunds SET status = ${evt.type === 'refund.done' ? 'done' : 'failed'} WHERE provider_refund_id = ${evt.providerRefundId}`;
      return {};
    case 'transfer.paid': {
      const p = (await ctx.sql`SELECT id FROM payouts WHERE provider_transfer_id = ${evt.providerTransferId}`)[0];
      if (!p) return { ignored: true };
      await markPayoutPaid(ctx, p.id as string);
      return {};
    }
    case 'transfer.failed':
      await ctx.sql`UPDATE payouts SET status = 'failed' WHERE provider_transfer_id = ${evt.providerTransferId} AND status <> 'paid'`;
      return {};
  }
}

/** Pagamento confirmado para um pedido que já não aceita pagamento: registra a entrada e devolve o valor. */
async function refundLatePayment(ctx: Ctx, paymentId: string, bookingId: string) {
  await inTransaction(ctx.sql, async (tx) => {
    const pay = (await tx`SELECT amount_cents, status FROM payments WHERE id = ${paymentId} FOR UPDATE`)[0];
    if (!pay || !['pending', 'expired', 'failed'].includes(pay.status as string)) return;
    const amount = Number(pay.amount_cents);
    await tx`UPDATE payments SET status = 'refunded', paid_at = now(), version = version + 1 WHERE id = ${paymentId}`;
    const refund = await tx`INSERT INTO refunds (payment_id, amount_cents, reason, status) VALUES (${paymentId}, ${amount}, 'cancellation', 'pending') RETURNING id`;
    await writeLedger(tx, bookingId, ledger.paymentConfirmed(newRef('payment', paymentId), amount));
    await writeLedger(tx, bookingId, ledger.refund(newRef('refund', refund[0]!.id as string), amount));
    await tx`
      INSERT INTO booking_events (booking_id, type, actor_type, metadata)
      VALUES (${bookingId}, 'payment.late_refunded', 'system', ${tx.json({ amount_cents: amount } as never)})`;
  });
}

// ------------------------------------------------------------------ repasses
/** Marca o repasse como pago: lança no ledger e, se o pedido estava aprovado, o leva a "pago". */
export async function markPayoutPaid(ctx: Ctx, payoutId: string): Promise<boolean> {
  return inTransaction(ctx.sql, async (tx) => {
    const p = (await tx`
      SELECT p.id, p.booking_id, p.net_cents, p.status, b.status AS booking_status
      FROM payouts p JOIN bookings b ON b.id = p.booking_id
      WHERE p.id = ${payoutId} FOR UPDATE OF p`)[0];
    if (!p || p.status === 'paid') return false;

    await tx`UPDATE payouts SET status = 'paid', paid_at = ${ctx.now().toISOString()}::timestamptz, version = version + 1 WHERE id = ${payoutId}`;
    await writeLedger(tx, p.booking_id as string, ledger.payoutPaid(newRef('payout', payoutId), Number(p.net_cents)));
    if (p.booking_status === 'approved') {
      const to = transition('approved', 'payout_paid', 'system');
      await tx`UPDATE bookings SET status = ${to}, version = version + 1 WHERE id = ${p.booking_id}`;
      await tx`
        INSERT INTO booking_events (booking_id, type, from_status, to_status, actor_type, metadata)
        VALUES (${p.booking_id}, 'booking.payout_paid', 'approved', ${to}, 'system', ${tx.json({ payout_id: payoutId } as never)})`;
    }
    return true;
  });
}

/** Envia ao provedor os repasses vencidos. A chave de idempotência é o id do repasse: reenviar não paga duas vezes. */
export async function runPayouts(ctx: Ctx, limit = 20): Promise<number> {
  const due = await ctx.sql`
    SELECT id FROM payouts WHERE status = 'scheduled' AND scheduled_for <= ${ctx.now().toISOString()}::timestamptz
    ORDER BY scheduled_for LIMIT ${limit}`;
  let sent = 0;
  for (const d of due) {
    const paidNow = await inTransaction(ctx.sql, async (tx) => {
      const row = (await tx`
        SELECT p.id, p.net_cents, pp.pix_key
        FROM payouts p JOIN professional_profiles pp ON pp.user_id = p.professional_id
        WHERE p.id = ${d.id} AND p.status = 'scheduled' FOR UPDATE OF p SKIP LOCKED`)[0];
      if (!row) return null;
      const r = await ctx.provider.transfer({
        pixKey: row.pix_key as string,
        amountCents: Number(row.net_cents),
        idempotencyKey: row.id as string,
        description: 'Repasse de diária',
      });
      await tx`UPDATE payouts SET status = 'processing', provider_transfer_id = ${r.providerTransferId}, version = version + 1 WHERE id = ${row.id}`;
      return r.status === 'paid' ? (row.id as string) : '';
    });
    if (paidNow === null) continue;
    sent++;
    if (paidNow) await markPayoutPaid(ctx, paidNow);
  }
  return sent;
}

// ------------------------------------------------------------------ estornos
/** Pede ao provedor os estornos pendentes. No provedor simulado a conclusão é imediata; nos reais vem por webhook. */
export async function sendRefunds(ctx: Ctx, limit = 20): Promise<number> {
  const pending = await ctx.sql`
    SELECT r.id, r.amount_cents, p.provider_payment_id
    FROM refunds r JOIN payments p ON p.id = r.payment_id
    WHERE r.status = 'pending' AND r.provider_refund_id IS NULL AND p.provider_payment_id IS NOT NULL
    ORDER BY r.created_at LIMIT ${limit}`;
  let sent = 0;
  for (const r of pending) {
    const res = await ctx.provider.refund({
      providerPaymentId: r.provider_payment_id as string,
      amountCents: Number(r.amount_cents),
      idempotencyKey: r.id as string,
    });
    await ctx.sql`
      UPDATE refunds SET provider_refund_id = ${res.providerRefundId}, status = ${ctx.provider.isReal ? 'pending' : 'done'}
      WHERE id = ${r.id}`;
    sent++;
  }
  return sent;
}

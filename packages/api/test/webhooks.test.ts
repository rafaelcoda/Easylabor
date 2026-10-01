import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMockProvider, hmacHex } from '../src/payments/provider';
import type { Sql } from '../src/db';
import { WEBHOOK_SECRET, bookingBody, call, clock, ledgerBalance, makeApp, makeSql, seedWorld, testProvider, type World } from './helpers';

let sql: Sql;
let app: ReturnType<typeof makeApp>;
let w: World;

beforeAll(() => {
  sql = makeSql();
  app = makeApp(sql, false, testProvider()); // sem rotas de desenvolvimento: só o webhook confirma pagamentos
});
afterAll(async () => {
  await sql.end();
});
beforeEach(async () => {
  clock.now = new Date('2026-10-19T12:00:00Z');
  w = await seedWorld(sql);
  await sql`TRUNCATE webhook_events`;
});

async function webhook(event: Record<string, unknown>, opts: { secret?: string | null; badSignature?: boolean; appUnderTest?: ReturnType<typeof makeApp> } = {}) {
  const raw = JSON.stringify(event);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const secret = opts.secret === undefined ? WEBHOOK_SECRET : opts.secret;
  if (secret) headers['x-mock-signature'] = opts.badSignature ? 'abc123' : await hmacHex(secret, raw);
  const res = await (opts.appUnderTest ?? app).request('/webhooks/payments', { method: 'POST', headers, body: raw });
  return { status: res.status, json: (await res.json()) as any };
}

async function pendingBooking() {
  const c = await call(app, 'POST', '/v1/bookings', w.client, bookingBody(w));
  expect(c.status).toBe(201);
  return { id: c.json.id as string, providerPaymentId: `mock-pay-${c.json.id}` };
}

describe('webhook de pagamentos', () => {
  it('recusa assinatura inválida, ausente ou webhook sem segredo configurado', async () => {
    const { providerPaymentId } = await pendingBooking();
    const evt = { id: 'e1', type: 'payment.confirmed', providerPaymentId };
    expect((await webhook(evt, { badSignature: true })).status).toBe(401);
    expect((await webhook(evt, { secret: null })).status).toBe(401);
    const noSecretApp = makeApp(sql, false, createMockProvider());
    const r = await webhook(evt, { appUnderTest: noSecretApp });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('webhook_not_configured');
  });

  it('pagamento confirmado leva o pedido a "solicitado" e registra o ledger', async () => {
    const { id, providerPaymentId } = await pendingBooking();
    const r = await webhook({ id: 'e-pay', type: 'payment.confirmed', providerPaymentId });
    expect(r.status).toBe(200);
    expect((await sql`SELECT status, accept_deadline_at FROM bookings WHERE id = ${id}`)[0]).toMatchObject({ status: 'requested' });
    expect((await sql`SELECT status FROM payments WHERE booking_id = ${id}`)[0]!.status).toBe('paid');
    expect(await ledgerBalance(sql, id, 'escrow')).toBe(-21000);
  });

  it('evento repetido não é aplicado duas vezes', async () => {
    const { id, providerPaymentId } = await pendingBooking();
    const evt = { id: 'e-dup', type: 'payment.confirmed', providerPaymentId };
    expect((await webhook(evt)).json.duplicate).toBeUndefined();
    expect((await webhook(evt)).json.duplicate).toBe(true);
    expect((await sql`SELECT count(*)::int AS n FROM ledger_entries WHERE booking_id = ${id}`)[0]!.n).toBe(2);
    expect((await sql`SELECT count(*)::int AS n FROM webhook_events`)[0]!.n).toBe(1);
  });

  it('o mesmo pagamento com outro id de evento também é ignorado', async () => {
    const { id, providerPaymentId } = await pendingBooking();
    await webhook({ id: 'a', type: 'payment.confirmed', providerPaymentId });
    const again = await webhook({ id: 'b', type: 'payment.confirmed', providerPaymentId });
    expect(again.json.ignored).toBe(true);
    expect((await sql`SELECT count(*)::int AS n FROM ledger_entries WHERE booking_id = ${id}`)[0]!.n).toBe(2);
  });

  it('pagamento desconhecido é ignorado sem erro', async () => {
    const r = await webhook({ id: 'x', type: 'payment.confirmed', providerPaymentId: 'nao-existe' });
    expect(r).toMatchObject({ status: 200, json: { ok: true, ignored: true } });
  });

  it('pagamento que chega depois do cancelamento é devolvido ao cliente', async () => {
    const { id, providerPaymentId } = await pendingBooking();
    await call(app, 'POST', `/v1/bookings/${id}/cancel`, w.client, {});
    const r = await webhook({ id: 'late', type: 'payment.confirmed', providerPaymentId });
    expect(r.status).toBe(200);
    expect((await sql`SELECT status FROM bookings WHERE id = ${id}`)[0]!.status).toBe('cancelled_by_client');
    expect((await sql`SELECT amount_cents, status FROM refunds`)[0]).toMatchObject({ amount_cents: 21000, status: 'pending' });
    expect((await sql`SELECT status FROM payments WHERE booking_id = ${id}`)[0]!.status).toBe('refunded');
    expect(await ledgerBalance(sql, id, 'escrow')).toBe(0);
    expect(await ledgerBalance(sql, id, 'bank')).toBe(0);
  });

  it('cobrança que falha ou expira é registrada', async () => {
    const a = await pendingBooking();
    await webhook({ id: 'f', type: 'payment.failed', providerPaymentId: a.providerPaymentId });
    expect((await sql`SELECT status FROM payments WHERE booking_id = ${a.id}`)[0]!.status).toBe('failed');
  });

  it('estorno concluído e repasse pago atualizam os registros', async () => {
    const { id, providerPaymentId } = await pendingBooking();
    await webhook({ id: 'p', type: 'payment.confirmed', providerPaymentId });
    await call(app, 'POST', `/v1/bookings/${id}/cancel`, w.client, {});
    const refund = (await sql`SELECT id FROM refunds`)[0]!;
    await sql`UPDATE refunds SET provider_refund_id = 'rf-1' WHERE id = ${refund.id}`;
    await webhook({ id: 'r', type: 'refund.done', providerRefundId: 'rf-1' });
    expect((await sql`SELECT status FROM refunds WHERE id = ${refund.id}`)[0]!.status).toBe('done');

    // repasse: aprova um pedido à parte e confirma a transferência pelo webhook
    const b = await call(app, 'POST', '/v1/bookings', w.client, bookingBody(w, { start_time: '09:00', duration_minutes: 120 }));
    await webhook({ id: 'p2', type: 'payment.confirmed', providerPaymentId: `mock-pay-${b.json.id}` });
    await sql`UPDATE bookings SET status = 'approved' WHERE id = ${b.json.id}`;
    await sql`INSERT INTO payouts (professional_id, booking_id, type, gross_cents, commission_cents, advance_fee_cents, net_cents, status, scheduled_for, provider_transfer_id)
              VALUES (${w.pro}, ${b.json.id}, 'standard', 20000, 2400, 0, 17600, 'processing', now(), 'tr-1')`;
    await webhook({ id: 't', type: 'transfer.paid', providerTransferId: 'tr-1' });
    expect((await sql`SELECT status FROM payouts WHERE booking_id = ${b.json.id}`)[0]!.status).toBe('paid');
    expect((await sql`SELECT status FROM bookings WHERE id = ${b.json.id}`)[0]!.status).toBe('paid');
    await webhook({ id: 't', type: 'transfer.paid', providerTransferId: 'tr-1' }); // repetido
    expect((await sql`SELECT count(*)::int AS n FROM ledger_entries WHERE booking_id = ${b.json.id} AND account = 'professional'`)[0]!.n).toBe(1);
  });
});

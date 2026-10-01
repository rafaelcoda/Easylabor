import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runJobs } from '../src/jobs';
import type { Sql } from '../src/db';
import { ADDRESS_LOC, STARTS_AT, bookingBody, call, clock, ledgerBalance, makeApp, makeCtx, makeSql, paidBooking, photoKeys, seedWorld, type World } from './helpers';

let sql: Sql;
let app: ReturnType<typeof makeApp>;
let w: World;

beforeAll(() => {
  sql = makeSql();
  app = makeApp(sql);
});
afterAll(async () => {
  await sql.end();
});
beforeEach(async () => {
  clock.now = new Date('2026-10-19T12:00:00Z');
  w = await seedWorld(sql);
});

const run = (payouts = false) => runJobs(makeCtx(sql), { payouts });
const status = async (id: string) => (await sql`SELECT status FROM bookings WHERE id = ${id}`)[0]!.status as string;
const min = (m: number) => m * 60_000;

describe('Pix não pago', () => {
  it('expira o pedido e a cobrança depois do prazo', async () => {
    const c = await call(app, 'POST', '/v1/bookings', w.client, bookingBody(w));
    clock.now = new Date(clock.now.getTime() + min(29));
    expect((await run()).expired_payments).toBe(0);
    clock.now = new Date(clock.now.getTime() + min(2));
    expect((await run()).expired_payments).toBe(1);
    expect(await status(c.json.id)).toBe('expired');
    expect((await sql`SELECT status FROM payments WHERE booking_id = ${c.json.id}`)[0]!.status).toBe('expired');
    expect((await run()).expired_payments).toBe(0); // rodar de novo não repete
  });
});

describe('prazo de aceite vencido', () => {
  it('passa ao próximo profissional e, esgotados os candidatos, encerra e estorna', async () => {
    const b = await paidBooking(app, w);
    clock.now = new Date('2026-10-19T12:16:00Z'); // 1 min depois do prazo de 15 min
    const first = await run();
    expect(first.resent_offers).toBe(1);
    const row = (await sql`SELECT professional_id, attempt, status, accept_deadline_at FROM bookings WHERE id = ${b.id}`)[0]!;
    expect(row).toMatchObject({ professional_id: w.pro2, attempt: 2, status: 'requested' });
    expect(new Date(row.accept_deadline_at).toISOString()).toBe('2026-10-19T12:31:00.000Z');

    // o segundo também não responde: não há mais candidatos
    clock.now = new Date('2026-10-19T12:32:00Z');
    const second = await run();
    expect(second.expired_offers).toBe(1);
    expect(await status(b.id)).toBe('expired');
    expect((await sql`SELECT amount_cents FROM refunds`)[0]!.amount_cents).toBe(21000);
    expect(await ledgerBalance(sql, b.id, 'escrow')).toBe(0);
    // o estorno pendente é enviado ao provedor (simulado: conclui na hora)
    expect(second.refunds_sent).toBe(1);
    expect((await sql`SELECT status, provider_refund_id FROM refunds`)[0]).toMatchObject({ status: 'done' });
    expect((await run()).refunds_sent).toBe(0);
  });

  it('o profissional novo consegue aceitar dentro do novo prazo', async () => {
    const b = await paidBooking(app, w);
    clock.now = new Date('2026-10-19T12:16:00Z');
    await run();
    clock.now = new Date('2026-10-19T12:20:00Z');
    expect((await call(app, 'POST', `/v1/bookings/${b.id}/accept`, w.pro2)).json.status).toBe('accepted');
    expect((await call(app, 'POST', `/v1/bookings/${b.id}/accept`, w.pro)).status).toBe(403);
  });
});

describe('ausência do profissional', () => {
  it('sem check-in 60 min depois do horário: estorno integral e strike', async () => {
    const b = await paidBooking(app, w);
    await call(app, 'POST', `/v1/bookings/${b.id}/accept`, w.pro);
    clock.now = new Date(STARTS_AT.getTime() + min(59));
    expect((await run()).no_shows).toBe(0);
    clock.now = new Date(STARTS_AT.getTime() + min(61));
    expect((await run()).no_shows).toBe(1);
    expect(await status(b.id)).toBe('no_show_professional');
    expect((await sql`SELECT amount_cents, reason FROM refunds`)[0]).toMatchObject({ amount_cents: 21000, reason: 'no_show' });
    expect(await ledgerBalance(sql, b.id, 'escrow')).toBe(0);
    expect((await sql`SELECT kind FROM strikes WHERE user_id = ${w.pro}`)[0]!.kind).toBe('cancellation');
  });

  it('quem já fez check-in não é marcado como ausente', async () => {
    const b = await paidBooking(app, w);
    await call(app, 'POST', `/v1/bookings/${b.id}/accept`, w.pro);
    clock.now = new Date(STARTS_AT.getTime() - min(10));
    await call(app, 'POST', `/v1/bookings/${b.id}/check-in`, w.pro, ADDRESS_LOC);
    clock.now = new Date(STARTS_AT.getTime() + min(120));
    expect((await run()).no_shows).toBe(0);
    expect(await status(b.id)).toBe('in_progress');
  });
});

describe('ausência do cliente', () => {
  it('só pode ser registrada 30 min depois; o profissional recebe 50% e o resto volta ao cliente', async () => {
    const b = await paidBooking(app, w);
    await call(app, 'POST', `/v1/bookings/${b.id}/accept`, w.pro);
    clock.now = new Date(STARTS_AT.getTime() + min(10));
    const early = await call(app, 'POST', `/v1/bookings/${b.id}/report-client-no-show`, w.pro);
    expect(early.status).toBe(422);
    expect(early.json.error.code).toBe('too_early');

    clock.now = new Date(STARTS_AT.getTime() + min(31));
    expect((await call(app, 'POST', `/v1/bookings/${b.id}/report-client-no-show`, w.client)).json.error.code).toBe('forbidden_actor');
    const ok = await call(app, 'POST', `/v1/bookings/${b.id}/report-client-no-show`, w.pro);
    expect(ok.json.status).toBe('no_show_client');
    expect((await sql`SELECT amount_cents FROM refunds`)[0]!.amount_cents).toBe(11000);
    expect((await sql`SELECT net_cents FROM payouts WHERE booking_id = ${b.id}`)[0]!.net_cents).toBe(10000);
    expect(await ledgerBalance(sql, b.id, 'escrow')).toBe(0);
  });
});

describe('aprovação automática', () => {
  async function completed() {
    const b = await paidBooking(app, w);
    await call(app, 'POST', `/v1/bookings/${b.id}/accept`, w.pro);
    clock.now = new Date(STARTS_AT.getTime() - min(10));
    await call(app, 'POST', `/v1/bookings/${b.id}/check-in`, w.pro, ADDRESS_LOC);
    clock.now = new Date(STARTS_AT.getTime() + 8 * 3_600_000);
    await call(app, 'POST', `/v1/bookings/${b.id}/check-out`, w.pro, { ...ADDRESS_LOC, photo_keys: photoKeys(w.pro, b.id, 2) });
    return b.id;
  }

  it('aprova 24 h depois do check-out e agenda o repasse, sem duplicar', async () => {
    const id = await completed();
    clock.now = new Date(clock.now.getTime() + 23 * 3_600_000);
    expect((await run()).auto_approved).toBe(0);
    clock.now = new Date(clock.now.getTime() + 2 * 3_600_000);
    expect((await run()).auto_approved).toBe(1);
    expect(await status(id)).toBe('approved');
    expect((await sql`SELECT net_cents, status FROM payouts WHERE booking_id = ${id}`)[0]).toMatchObject({ net_cents: 17600, status: 'scheduled' });
    expect((await run()).auto_approved).toBe(0);
    expect((await sql`SELECT count(*)::int AS n FROM payouts`)[0]!.n).toBe(1);
  });

  it('pedido contestado não é aprovado sozinho', async () => {
    const id = await completed();
    await call(app, 'POST', `/v1/bookings/${id}/dispute`, w.client, { reason: 'ficou incompleto' }).catch(() => null);
    await sql`UPDATE bookings SET status = 'disputed' WHERE id = ${id}`;
    clock.now = new Date(clock.now.getTime() + 48 * 3_600_000);
    expect((await run()).auto_approved).toBe(0);
    expect(await status(id)).toBe('disputed');
  });

  it('repasses só rodam quando habilitados, e uma vez só', async () => {
    const id = await completed();
    clock.now = new Date(clock.now.getTime() + 25 * 3_600_000);
    await run(); // aprova
    clock.now = new Date(clock.now.getTime() + 49 * 3_600_000);
    expect((await run(false)).payouts_sent).toBe(0);
    expect((await sql`SELECT status FROM payouts WHERE booking_id = ${id}`)[0]!.status).toBe('scheduled');

    expect((await run(true)).payouts_sent).toBe(1);
    expect((await sql`SELECT status, provider_transfer_id FROM payouts WHERE booking_id = ${id}`)[0]).toMatchObject({ status: 'paid' });
    expect(await status(id)).toBe('paid');
    expect(await ledgerBalance(sql, id, 'professional')).toBe(0);
    expect(await ledgerBalance(sql, id, 'escrow')).toBe(0);
    expect((await run(true)).payouts_sent).toBe(0);
  });
});

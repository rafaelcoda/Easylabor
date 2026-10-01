import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/db';
import { ADDRESS_LOC, DAY, STARTS_AT, bookingBody, call, clock, ledgerBalance, makeApp, makeSql, paidBooking, seedWorld, type World } from './helpers';

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

describe('acesso e validação', () => {
  it('lista categorias sem login', async () => {
    const r = await call(app, 'GET', '/v1/categories', null);
    expect(r.status).toBe(200);
    expect(r.json.items.map((c: any) => c.slug)).toEqual(['ajudante-geral', 'diarista', 'pintor']);
  });

  it('exige login nas demais rotas', async () => {
    const r = await call(app, 'GET', '/v1/bookings', null);
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe('unauthenticated');
    expect(r.json.error.request_id).toMatch(/^req_/);
  });

  it('rejeita corpo inválido com lista de problemas', async () => {
    const r = await call(app, 'POST', '/v1/bookings', w.client, { professional_id: 'x', duration_minutes: 10 });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('validation_failed');
    expect(r.json.error.details.issues.length).toBeGreaterThan(2);
  });

  it('rotas de desenvolvimento não existem com devRoutes desligado', async () => {
    const prod = makeApp(sql, false);
    const r = await call(prod, 'POST', `/v1/dev/bookings/${crypto.randomUUID()}/confirm-payment`, w.client);
    expect(r.status).toBe(404);
  });
});

describe('busca e cotação', () => {
  it('acha profissionais disponíveis, dentro do raio e aprovados, ordenados por score', async () => {
    await sql`UPDATE professional_profiles SET rating_avg = 4.2 WHERE user_id = ${w.pro2}`;
    const r = await call(app, 'GET', `/v1/search/professionals?category=pintor&date=${DAY}&address_id=${w.address}`, w.client);
    expect(r.status).toBe(200);
    expect(r.json.items.map((i: any) => i.professional_id)).toEqual([w.pro, w.pro2]);
    expect(r.json.items[0].distance_m).toBeLessThan(500);
    expect(r.json.items[0].score).toBeGreaterThan(r.json.items[1].score);
  });

  it('não lista quem está sem KYC aprovado, invisível, fora do raio ou sem agenda no dia', async () => {
    await sql`UPDATE professional_profiles SET kyc_status = 'pending' WHERE user_id = ${w.pro}`;
    await sql`UPDATE professional_profiles SET base_location = ST_SetSRID(ST_MakePoint(-40.6, -20.6), 4326)::geography WHERE user_id = ${w.pro2}`;
    let r = await call(app, 'GET', `/v1/search/professionals?category=pintor&date=${DAY}&lat=${ADDRESS_LOC.lat}&lng=${ADDRESS_LOC.lng}`, w.client);
    expect(r.json.items).toEqual([]);
    r = await call(app, 'GET', `/v1/search/professionals?category=pintor&date=2026-11-30&address_id=${w.address}`, w.client);
    expect(r.json.items).toEqual([]);
  });

  it('exige endereço ou coordenadas', async () => {
    const r = await call(app, 'GET', `/v1/search/professionals?category=pintor&date=${DAY}`, w.client);
    expect(r.status).toBe(400);
  });

  it('cota a diária de R$ 200 em R$ 210 para o cliente e R$ 176 líquidos', async () => {
    const r = await call(app, 'POST', '/v1/bookings/quote', w.client, { professional_id: w.pro, category: 'pintor' });
    expect(r.json).toMatchObject({ dailyRateCents: 20000, clientFeeCents: 1000, totalCents: 21000, commissionCents: 2400, professionalNetCents: 17600 });
  });
});

describe('criação do pedido', () => {
  it('cria aguardando pagamento, com Pix pendente e código legível', async () => {
    const r = await call(app, 'POST', '/v1/bookings', w.client, bookingBody(w));
    expect(r.status).toBe(201);
    expect(r.json.status).toBe('awaiting_payment');
    expect(r.json.code).toMatch(/^D-\d+$/);
    expect(r.json.amounts.total_cents).toBe(21000);
    expect(r.json.payment).toMatchObject({ method: 'pix', status: 'pending', amount_cents: 21000 });
    expect(r.json.available_actions).toContain('cancel_by_client');
  });

  it('recusa horário fora da agenda do profissional', async () => {
    const r = await call(app, 'POST', '/v1/bookings', w.client, bookingBody(w, { start_time: '05:00' }));
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('slot_unavailable');
  });

  it('recusa horário no passado e serviço que passa da meia-noite', async () => {
    clock.now = new Date('2026-10-21T12:00:00Z');
    expect((await call(app, 'POST', '/v1/bookings', w.client, bookingBody(w))).json.error.code).toBe('start_in_past');
    clock.now = new Date('2026-10-19T12:00:00Z');
    expect((await call(app, 'POST', '/v1/bookings', w.client, bookingBody(w, { start_time: '18:00', duration_minutes: 480 }))).json.error.code).toBe('crosses_midnight');
  });

  it('só cliente cria pedido e só com endereço próprio', async () => {
    expect((await call(app, 'POST', '/v1/bookings', w.pro, bookingBody(w))).status).toBe(403);
    expect((await call(app, 'POST', '/v1/bookings', w.otherClient, bookingBody(w))).status).toBe(404);
  });
});

describe('fluxo completo do pedido', () => {
  it('percorre do pagamento ao repasse, com ledger balanceado', async () => {
    const created = await call(app, 'POST', '/v1/bookings', w.client, bookingBody(w));
    const id = created.json.id as string;

    // o profissional ainda não vê nada antes do pagamento? vê o pedido, mas sem endereço
    let view = await call(app, 'GET', `/v1/bookings/${id}`, w.pro);
    expect(view.json.address).toBeNull();
    expect(view.json.payment).toBeNull();

    const paid = await call(app, 'POST', `/v1/dev/bookings/${id}/confirm-payment`, w.client);
    expect(paid.json.status).toBe('requested');
    expect(paid.json.accept_deadline_at).toBe('2026-10-19T12:15:00.000Z');
    expect(await ledgerBalance(sql, id, 'escrow')).toBe(-21000);

    // cliente não aceita; outro profissional não aceita
    expect((await call(app, 'POST', `/v1/bookings/${id}/accept`, w.client)).json.error.code).toBe('forbidden_actor');
    expect((await call(app, 'POST', `/v1/bookings/${id}/accept`, w.pro2)).status).toBe(403);

    clock.now = new Date('2026-10-19T12:05:00Z');
    const accepted = await call(app, 'POST', `/v1/bookings/${id}/accept`, w.pro);
    expect(accepted.json.status).toBe('accepted');
    expect(accepted.json.address).toMatchObject({ street: 'Rua das Flores', number: '120' });

    expect((await call(app, 'POST', `/v1/bookings/${id}/en-route`, w.pro)).json.status).toBe('en_route');

    // check-in
    clock.now = new Date(STARTS_AT.getTime() - 20 * 60_000);
    const far = await call(app, 'POST', `/v1/bookings/${id}/check-in`, w.pro, { lat: -20.29, lng: -40.29 });
    expect(far.status).toBe(422);
    expect(far.json.error.code).toBe('checkin_too_far');
    const ok = await call(app, 'POST', `/v1/bookings/${id}/check-in`, w.pro, { ...ADDRESS_LOC, accuracy_m: 10 });
    expect(ok.json.status).toBe('in_progress');

    // check-out: pintor exige 2 fotos
    clock.now = new Date(STARTS_AT.getTime() + 8 * 3_600_000);
    const few = await call(app, 'POST', `/v1/bookings/${id}/check-out`, w.pro, { ...ADDRESS_LOC, photo_keys: ['a'] });
    expect(few.json.error.code).toBe('not_enough_photos');
    const out = await call(app, 'POST', `/v1/bookings/${id}/check-out`, w.pro, { ...ADDRESS_LOC, photo_keys: ['a', 'b'] });
    expect(out.json.status).toBe('completed');
    expect(out.json.auto_approve_at).toBe(new Date(clock.now.getTime() + 24 * 3_600_000).toISOString());

    // profissional não aprova; cliente aprova
    expect((await call(app, 'POST', `/v1/bookings/${id}/approve`, w.pro)).json.error.code).toBe('forbidden_actor');
    const approved = await call(app, 'POST', `/v1/bookings/${id}/approve`, w.client);
    expect(approved.json.status).toBe('approved');

    const payout = (await sql`SELECT * FROM payouts WHERE booking_id = ${id}`)[0]!;
    expect(payout).toMatchObject({ type: 'standard', gross_cents: 20000, commission_cents: 2400, net_cents: 17600, status: 'scheduled' });
    expect(new Date(payout.scheduled_for).toISOString()).toBe(new Date(clock.now.getTime() + 48 * 3_600_000).toISOString());

    expect(await ledgerBalance(sql, id, 'escrow')).toBe(0);
    expect(await ledgerBalance(sql, id, 'professional')).toBe(-17600);
    expect(await ledgerBalance(sql, id, 'platform_revenue')).toBe(-3400);
    expect((await sql`SELECT status FROM payments WHERE booking_id = ${id}`)[0]!.status).toBe('released');
    expect((await sql`SELECT completed_count FROM professional_profiles WHERE user_id = ${w.pro}`)[0]!.completed_count).toBe(1);

    // linha do tempo registrada em ordem
    const tl = (await call(app, 'GET', `/v1/bookings/${id}`, w.client)).json.timeline.map((e: any) => e.type);
    expect(tl).toEqual(['booking.created', 'booking.payment_confirmed', 'booking.accept', 'booking.en_route', 'booking.check_in', 'booking.check_out', 'booking.approve']);

    // ação repetida é rejeitada
    expect((await call(app, 'POST', `/v1/bookings/${id}/approve`, w.client)).json.error.code).toBe('invalid_transition');
  });

  it('check-in antes da janela de 30 min é recusado', async () => {
    const b = await paidBooking(app, w);
    await call(app, 'POST', `/v1/bookings/${b.id}/accept`, w.pro);
    clock.now = new Date(STARTS_AT.getTime() - 60 * 60_000);
    const r = await call(app, 'POST', `/v1/bookings/${b.id}/check-in`, w.pro, ADDRESS_LOC);
    expect(r.json.error.code).toBe('checkin_too_early');
  });

  it('pedido só pode ser visto pelas partes e pela operação', async () => {
    const b = await paidBooking(app, w);
    expect((await call(app, 'GET', `/v1/bookings/${b.id}`, w.otherClient)).status).toBe(403);
    expect((await call(app, 'GET', `/v1/bookings/${b.id}`, w.pro2)).status).toBe(403);
    expect((await call(app, 'GET', `/v1/bookings/${b.id}`, w.admin)).status).toBe(200);
    expect((await call(app, 'GET', `/v1/bookings`, w.client)).json.items).toHaveLength(1);
    expect((await call(app, 'GET', `/v1/bookings`, w.otherClient)).json.items).toHaveLength(0);
  });
});

describe('aceite', () => {
  it('recusa o aceite depois do prazo', async () => {
    const b = await paidBooking(app, w);
    clock.now = new Date('2026-10-19T12:16:00Z');
    const r = await call(app, 'POST', `/v1/bookings/${b.id}/accept`, w.pro);
    expect(r.json.error.code).toBe('accept_deadline_passed');
  });

  it('impede aceitar dois pedidos sobrepostos', async () => {
    const a = await paidBooking(app, w);
    const b = await paidBooking(app, w, { start_time: '10:00', duration_minutes: 240 });
    expect((await call(app, 'POST', `/v1/bookings/${a.id}/accept`, w.pro)).json.status).toBe('accepted');
    const r = await call(app, 'POST', `/v1/bookings/${b.id}/accept`, w.pro);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('slot_unavailable');
    expect((await sql`SELECT status FROM bookings WHERE id = ${b.id}`)[0]!.status).toBe('requested');
  });

  it('não cria pedido em horário já ocupado por pedido aceito', async () => {
    const a = await paidBooking(app, w);
    await call(app, 'POST', `/v1/bookings/${a.id}/accept`, w.pro);
    const r = await call(app, 'POST', '/v1/bookings', w.client, bookingBody(w, { start_time: '12:00', duration_minutes: 120 }));
    expect(r.json.error.code).toBe('slot_unavailable');
  });

  it('recusa passa a oferta ao próximo profissional, mantendo o valor pago', async () => {
    const a = await paidBooking(app, w);
    const d = await call(app, 'POST', `/v1/bookings/${a.id}/decline`, w.pro, { reason: 'agenda cheia' });
    expect(d.json).toMatchObject({ status: 'declined', resent: true });
    const row = (await sql`SELECT status, professional_id, attempt, daily_rate_cents FROM bookings WHERE id = ${a.id}`)[0]!;
    expect(row).toMatchObject({ status: 'requested', professional_id: w.pro2, attempt: 2, daily_rate_cents: 20000 });
    expect((await sql`SELECT count(*)::int AS n FROM refunds`)[0]!.n).toBe(0);
    // o primeiro profissional perde o acesso; o novo vê o pedido, sem endereço até aceitar
    expect((await call(app, 'GET', `/v1/bookings/${a.id}`, w.pro)).status).toBe(403);
    const view = await call(app, 'GET', `/v1/bookings/${a.id}`, w.pro2);
    expect(view.json.address).toBeNull();
    expect((await call(app, 'POST', `/v1/bookings/${a.id}/accept`, w.pro2)).json.status).toBe('accepted');
  });

  it('sem outro candidato, a recusa encerra o pedido e estorna tudo', async () => {
    await sql`UPDATE professional_profiles SET visible = false WHERE user_id = ${w.pro2}`;
    const a = await paidBooking(app, w);
    const d = await call(app, 'POST', `/v1/bookings/${a.id}/decline`, w.pro);
    expect(d.json.status).toBe('declined');
    expect((await sql`SELECT amount_cents, status FROM refunds`)[0]).toMatchObject({ amount_cents: 21000, status: 'pending' });
    expect(await ledgerBalance(sql, a.id, 'escrow')).toBe(0);
  });

  it('não reenvia a quem cobra mais do que o cliente pagou, nem depois do limite de tentativas', async () => {
    await sql`UPDATE service_offers SET daily_rate_cents = 25000 WHERE professional_id = ${w.pro2}`;
    const a = await paidBooking(app, w);
    expect((await call(app, 'POST', `/v1/bookings/${a.id}/decline`, w.pro)).json.status).toBe('declined');
    expect((await sql`SELECT status FROM bookings WHERE id = ${a.id}`)[0]!.status).toBe('declined');

    await sql`UPDATE service_offers SET daily_rate_cents = 20000 WHERE professional_id = ${w.pro2}`;
    const b = await paidBooking(app, w, { start_time: '09:00' });
    await sql`UPDATE bookings SET attempt = 3 WHERE id = ${b.id}`;
    await call(app, 'POST', `/v1/bookings/${b.id}/decline`, w.pro);
    expect((await sql`SELECT status, professional_id FROM bookings WHERE id = ${b.id}`)[0]).toMatchObject({ status: 'declined', professional_id: w.pro });
  });
});

describe('cancelamento', () => {
  it('antes do pagamento apenas expira a cobrança, sem movimentar dinheiro', async () => {
    const c = await call(app, 'POST', '/v1/bookings', w.client, bookingBody(w));
    const r = await call(app, 'POST', `/v1/bookings/${c.json.id}/cancel`, w.client, {});
    expect(r.json.status).toBe('cancelled_by_client');
    expect((await sql`SELECT status FROM payments WHERE booking_id = ${c.json.id}`)[0]!.status).toBe('expired');
    expect((await sql`SELECT count(*)::int AS n FROM ledger_entries`)[0]!.n).toBe(0);
  });

  it('cliente com mais de 24 h de antecedência recebe estorno integral', async () => {
    const b = await paidBooking(app, w);
    await call(app, 'POST', `/v1/bookings/${b.id}/accept`, w.pro);
    clock.now = new Date(STARTS_AT.getTime() - 30 * 3_600_000);
    const r = await call(app, 'POST', `/v1/bookings/${b.id}/cancel`, w.client, {});
    expect(r.json.status).toBe('cancelled_by_client');
    expect((await sql`SELECT amount_cents FROM refunds`)[0]!.amount_cents).toBe(21000);
    expect(await ledgerBalance(sql, b.id, 'escrow')).toBe(0);
    expect((await sql`SELECT status FROM payments WHERE booking_id = ${b.id}`)[0]!.status).toBe('refunded');
    expect((await sql`SELECT count(*)::int AS n FROM payouts`)[0]!.n).toBe(0);
  });

  it('cliente com menos de 4 h: 50% da diária vira compensação do profissional', async () => {
    const b = await paidBooking(app, w);
    await call(app, 'POST', `/v1/bookings/${b.id}/accept`, w.pro);
    clock.now = new Date(STARTS_AT.getTime() - 3 * 3_600_000);
    await call(app, 'POST', `/v1/bookings/${b.id}/cancel`, w.client, {});
    expect((await sql`SELECT amount_cents FROM refunds`)[0]!.amount_cents).toBe(11000);
    const payout = (await sql`SELECT net_cents, commission_cents FROM payouts WHERE booking_id = ${b.id}`)[0]!;
    expect(payout).toMatchObject({ net_cents: 10000, commission_cents: 0 });
    expect(await ledgerBalance(sql, b.id, 'escrow')).toBe(0);
    expect(await ledgerBalance(sql, b.id, 'professional')).toBe(-10000);
    expect((await sql`SELECT status FROM payments WHERE booking_id = ${b.id}`)[0]!.status).toBe('partially_refunded');
  });

  it('profissional que cancela com menos de 24 h estorna tudo e recebe strike', async () => {
    const b = await paidBooking(app, w);
    await call(app, 'POST', `/v1/bookings/${b.id}/accept`, w.pro);
    clock.now = new Date(STARTS_AT.getTime() - 5 * 3_600_000);
    const r = await call(app, 'POST', `/v1/bookings/${b.id}/cancel`, w.pro, { reason: 'imprevisto' });
    expect(r.json.status).toBe('cancelled_by_professional');
    expect((await sql`SELECT amount_cents FROM refunds`)[0]!.amount_cents).toBe(21000);
    expect((await sql`SELECT kind FROM strikes WHERE user_id = ${w.pro}`)[0]!.kind).toBe('cancellation');
  });

  it('não cancela depois do check-in', async () => {
    const b = await paidBooking(app, w);
    await call(app, 'POST', `/v1/bookings/${b.id}/accept`, w.pro);
    clock.now = new Date(STARTS_AT.getTime() - 10 * 60_000);
    await call(app, 'POST', `/v1/bookings/${b.id}/check-in`, w.pro, ADDRESS_LOC);
    const r = await call(app, 'POST', `/v1/bookings/${b.id}/cancel`, w.client, {});
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('invalid_transition');
  });
});

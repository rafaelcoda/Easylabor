import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Sql } from '../src/db';
import { DAY, STARTS_AT, call, clock, makeApp, makeSql, paidBooking, seedWorld, type World } from './helpers';

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

describe('painel da operação', () => {
  it('só o admin acessa', async () => {
    for (const path of ['/v1/admin/overview', '/v1/admin/bookings', '/v1/admin/schedule']) {
      expect((await call(app, 'GET', path, w.client)).status).toBe(403);
      expect((await call(app, 'GET', path, w.pro)).status).toBe(403);
      expect((await call(app, 'GET', path, null)).status).toBe(401);
      expect((await call(app, 'GET', path, w.admin)).status).toBe(200);
    }
  });

  it('indicadores do dia: contagem por estado, atrasos e verificações pendentes', async () => {
    const a = await paidBooking(app, w);
    await call(app, 'POST', `/v1/bookings/${a.id}/accept`, w.pro);
    await paidBooking(app, w, { start_time: '14:00', duration_minutes: 120, professional_id: w.pro2 });
    await sql`UPDATE professional_profiles SET kyc_status = 'pending' WHERE user_id = ${w.pro2}`;

    let o = (await call(app, 'GET', `/v1/admin/overview?date=${DAY}`, w.admin)).json;
    expect(o).toMatchObject({ date: DAY, total: 2, by_status: { accepted: 1, requested: 1 }, late_without_checkin: 0, kyc_pending: 1 });

    clock.now = new Date(STARTS_AT.getTime() + 31 * 60_000); // 31 min depois do horário, sem check-in
    o = (await call(app, 'GET', `/v1/admin/overview?date=${DAY}`, w.admin)).json;
    expect(o.late_without_checkin).toBe(1);

    expect((await call(app, 'GET', '/v1/admin/overview?date=2026-11-01', w.admin)).json.total).toBe(0);
    expect((await call(app, 'GET', '/v1/admin/overview?date=ontem', w.admin)).status).toBe(400);
  });

  it('lista de pedidos com nomes, filtro por dia e por estado', async () => {
    const a = await paidBooking(app, w);
    await call(app, 'POST', `/v1/bookings/${a.id}/accept`, w.pro);
    await paidBooking(app, w, { start_time: '15:00', duration_minutes: 120, professional_id: w.pro2 });

    const all = (await call(app, 'GET', `/v1/admin/bookings?date=${DAY}`, w.admin)).json.items;
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ client_name: 'Cliente Um', category: 'pintor', total_cents: 21000 });
    expect(all.map((b: any) => b.professional_name).sort()).toEqual(['Marcos S.', 'Rafaela T.']);
    const accepted = (await call(app, 'GET', `/v1/admin/bookings?date=${DAY}&status=accepted`, w.admin)).json.items;
    expect(accepted.map((b: any) => b.professional_name)).toEqual(['Marcos S.']);
    expect((await call(app, 'GET', '/v1/admin/bookings?date=2026-11-01', w.admin)).json.items).toEqual([]);
  });

  it('agenda: pedidos aceitos por profissional e ofertas aguardando aceite', async () => {
    const a = await paidBooking(app, w);
    await call(app, 'POST', `/v1/bookings/${a.id}/accept`, w.pro);
    const pend = await paidBooking(app, w, { start_time: '15:00', duration_minutes: 120, professional_id: w.pro2 });

    const s = (await call(app, 'GET', `/v1/admin/schedule?date=${DAY}`, w.admin)).json;
    expect(s.date).toBe(DAY);
    const marcos = s.professionals.find((p: any) => p.name === 'Marcos S.');
    const rafaela = s.professionals.find((p: any) => p.name === 'Rafaela T.');
    expect(marcos.bookings).toHaveLength(1);
    expect(marcos.bookings[0]).toMatchObject({ status: 'accepted', category: 'pintor' });
    expect(rafaela.bookings).toEqual([]); // livre, com agenda aberta
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0]).toMatchObject({ id: pend.id, status: 'requested', professional_name: 'Rafaela T.', attempt: 1 });
  });
});

describe('CORS', () => {
  const withCors = () =>
    createApp({ sql, authenticate: async () => null, corsOrigins: ['https://painel.exemplo.com'], now: () => clock.now });
  const preflight = (origin: string) =>
    withCors().request('/v1/admin/overview', {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
    });

  it('libera apenas a origem do painel', async () => {
    const ok = await preflight('https://painel.exemplo.com');
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://painel.exemplo.com');
    expect(ok.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
    const bad = await preflight('https://site-malicioso.com');
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('sem origens configuradas, não envia cabeçalhos de CORS', async () => {
    const r = await app.request('/v1/categories', { headers: { origin: 'https://painel.exemplo.com' } });
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });
});

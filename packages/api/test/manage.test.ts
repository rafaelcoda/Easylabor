import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@diaria/core';
import type { Sql } from '../src/db';
import { applySettings } from '../src/services/settings';
import { DAY, call, clock, makeApp, makeSql, paidBooking, seedWorld, type World } from './helpers';

let sql: Sql;
let app: ReturnType<typeof makeApp>;
let live: ReturnType<typeof makeApp>; // com os parâmetros lidos do banco
let w: World;

beforeAll(() => {
  sql = makeSql();
  app = makeApp(sql);
  live = makeApp(sql, true, undefined, { dbConfig: true });
});
afterAll(async () => {
  await sql.end();
});
beforeEach(async () => {
  clock.now = new Date('2026-10-19T12:00:00Z');
  w = await seedWorld(sql);
  await sql`TRUNCATE config_settings`;
  await sql`DELETE FROM service_categories WHERE slug LIKE 'teste-%'`;
});

const get = (path: string, who: string | null = w.admin) => call(app, 'GET', path, who);

describe('acesso', () => {
  it('só o administrador entra nas rotas de gestão', async () => {
    const routes: [string, string][] = [
      ['GET', '/v1/admin/professionals'], ['GET', `/v1/admin/professionals/${w.pro}`], ['GET', '/v1/admin/clients'], ['GET', `/v1/admin/clients/${w.client}`],
      ['GET', '/v1/admin/platform/overview'], ['GET', '/v1/admin/categories'], ['GET', '/v1/admin/config'], ['GET', '/v1/admin/audit'],
      ['POST', `/v1/admin/users/${w.pro}/suspend`], ['POST', `/v1/admin/users/${w.pro}/reactivate`], ['PUT', `/v1/admin/professionals/${w.pro}/visible`],
      ['PUT', '/v1/admin/config/client_fee_bps'], ['DELETE', '/v1/admin/config/client_fee_bps'], ['PUT', '/v1/admin/categories/pintor'], ['POST', '/v1/admin/categories'],
    ];
    for (const [m, path] of routes) {
      const body = m === 'GET' || m === 'DELETE' ? undefined : {};
      expect((await call(app, m, path, w.client, body)).status, `${m} ${path} cliente`).toBe(403);
      expect((await call(app, m, path, w.pro, body)).status, `${m} ${path} profissional`).toBe(403);
      expect((await call(app, m, path, null, body)).status, `${m} ${path} sem login`).toBe(401);
    }
  });
});

describe('gestão de profissionais', () => {
  it('lista com serviços, indicadores e filtros', async () => {
    await sql`UPDATE professional_profiles SET kyc_status = 'pending', visible = false WHERE user_id = ${w.pro2}`;
    await sql`INSERT INTO users (role, full_name, phone, accepted_terms_version, accepted_terms_at) VALUES ('professional', 'Sem Perfil', '+5527900000099', 'v1', now())`;

    const all = (await get('/v1/admin/professionals')).json;
    expect(all.total).toBe(3);
    expect(all.summary).toMatchObject({ total: 3, incomplete: 1, pending: 1, approved: 1, visible: 1, suspended: 0 });
    const marcos = all.items.find((i: any) => i.full_name === 'Marcos S.');
    expect(marcos).toMatchObject({ kyc_status: 'approved', visible: true, has_profile: true, bookings_total: 0, active_strikes: 0 });
    expect(marcos.offers).toEqual([{ category: 'pintor', rate_cents: 20000 }]);
    expect(all.items.find((i: any) => i.full_name === 'Sem Perfil')).toMatchObject({ has_profile: false, kyc_status: null });

    const ids = async (qs: string) => (await get(`/v1/admin/professionals?${qs}`)).json.items.map((i: any) => i.full_name).sort();
    expect(await ids('kyc=pending')).toEqual(['Rafaela T.']);
    expect(await ids('kyc=approved')).toEqual(['Marcos S.']);
    expect(await ids('kyc=incomplete')).toEqual(['Sem Perfil']);
    expect(await ids('visible=false')).toEqual(['Rafaela T.']);
    expect(await ids('service=pintor')).toEqual(['Marcos S.', 'Rafaela T.']);
    expect(await ids('q=marc')).toEqual(['Marcos S.']);
    expect(await ids('q=0004')).toEqual(['Rafaela T.']); // telefone
    expect(await ids('q=%25')).toEqual([]); // o % é tratado como texto, não como curinga
    expect(await ids('q=Marcos 2')).toEqual([]); // texto com número não vira busca por telefone
    expect(await ids('q=(27) 90000-0004')).toEqual(['Rafaela T.']); // telefone com máscara continua valendo
    expect(await ids('q=')).toHaveLength(3); // vazio = sem filtro
    expect((await get('/v1/admin/professionals?kyc=qualquer')).status).toBe(400);
    expect((await get('/v1/admin/professionals?limit=0')).status).toBe(400);
  });

  it('pagina e informa o total', async () => {
    const p1 = (await get('/v1/admin/professionals?limit=1&offset=0')).json;
    const p2 = (await get('/v1/admin/professionals?limit=1&offset=1')).json;
    expect(p1.items).toHaveLength(1);
    expect(p2.items).toHaveLength(1);
    expect(p1.total).toBe(2);
    expect(p1.items[0].id).not.toBe(p2.items[0].id);
    expect((await get('/v1/admin/professionals?limit=1&offset=5')).json.items).toEqual([]);
  });

  it('o detalhe mostra o histórico e esconde a chave Pix', async () => {
    const a = await paidBooking(app, w);
    await sql`UPDATE professional_profiles SET pix_key = '12345678901' WHERE user_id = ${w.pro}`;
    await sql`INSERT INTO strikes (user_id, booking_id, kind, expires_at) VALUES (${w.pro}, ${a.id}, 'cancellation', now() + interval '30 days')`;
    await call(app, 'PUT', `/v1/admin/professionals/${w.pro}/visible`, w.admin, { visible: false, reason: 'teste' });

    const d = (await get(`/v1/admin/professionals/${w.pro}`)).json;
    expect(d.user).toMatchObject({ full_name: 'Marcos S.', status: 'active' });
    expect(d.profile).toMatchObject({ kyc_status: 'approved', visible: false, radius_km: 10, pix_key_masked: '12•••01' });
    expect(JSON.stringify(d)).not.toContain('12345678901');
    expect(d.offers).toEqual([{ category: 'pintor', name: 'Pintor', daily_rate_cents: 20000 }]);
    expect(d.strikes).toHaveLength(1);
    expect(d.strikes[0]).toMatchObject({ kind: 'cancellation', active: true, booking_code: expect.stringMatching(/^D-/) });
    expect(d.bookings[0]).toMatchObject({ client_name: 'Cliente Um', total_cents: 21000 });
    expect(d.history[0]).toMatchObject({ action: 'professional.hidden', actor_name: 'Operação' });
    expect((await get(`/v1/admin/professionals/${w.client}`)).status).toBe(404); // cliente não é profissional
    expect((await get('/v1/admin/professionals/nao-e-uuid')).status).toBe(400);
  });

  it('suspender tira da busca, impede o login e fica registrado; reativar não volta a exibir sozinho', async () => {
    const search = () => call(app, 'GET', `/v1/search/professionals?category=pintor&date=${DAY}&address_id=${w.address}`, w.client);
    expect((await search()).json.items).toHaveLength(2);

    expect((await call(app, 'POST', `/v1/admin/users/${w.pro}/suspend`, w.admin, {})).status).toBe(400); // motivo obrigatório
    const r = await call(app, 'POST', `/v1/admin/users/${w.pro}/suspend`, w.admin, { reason: 'Conduta inadequada' });
    expect(r.json).toEqual({ id: w.pro, status: 'suspended' });
    expect((await search()).json.items.map((i: any) => i.professional_id)).toEqual([w.pro2]);
    expect((await call(app, 'GET', '/v1/me', w.pro)).status).toBe(401);
    expect((await sql`SELECT visible FROM professional_profiles WHERE user_id = ${w.pro}`)[0]!.visible).toBe(false);
    const log = (await sql`SELECT actor_id, action, after FROM audit_logs WHERE entity_id = ${w.pro} AND action = 'user.suspended'`)[0]!;
    expect(log).toMatchObject({ actor_id: w.admin });
    expect(log.after).toMatchObject({ status: 'suspended', reason: 'Conduta inadequada' });
    expect((await get('/v1/admin/professionals?status=suspended')).json.items.map((i: any) => i.id)).toEqual([w.pro]);
    expect((await call(app, 'POST', `/v1/admin/users/${w.pro}/suspend`, w.admin, { reason: 'de novo' })).status).toBe(409);

    expect((await call(app, 'POST', `/v1/admin/users/${w.pro}/reactivate`, w.admin, {})).json.status).toBe('active');
    expect((await call(app, 'GET', '/v1/me', w.pro)).status).toBe(200);
    expect((await search()).json.items.map((i: any) => i.professional_id)).toEqual([w.pro2]); // segue oculto
    expect((await call(app, 'POST', `/v1/admin/users/${w.pro}/reactivate`, w.admin, {})).status).toBe(409);
  });

  it('o administrador não suspende a si mesmo, outro administrador, nem conta inexistente', async () => {
    expect((await call(app, 'POST', `/v1/admin/users/${w.admin}/suspend`, w.admin, { reason: 'teste' })).status).toBe(403);
    const other = (await sql`INSERT INTO users (role, full_name, phone, accepted_terms_version, accepted_terms_at) VALUES ('admin', 'Outro Admin', '+5527900000098', 'v1', now()) RETURNING id`)[0]!.id as string;
    expect((await call(app, 'POST', `/v1/admin/users/${other}/suspend`, w.admin, { reason: 'teste' })).status).toBe(403);
    expect((await call(app, 'POST', '/v1/admin/users/11111111-1111-4111-8111-111111111111/suspend', w.admin, { reason: 'teste' })).status).toBe(404);
  });

  it('ocultar e exibir na busca só vale para aprovado e ativo', async () => {
    const search = () => call(app, 'GET', `/v1/search/professionals?category=pintor&date=${DAY}&address_id=${w.address}`, w.client);
    expect((await call(app, 'PUT', `/v1/admin/professionals/${w.pro}/visible`, w.admin, { visible: false })).json).toEqual({ id: w.pro, visible: false });
    expect((await search()).json.items.map((i: any) => i.professional_id)).toEqual([w.pro2]);
    expect((await call(app, 'PUT', `/v1/admin/professionals/${w.pro}/visible`, w.admin, { visible: true })).json.visible).toBe(true);
    expect((await search()).json.items).toHaveLength(2);

    await sql`UPDATE professional_profiles SET kyc_status = 'pending' WHERE user_id = ${w.pro2}`;
    expect((await call(app, 'PUT', `/v1/admin/professionals/${w.pro2}/visible`, w.admin, { visible: true })).json.error.code).toBe('kyc_not_approved');
    await sql`UPDATE users SET status = 'suspended' WHERE id = ${w.pro}`;
    expect((await call(app, 'PUT', `/v1/admin/professionals/${w.pro}/visible`, w.admin, { visible: false })).json.error.code).toBe('account_not_active');
    expect((await call(app, 'PUT', `/v1/admin/professionals/${w.client}/visible`, w.admin, { visible: false })).status).toBe(404);
  });
});

describe('gestão de clientes', () => {
  it('lista com pedidos e valor contratado; filtra por nome, telefone, e-mail e estado', async () => {
    await sql`UPDATE users SET email = 'dona@lucia.com' WHERE id = ${w.client}`;
    const a = await paidBooking(app, w);
    await sql`UPDATE bookings SET status = 'approved' WHERE id = ${a.id}`;
    await paidBooking(app, w, { start_time: '09:00', duration_minutes: 60, professional_id: w.pro2 });
    await sql`UPDATE users SET status = 'suspended' WHERE id = ${w.otherClient}`;

    const all = (await get('/v1/admin/clients')).json;
    expect(all.total).toBe(2);
    expect(all.summary).toMatchObject({ total: 2, active: 1, suspended: 1, companies: 0 });
    const c = all.items.find((i: any) => i.id === w.client);
    expect(c).toMatchObject({ full_name: 'Cliente Um', addresses: 1, bookings_total: 2, bookings_done: 1, bookings_lost: 0, spent_cents: 21000, kind: 'person' });

    const ids = async (qs: string) => (await get(`/v1/admin/clients?${qs}`)).json.items.map((i: any) => i.id);
    expect(await ids('q=um')).toEqual([w.client]);
    expect(await ids('q=0002')).toEqual([w.otherClient]);
    expect(await ids('q=lucia')).toEqual([w.client]);
    expect(await ids('status=suspended')).toEqual([w.otherClient]);
    expect((await get('/v1/admin/clients?status=xyz')).status).toBe(400);
  });

  it('o detalhe mostra bairro e cidade, nunca a rua; suspensão bloqueia o login', async () => {
    const a = await paidBooking(app, w);
    const d = (await get(`/v1/admin/clients/${w.client}`)).json;
    expect(d.user).toMatchObject({ full_name: 'Cliente Um', status: 'active' });
    expect(d.addresses).toEqual([{ label: null, district: 'Jardim Camburi', city: 'Vitória', state: 'ES' }]);
    expect(JSON.stringify(d)).not.toContain('Rua das Flores');
    expect(d.totals).toMatchObject({ bookings: 1, done: 0, lost: 0, spent_cents: 0 });
    expect(d.bookings[0]).toMatchObject({ id: a.id, professional_name: 'Marcos S.', total_cents: 21000 });
    expect((await get(`/v1/admin/clients/${w.pro}`)).status).toBe(404);

    expect((await call(app, 'POST', `/v1/admin/users/${w.client}/suspend`, w.admin, { reason: 'Fraude' })).json.status).toBe('suspended');
    expect((await call(app, 'GET', '/v1/me', w.client)).status).toBe(401);
    expect((await get(`/v1/admin/clients/${w.client}`)).json.history[0]).toMatchObject({ action: 'user.suspended' });
    expect((await call(app, 'POST', `/v1/admin/users/${w.client}/reactivate`, w.admin, { reason: 'Resolvido' })).json.status).toBe('active');
    expect((await call(app, 'GET', '/v1/me', w.client)).status).toBe(200);
  });
});

describe('gestão da plataforma: visão geral', () => {
  it('conta usuários, pedidos, valor contratado e receita; monta as séries por dia', async () => {
    const a = await paidBooking(app, w);
    await sql`UPDATE bookings SET status = 'approved' WHERE id = ${a.id}`;
    await paidBooking(app, w, { start_time: '09:00', duration_minutes: 60, professional_id: w.pro2 });
    await sql`UPDATE bookings SET created_at = ${clock.now.toISOString()}::timestamptz`; // o banco usa a hora real; aqui vale o relógio do teste
    await sql`UPDATE professional_profiles SET kyc_status = 'pending' WHERE user_id = ${w.pro2}`;

    const o = (await get('/v1/admin/platform/overview?days=14')).json;
    expect(o).toMatchObject({ days: 14, to: '2026-10-19', from: '2026-10-06' });
    expect(o.users).toMatchObject({ clients: 2, professionals: 2, admins: 1, suspended: 0 });
    expect(o.professionals).toMatchObject({ approved: 1, pending: 1, visible: 2 });
    expect(o.bookings).toMatchObject({ total: 2, done: 1, lost: 0, gmv_cents: 21000, revenue_cents: 3400 });
    expect(o.bookings_by_day).toHaveLength(14);
    expect(o.bookings_by_day.at(-1)).toMatchObject({ day: '2026-10-19' });
    expect(o.signups_by_day).toHaveLength(14);
    expect(o.queues).toMatchObject({ kyc_pending: 1, disputes_open: 0, refunds_pending: 0, payouts_open: 0, late_without_checkin: 0 });
    expect((await get('/v1/admin/platform/overview?days=3')).status).toBe(400);
    expect((await get('/v1/admin/platform/overview')).json.days).toBe(30);
  });

  it('pedidos antigos ficam fora da janela', async () => {
    const a = await paidBooking(app, w);
    await sql`UPDATE bookings SET created_at = '2026-08-20T12:00:00Z'::timestamptz WHERE id = ${a.id}`; // 60 dias antes do relógio do teste
    expect((await get('/v1/admin/platform/overview?days=30')).json.bookings.total).toBe(0);
    expect((await get('/v1/admin/platform/overview?days=90')).json.bookings.total).toBe(1);
  });
});

describe('gestão da plataforma: serviços', () => {
  const novo = { slug: 'teste-jardim', name: 'Jardineiro', min_daily_rate_cents: 12000, max_daily_rate_cents: 28000, min_photos_checkout: 2 };

  it('cria, ajusta faixa e desativa; some das listas públicas', async () => {
    expect((await call(app, 'POST', '/v1/admin/categories', w.admin, novo)).status).toBe(201);
    expect((await call(app, 'POST', '/v1/admin/categories', w.admin, novo)).json.error.code).toBe('slug_in_use');
    expect((await call(app, 'POST', '/v1/admin/categories', w.admin, { ...novo, slug: 'Com Espaço' })).status).toBe(400);
    expect((await call(app, 'POST', '/v1/admin/categories', w.admin, { ...novo, slug: 'teste-b', max_daily_rate_cents: 100 })).json.error.code).toBe('invalid_range');

    const list = (await get('/v1/admin/categories')).json.items;
    expect(list.find((c: any) => c.slug === 'teste-jardim')).toMatchObject({ name: 'Jardineiro', min_daily_rate_cents: 12000, max_daily_rate_cents: 28000, min_photos_checkout: 2, active: true, professionals: 0 });
    expect(list.find((c: any) => c.slug === 'pintor').professionals).toBe(2);

    const up = await call(app, 'PUT', '/v1/admin/categories/teste-jardim', w.admin, { max_daily_rate_cents: 30000, min_photos_checkout: 3 });
    expect(up.status).toBe(200);
    expect((await call(app, 'PUT', '/v1/admin/categories/teste-jardim', w.admin, { min_daily_rate_cents: 40000 })).json.error.code).toBe('invalid_range');
    expect((await call(app, 'PUT', '/v1/admin/categories/teste-jardim', w.admin, { min_daily_rate_cents: -5 })).status).toBe(400);
    expect((await call(app, 'PUT', '/v1/admin/categories/nao-existe', w.admin, { active: false })).status).toBe(404);

    const pub = async () => (await call(app, 'GET', '/v1/categories', null)).json.items.map((c: any) => c.slug);
    expect(await pub()).toContain('teste-jardim');
    await call(app, 'PUT', '/v1/admin/categories/teste-jardim', w.admin, { active: false });
    expect(await pub()).not.toContain('teste-jardim');
    expect((await get('/v1/admin/categories')).json.items.find((c: any) => c.slug === 'teste-jardim').active).toBe(false); // admin ainda vê

    const log = (await sql`SELECT action, before, after FROM audit_logs WHERE action = 'category.updated' ORDER BY created_at DESC, id LIMIT 3`);
    expect(log.length).toBeGreaterThanOrEqual(2);
    expect(log.some((l) => l.after.max_daily_rate_cents === 30000 && l.before.max_daily_rate_cents === 28000)).toBe(true);
  });
});

describe('gestão da plataforma: parâmetros', () => {
  const quote = (a: ReturnType<typeof makeApp>) => call(a, 'POST', '/v1/bookings/quote', w.client, { professional_id: w.pro, category: 'pintor' });

  it('lista os 12 parâmetros com padrão, limites e origem do valor', async () => {
    const items = (await get('/v1/admin/config')).json.items;
    expect(items).toHaveLength(12);
    expect(items.find((i: any) => i.key === 'client_fee_bps')).toMatchObject({ default: 500, value: 500, custom: false, min: 0, max: 3000, unit: 'bps', group: 'Taxas', updated_by_name: null });
    expect(items.find((i: any) => i.key === 'no_show_minutes')).toMatchObject({ default: 60, unit: 'minutos', group: 'Prazos' });
  });

  it('um valor gravado igual ao padrão não conta como alterado', async () => {
    await sql`INSERT INTO config_settings (key, value) VALUES ('client_fee_bps', '500')`;
    expect((await get('/v1/admin/config')).json.items.find((i: any) => i.key === 'client_fee_bps')).toMatchObject({ value: 500, custom: false });
  });

  it('alterar muda o preço dos próximos pedidos; restaurar volta ao padrão', async () => {
    expect((await quote(live)).json.clientFeeCents).toBe(1000);
    const r = await call(app, 'PUT', '/v1/admin/config/client_fee_bps', w.admin, { value: 800 });
    expect(r.json).toEqual({ key: 'client_fee_bps', value: 800 });
    expect((await quote(live)).json).toMatchObject({ clientFeeCents: 1600, totalCents: 21600 });
    expect((await quote(app)).json.clientFeeCents).toBe(1000); // sem a leitura do banco, vale o padrão do código

    const item = (await get('/v1/admin/config')).json.items.find((i: any) => i.key === 'client_fee_bps');
    expect(item).toMatchObject({ value: 800, default: 500, custom: true, updated_by_name: 'Operação' });
    const log = (await sql`SELECT before, after FROM audit_logs WHERE action = 'config.updated'`)[0]!;
    expect(log.before).toEqual({ key: 'client_fee_bps', value: 500 });
    expect(log.after).toEqual({ key: 'client_fee_bps', value: 800 });

    const back = await call(app, 'DELETE', '/v1/admin/config/client_fee_bps', w.admin);
    expect(back.json).toEqual({ key: 'client_fee_bps', value: 500 });
    expect((await quote(live)).json.clientFeeCents).toBe(1000);
    expect((await get('/v1/admin/config')).json.items.find((i: any) => i.key === 'client_fee_bps').custom).toBe(false);
    expect((await call(app, 'DELETE', '/v1/admin/config/client_fee_bps', w.admin)).status).toBe(200); // repetir é inofensivo
  });

  it('recusa valores fora dos limites, não inteiros, parâmetro desconhecido e combinação incoerente', async () => {
    const put = (key: string, value: unknown) => call(app, 'PUT', `/v1/admin/config/${key}`, w.admin, { value });
    expect((await put('client_fee_bps', 3001)).json.error.code).toBe('out_of_range');
    expect((await put('client_fee_bps', -1)).json.error.code).toBe('out_of_range');
    expect((await put('check_in_radius_meters', 10)).status).toBe(422);
    expect((await put('client_fee_bps', 5.5)).status).toBe(400);
    expect((await put('client_fee_bps', '800')).status).toBe(400);
    expect((await put('nao_existe', 1)).status).toBe(404);
    expect((await call(app, 'DELETE', '/v1/admin/config/nao_existe', w.admin)).status).toBe(404);
    expect((await put('accept_deadline_short_minutes', 20)).json.error.code).toBe('inconsistent'); // maior que os 15 normais
    expect((await put('accept_deadline_minutes', 30)).status).toBe(200);
    expect((await put('accept_deadline_short_minutes', 20)).status).toBe(200);
    expect((await put('accept_deadline_minutes', 10)).json.error.code).toBe('inconsistent'); // deixaria o curto (20) maior
    expect((await sql`SELECT count(*)::int AS n FROM config_settings`)[0]!.n).toBe(2);
  });

  it('valores inválidos já gravados são ignorados em vez de derrubar a API', () => {
    const cfg = applySettings(DEFAULT_CONFIG, [
      { key: 'client_fee_bps', value: 99999 }, { key: 'commission_bps', value: 'abc' }, { key: 'desconhecido', value: 5 },
      { key: 'no_show_minutes', value: 90 }, { key: 'accept_deadline_minutes', value: 3 },
    ]);
    expect(cfg.clientFeeBps).toBe(500);
    expect(cfg.commissionBps).toBe(1200);
    expect(cfg.noShowMinutes).toBe(90);
    expect(cfg.acceptDeadlineMinutes).toBe(3);
    expect(cfg.acceptDeadlineShortMinutes).toBe(3); // nunca passa do normal
  });
});

describe('auditoria', () => {
  it('mostra as ações mais recentes com o nome de quem fez', async () => {
    await call(app, 'POST', `/v1/admin/users/${w.pro}/suspend`, w.admin, { reason: 'Teste' });
    await call(app, 'PUT', '/v1/admin/config/pix_expiry_minutes', w.admin, { value: 45 });
    const items = (await get('/v1/admin/audit?limit=10')).json.items;
    expect(items.map((i: any) => i.action)).toEqual(['config.updated', 'user.suspended']);
    expect(items[0]).toMatchObject({ actor_name: 'Operação', entity: 'config_settings' });
    expect((await get('/v1/admin/audit?limit=0')).status).toBe(400);
    expect((await get('/v1/admin/audit?limit=500')).status).toBe(400);
  });
});

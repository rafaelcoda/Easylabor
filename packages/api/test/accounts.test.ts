import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/db';
import { ADDRESS_LOC, DAY, STARTS_AT, asIdentity, call, clock, makeApp, makeSql, seedAdminOnly } from './helpers';

let sql: Sql;
let app: ReturnType<typeof makeApp>;
let admin: string;

const CLIENT_AUTH = '11111111-aaaa-4aaa-8aaa-111111111111';
const PRO_AUTH = '22222222-bbbb-4bbb-8bbb-222222222222';
const terms = { accepted_terms_version: 'v1' };

beforeAll(() => {
  sql = makeSql();
  app = makeApp(sql);
});
afterAll(async () => {
  await sql.end();
});
beforeEach(async () => {
  clock.now = new Date('2026-10-19T12:00:00Z');
  admin = await seedAdminOnly(sql);
});

const registerClient = (over: Record<string, unknown> = {}, phone = '5527999990001', id = CLIENT_AUTH) =>
  call(app, 'POST', '/v1/me/register', null, { role: 'client', full_name: 'Dona Lúcia', ...terms, ...over }, asIdentity(id, phone));
const registerPro = (over: Record<string, unknown> = {}) =>
  call(app, 'POST', '/v1/me/register', null, { role: 'professional', full_name: 'Marcos Silva', ...terms, ...over }, asIdentity(PRO_AUTH, '5527999990002'));

describe('login e cadastro', () => {
  it('sem token não entra; com token válido e sem cadastro, /v1/me pede o cadastro', async () => {
    expect((await call(app, 'GET', '/v1/me', null)).status).toBe(401);
    const r = await call(app, 'GET', '/v1/me', null, undefined, asIdentity(CLIENT_AUTH, '5527999990001'));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ registered: false, next_step: 'register', phone: '5527999990001' });
  });

  it('rotas protegidas continuam exigindo cadastro mesmo com token válido', async () => {
    const r = await call(app, 'GET', '/v1/bookings', null, undefined, asIdentity(CLIENT_AUTH, '5527999990001'));
    expect(r.status).toBe(401);
  });

  it('cadastra o cliente com o telefone verificado em formato E.164', async () => {
    const r = await registerClient();
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ registered: true, role: 'client', phone: '+5527999990001', full_name: 'Dona Lúcia', next_step: 'add_address' });
    expect(r.json.client).toMatchObject({ kind: 'person', addresses: 0 });
    const u = (await sql`SELECT id, accepted_terms_version, phone_verified_at FROM users WHERE id = ${CLIENT_AUTH}`)[0]!;
    expect(u.accepted_terms_version).toBe('v1');
    expect(u.phone_verified_at).not.toBeNull();
    // depois do cadastro, o mesmo login passa a funcionar nas rotas protegidas
    expect((await call(app, 'GET', '/v1/me', CLIENT_AUTH)).json.registered).toBe(true);
  });

  it('rejeita dados inválidos, perfil de admin e telefone ausente', async () => {
    expect((await registerClient({ accepted_terms_version: undefined })).status).toBe(400);
    expect((await registerClient({ role: 'admin' })).status).toBe(400);
    expect((await registerClient({ full_name: 'A' })).status).toBe(400);
    const noPhone = await call(app, 'POST', '/v1/me/register', null, { role: 'client', full_name: 'Sem Telefone', ...terms }, asIdentity(CLIENT_AUTH, null));
    expect(noPhone.json.error.code).toBe('phone_missing');
  });

  it('não cadastra duas vezes nem aceita telefone ou e-mail de outra conta', async () => {
    expect((await registerClient()).status).toBe(201);
    expect((await registerClient()).json.error.code).toBe('already_registered');
    const other = await registerClient({}, '5527999990001', '33333333-cccc-4ccc-8ccc-333333333333');
    expect(other.json.error.code).toBe('phone_in_use');
    await sql`UPDATE users SET email = 'a@b.com' WHERE id = ${CLIENT_AUTH}`;
    const mail = await registerClient({ email: 'a@b.com' }, '5527988880000', '44444444-dddd-4ddd-8ddd-444444444444');
    expect(mail.json.error.code).toBe('email_in_use');
  });

  it('empresa exige CNPJ com 14 dígitos', async () => {
    expect((await registerClient({ client_kind: 'company' })).json.error.code).toBe('cnpj_invalid');
    const ok = await registerClient({ client_kind: 'company', cnpj: '12.345.678/0001-95' });
    expect(ok.status).toBe(201);
    expect((await sql`SELECT cnpj FROM client_profiles WHERE user_id = ${CLIENT_AUTH}`)[0]!.cnpj).toBe('12345678000195');
  });
});

describe('endereços do cliente', () => {
  const addr = { street: 'Rua das Flores', number: '120', district: 'Jardim Camburi', city: 'Vitória', state: 'es', ...ADDRESS_LOC };

  it('cria, lista e apaga; só cliente acessa', async () => {
    await registerClient();
    await registerPro();
    expect((await call(app, 'POST', '/v1/client/addresses', PRO_AUTH, addr)).status).toBe(403);
    const created = await call(app, 'POST', '/v1/client/addresses', CLIENT_AUTH, addr);
    expect(created.status).toBe(201);
    const list = await call(app, 'GET', '/v1/client/addresses', CLIENT_AUTH);
    expect(list.json.items).toHaveLength(1);
    expect(list.json.items[0]).toMatchObject({ street: 'Rua das Flores', state: 'ES' });
    expect(list.json.items[0].lat).toBeCloseTo(ADDRESS_LOC.lat, 5);
    expect((await call(app, 'GET', '/v1/me', CLIENT_AUTH)).json.next_step).toBe('ready');
    expect((await call(app, 'DELETE', `/v1/client/addresses/${created.json.id}`, CLIENT_AUTH)).status).toBe(204);
    expect((await call(app, 'DELETE', `/v1/client/addresses/${created.json.id}`, CLIENT_AUTH)).status).toBe(404);
  });

  it('valida coordenadas e UF', async () => {
    await registerClient();
    expect((await call(app, 'POST', '/v1/client/addresses', CLIENT_AUTH, { ...addr, lat: 200 })).status).toBe(400);
    expect((await call(app, 'POST', '/v1/client/addresses', CLIENT_AUTH, { ...addr, state: 'ESP' })).status).toBe(400);
  });
});

describe('profissional: do cadastro à busca (fluxo completo)', () => {
  const profile = { bio: 'Pintor há 12 anos', lat: -20.275, lng: -40.28, radius_km: 10, pix_key: '12345678901' };

  it('segue o caminho: perfil, serviço, agenda, aprovação, visibilidade e pedido', async () => {
    await registerClient();
    expect((await registerPro()).json.next_step).toBe('complete_profile');

    // serviço e agenda exigem o perfil
    expect((await call(app, 'PUT', '/v1/professional/offers/pintor', PRO_AUTH, { daily_rate_cents: 20000 })).json.error.code).toBe('profile_missing');

    const prof = await call(app, 'PUT', '/v1/professional/profile', PRO_AUTH, profile);
    expect(prof.status).toBe(200);
    expect(prof.json).toMatchObject({ next_step: 'await_kyc' });
    expect(prof.json.professional).toMatchObject({ kyc_status: 'pending', visible: false });

    // valor fora da faixa da categoria
    const low = await call(app, 'PUT', '/v1/professional/offers/pintor', PRO_AUTH, { daily_rate_cents: 5000 });
    expect(low.status).toBe(422);
    expect(low.json.error).toMatchObject({ code: 'rate_out_of_range', details: { min_cents: 15000, max_cents: 35000 } });
    expect((await call(app, 'PUT', '/v1/professional/offers/pintor', PRO_AUTH, { daily_rate_cents: 20000 })).status).toBe(200);
    expect((await call(app, 'PUT', '/v1/professional/offers/inexistente', PRO_AUTH, { daily_rate_cents: 20000 })).status).toBe(404);
    expect((await call(app, 'PUT', `/v1/professional/availability/${DAY}`, PRO_AUTH, { start_time: '06:00', end_time: '20:00' })).status).toBe(200);
    expect((await call(app, 'PUT', `/v1/professional/availability/${DAY}`, PRO_AUTH, { start_time: '20:00', end_time: '06:00' })).json.error.code).toBe('invalid_range');

    // antes da aprovação não fica visível, e a busca não o acha
    expect((await call(app, 'PUT', '/v1/professional/status', PRO_AUTH, { visible: true })).status).toBe(403);
    const addr = await call(app, 'POST', '/v1/client/addresses', CLIENT_AUTH, { street: 'Rua das Flores', city: 'Vitória', state: 'ES', ...ADDRESS_LOC });
    const search = () => call(app, 'GET', `/v1/search/professionals?category=pintor&date=${DAY}&address_id=${addr.json.id}`, CLIENT_AUTH);
    expect((await search()).json.items).toEqual([]);

    // operação aprova
    const queue = await call(app, 'GET', '/v1/admin/kyc/queue', admin);
    expect(queue.json.items.map((i: any) => i.id)).toEqual([PRO_AUTH]);
    const ok = await call(app, 'POST', `/v1/admin/kyc/${PRO_AUTH}/decision`, admin, { decision: 'approve' });
    expect(ok.json).toEqual({ user_id: PRO_AUTH, kyc_status: 'approved' });
    expect((await call(app, 'GET', '/v1/me', PRO_AUTH)).json.next_step).toBe('ready');

    // aprovado, mas ainda invisível até ligar "disponível"
    expect((await search()).json.items).toEqual([]);
    expect((await call(app, 'PUT', '/v1/professional/status', PRO_AUTH, { visible: true })).json).toEqual({ visible: true });
    const found = await search();
    expect(found.json.items).toHaveLength(1);
    expect(found.json.items[0]).toMatchObject({ professional_id: PRO_AUTH, daily_rate_cents: 20000 });

    // o cliente cadastrado pelo login contrata o profissional cadastrado pelo login
    const booking = await call(app, 'POST', '/v1/bookings', CLIENT_AUTH, {
      professional_id: PRO_AUTH, category: 'pintor', address_id: addr.json.id, date: DAY, start_time: '08:00', duration_minutes: 480,
      description: 'Pintar sala e corredor, 45 m².',
    });
    expect(booking.status).toBe(201);
    await call(app, 'POST', `/v1/dev/bookings/${booking.json.id}/confirm-payment`, CLIENT_AUTH);
    clock.now = new Date('2026-10-19T12:05:00Z');
    const accepted = await call(app, 'POST', `/v1/bookings/${booking.json.id}/accept`, PRO_AUTH);
    expect(accepted.json.status).toBe('accepted');
    expect(STARTS_AT.toISOString()).toBe(accepted.json.starts_at);
  });

  it('reprovação exige motivo e tira o profissional da busca', async () => {
    await registerPro();
    await call(app, 'PUT', '/v1/professional/profile', PRO_AUTH, profile);
    await call(app, 'POST', `/v1/admin/kyc/${PRO_AUTH}/decision`, admin, { decision: 'approve' });
    await call(app, 'PUT', '/v1/professional/status', PRO_AUTH, { visible: true });
    expect((await call(app, 'POST', `/v1/admin/kyc/${PRO_AUTH}/decision`, admin, { decision: 'reject' })).status).toBe(400);
    const rej = await call(app, 'POST', `/v1/admin/kyc/${PRO_AUTH}/decision`, admin, { decision: 'reject', reason: 'Documento ilegível' });
    expect(rej.json.kyc_status).toBe('rejected');
    const p = (await sql`SELECT kyc_status, kyc_reason, visible FROM professional_profiles WHERE user_id = ${PRO_AUTH}`)[0]!;
    expect(p).toMatchObject({ kyc_status: 'rejected', kyc_reason: 'Documento ilegível', visible: false });
  });

  it('decisões da operação ficam no log de auditoria', async () => {
    await registerPro();
    await call(app, 'PUT', '/v1/professional/profile', PRO_AUTH, profile);
    await call(app, 'POST', `/v1/admin/kyc/${PRO_AUTH}/decision`, admin, { decision: 'approve' });
    const log = (await sql`SELECT actor_id, action, before, after FROM audit_logs WHERE entity_id = ${PRO_AUTH}`)[0]!;
    expect(log).toMatchObject({ actor_id: admin, action: 'kyc.decision' });
    expect(log.before.kyc_status).toBe('pending');
    expect(log.after.kyc_status).toBe('approved');
  });
});

describe('regras de acesso por perfil', () => {
  const profile = { lat: -20.275, lng: -40.28, radius_km: 10, pix_key: '12345678901' };

  it('cada rota aceita só o perfil certo', async () => {
    await registerClient();
    await registerPro();
    await call(app, 'PUT', '/v1/professional/profile', PRO_AUTH, profile);
    // cliente não acessa rotas de profissional nem de operação
    expect((await call(app, 'PUT', '/v1/professional/profile', CLIENT_AUTH, profile)).status).toBe(403);
    expect((await call(app, 'PUT', '/v1/professional/status', CLIENT_AUTH, { visible: true })).status).toBe(403);
    expect((await call(app, 'GET', '/v1/admin/kyc/queue', CLIENT_AUTH)).status).toBe(403);
    // profissional não busca, não cria pedido, não aprova cadastros
    expect((await call(app, 'GET', `/v1/search/professionals?category=pintor&date=${DAY}&lat=1&lng=1`, PRO_AUTH)).status).toBe(403);
    expect((await call(app, 'POST', '/v1/bookings', PRO_AUTH, {})).status).toBe(403);
    expect((await call(app, 'POST', `/v1/admin/kyc/${PRO_AUTH}/decision`, PRO_AUTH, { decision: 'approve' })).status).toBe(403);
    // sem login nada disso funciona
    expect((await call(app, 'GET', '/v1/admin/kyc/queue', null)).status).toBe(401);
  });

  it('conta suspensa deixa de entrar', async () => {
    await registerClient();
    await sql`UPDATE users SET status = 'suspended' WHERE id = ${CLIENT_AUTH}`;
    expect((await call(app, 'GET', '/v1/me', CLIENT_AUTH)).status).toBe(401);
  });
});

describe('exclusão da conta', () => {
  const profile = { lat: -20.275, lng: -40.28, radius_km: 10, pix_key: '12345678901' };

  it('anonimiza os dados, bloqueia o login e mantém o histórico', async () => {
    await registerClient({ email: 'dona@lucia.com' });
    await call(app, 'POST', '/v1/client/addresses', CLIENT_AUTH, { street: 'Rua das Flores', number: '120', city: 'Vitória', state: 'ES', ...ADDRESS_LOC });
    const r = await call(app, 'DELETE', '/v1/me', CLIENT_AUTH);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ deleted: true });

    const u = (await sql`SELECT full_name, phone, email, cpf, status, deleted_at FROM users WHERE id = ${CLIENT_AUTH}`)[0]!;
    expect(u).toMatchObject({ full_name: 'Usuário removido', email: null, cpf: null, status: 'deleted' });
    expect(u.phone).toMatch(/^removido:/);
    expect(u.deleted_at).not.toBeNull();
    expect((await sql`SELECT street, number FROM addresses WHERE client_id = ${CLIENT_AUTH}`)[0]).toMatchObject({ street: 'removido', number: null });
    expect((await sql`SELECT action FROM audit_logs WHERE entity_id = ${CLIENT_AUTH}`)[0]!.action).toBe('user.deleted');
    // depois de excluir, não entra mais
    expect((await call(app, 'GET', '/v1/me', CLIENT_AUTH)).status).toBe(401);
  });

  it('profissional some da busca e perde os dados pessoais', async () => {
    await registerPro();
    await call(app, 'PUT', '/v1/professional/profile', PRO_AUTH, { ...profile, bio: 'Pintor há 12 anos' });
    await call(app, 'POST', `/v1/admin/kyc/${PRO_AUTH}/decision`, admin, { decision: 'approve' });
    await call(app, 'PUT', '/v1/professional/status', PRO_AUTH, { visible: true });
    expect((await call(app, 'DELETE', '/v1/me', PRO_AUTH)).status).toBe(200);
    expect((await sql`SELECT visible, bio, pix_key FROM professional_profiles WHERE user_id = ${PRO_AUTH}`)[0]).toMatchObject({ visible: false, bio: null, pix_key: 'removido' });
  });

  it('não exclui com pedido em andamento; libera depois de cancelado', async () => {
    await registerClient();
    await registerPro();
    await call(app, 'PUT', '/v1/professional/profile', PRO_AUTH, profile);
    await call(app, 'PUT', '/v1/professional/offers/pintor', PRO_AUTH, { daily_rate_cents: 20000 });
    await call(app, 'PUT', `/v1/professional/availability/${DAY}`, PRO_AUTH, { start_time: '06:00', end_time: '20:00' });
    await call(app, 'POST', `/v1/admin/kyc/${PRO_AUTH}/decision`, admin, { decision: 'approve' });
    await call(app, 'PUT', '/v1/professional/status', PRO_AUTH, { visible: true });
    const addr = await call(app, 'POST', '/v1/client/addresses', CLIENT_AUTH, { street: 'Rua das Flores', city: 'Vitória', state: 'ES', ...ADDRESS_LOC });
    const b = await call(app, 'POST', '/v1/bookings', CLIENT_AUTH, { professional_id: PRO_AUTH, category: 'pintor', address_id: addr.json.id, date: DAY, start_time: '08:00', duration_minutes: 480, description: 'Pintar sala e corredor.' });

    const blocked = await call(app, 'DELETE', '/v1/me', CLIENT_AUTH);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe('open_bookings');
    expect(blocked.json.error.details.codes).toHaveLength(1);
    expect((await call(app, 'DELETE', '/v1/me', PRO_AUTH)).json.error.code).toBe('open_bookings'); // o profissional também está no pedido

    await call(app, 'POST', `/v1/bookings/${b.json.id}/cancel`, CLIENT_AUTH, {});
    expect((await call(app, 'DELETE', '/v1/me', CLIENT_AUTH)).status).toBe(200);
    expect((await sql`SELECT code FROM bookings WHERE id = ${b.json.id}`)[0]!.code).toBe(b.json.code); // histórico preservado
  });

  it('admin não se exclui pela API e sem login não há exclusão', async () => {
    expect((await call(app, 'DELETE', '/v1/me', admin)).status).toBe(403);
    expect((await call(app, 'DELETE', '/v1/me', null)).status).toBe(401);
  });
});

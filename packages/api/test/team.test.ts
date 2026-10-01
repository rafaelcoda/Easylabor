import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/db';
import { brPhone } from '../src/services/team';
import { asIdentity, call, clock, makeApp, makeSql, seedWorld, type World } from './helpers';

let sql: Sql;
let app: ReturnType<typeof makeApp>;
let w: World;
let operator: string;

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
  await sql`TRUNCATE admin_invites`;
  operator = (await sql`
    INSERT INTO users (role, admin_level, full_name, phone, accepted_terms_version, accepted_terms_at)
    VALUES ('admin', 'operator', 'Ana Operadora', '+5527900000070', 'staff-v1', now()) RETURNING id`)[0]!.id as string;
});

const NEW_AUTH = '77777777-aaaa-4aaa-8aaa-777777777777';
const invite = (body: Record<string, unknown>, who: string | null = w.admin) => call(app, 'POST', '/v1/admin/team/invites', who, body);
const team = (who: string | null = w.admin) => call(app, 'GET', '/v1/admin/team', who);
const accept = (authId = NEW_AUTH, phone: string | null = '5527998881122') => call(app, 'POST', '/v1/admin/accept-invite', null, undefined, asIdentity(authId, phone));

describe('telefone digitado no painel', () => {
  it('aceita com ou sem o 55, com máscara e zero de operadora', () => {
    for (const raw of ['(27) 99888-1122', '27998881122', '+55 27 99888-1122', '5527998881122', '027 99888-1122']) expect(brPhone(raw), raw).toBe('+5527998881122');
    expect(brPhone('(27) 3222-1122')).toBe('+552732221122'); // fixo
    expect(brPhone('123')).toBeNull();
    expect(brPhone('abc')).toBeNull();
  });
});

describe('equipe: listagem e acesso', () => {
  it('mostra membros com nível, estado e atividade; qualquer membro da equipe consulta', async () => {
    await call(app, 'POST', `/v1/admin/users/${w.pro}/suspend`, w.admin, { reason: 'Teste' });
    const t = (await team(operator)).json;
    expect(t.me).toEqual({ id: operator, level: 'operator' });
    expect(t.members.map((m: any) => [m.full_name, m.level, m.status])).toEqual([['Operação', 'owner', 'active'], ['Ana Operadora', 'operator', 'active']]);
    expect(t.members[0]).toMatchObject({ actions_30d: 1 });
    expect(t.members[0].last_action).not.toBeNull();
    expect(t.members[1]).toMatchObject({ actions_30d: 0, last_action: null });
    expect(t.invites).toEqual([]);
  });

  it('cliente, profissional e visitante não veem a equipe nem mexem nela', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const routes: [string, string][] = [
      ['GET', '/v1/admin/team'], ['POST', '/v1/admin/team/invites'], ['DELETE', `/v1/admin/team/invites/${id}`],
      ['PUT', `/v1/admin/team/members/${id}`], ['POST', `/v1/admin/team/members/${id}/deactivate`], ['POST', `/v1/admin/team/members/${id}/reactivate`],
    ];
    for (const [m, path] of routes) {
      const body = m === 'GET' || m === 'DELETE' ? undefined : {};
      expect((await call(app, m, path, w.client, body)).status, `${m} ${path} cliente`).toBe(403);
      expect((await call(app, m, path, w.pro, body)).status, `${m} ${path} profissional`).toBe(403);
      expect((await call(app, m, path, null, body)).status, `${m} ${path} sem login`).toBe(401);
    }
  });

  it('/v1/me do administrador informa o nível', async () => {
    expect((await call(app, 'GET', '/v1/me', w.admin)).json).toMatchObject({ role: 'admin', admin_level: 'owner' });
    expect((await call(app, 'GET', '/v1/me', operator)).json).toMatchObject({ role: 'admin', admin_level: 'operator' });
  });
});

describe('equipe: convite', () => {
  it('convidar, a pessoa entrar com o telefone e virar membro com o nível do convite', async () => {
    const r = await invite({ full_name: 'Beatriz Lopes', phone: '(27) 99888-1122', level: 'operator' });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ phone: '+5527998881122', level: 'operator', expires_at: '2026-10-26T12:00:00.000Z' });

    const pending = (await team()).json.invites;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ full_name: 'Beatriz Lopes', phone: '+5527998881122', level: 'operator', expired: false, invited_by_name: 'Operação' });

    const ok = await accept();
    expect(ok.status).toBe(201);
    expect(ok.json).toEqual({ id: NEW_AUTH, role: 'admin', level: 'operator' });
    expect((await call(app, 'GET', '/v1/me', NEW_AUTH)).json).toMatchObject({ role: 'admin', admin_level: 'operator', full_name: 'Beatriz Lopes', phone: '+5527998881122' });
    expect((await team()).json.invites).toEqual([]);
    expect((await team()).json.members.map((m: any) => m.full_name)).toContain('Beatriz Lopes');
    expect((await accept()).json.error.code).toBe('already_registered'); // não se repete

    const log = (await sql`SELECT action, after FROM audit_logs WHERE action LIKE 'team.%' ORDER BY created_at, id`).map((l) => l.action);
    expect(log).toEqual(['team.invited', 'team.invite_accepted']);
  });

  it('o convite pode ser para outro administrador', async () => {
    await invite({ full_name: 'Novo Dono', phone: '27998881122', level: 'owner' });
    expect((await accept()).json.level).toBe('owner');
    expect((await call(app, 'POST', '/v1/admin/team/invites', NEW_AUTH, { full_name: 'Outra Pessoa', phone: '27997776655' })).status).toBe(201);
  });

  it('valida nome, telefone, nível e duplicidades', async () => {
    expect((await invite({ full_name: 'Ab', phone: '27998881122' })).status).toBe(400);
    expect((await invite({ full_name: 'Beatriz Lopes', phone: '12345678' })).json.error.code).toBe('phone_invalid');
    expect((await invite({ full_name: 'Beatriz Lopes', phone: '123' })).status).toBe(400);
    expect((await invite({ full_name: 'Beatriz Lopes', phone: '27998881122', level: 'chefe' })).status).toBe(400);
    // telefone que já tem conta (o cliente de teste)
    expect((await invite({ full_name: 'Alguém', phone: '(27) 90000-0001' })).json.error.code).toBe('phone_in_use');
    expect((await invite({ full_name: 'Ana de novo', phone: '27900000070' })).json.error.code).toBe('phone_in_use'); // já é da equipe
    expect((await invite({ full_name: 'Beatriz Lopes', phone: '27998881122' })).status).toBe(201);
    expect((await invite({ full_name: 'Beatriz Lopes', phone: '+55 27 99888-1122' })).json.error.code).toBe('invite_exists');
  });

  it('convite vencido não vale para entrar e libera um novo para o mesmo telefone', async () => {
    await invite({ full_name: 'Beatriz Lopes', phone: '27998881122' });
    clock.now = new Date('2026-10-27T12:00:00Z'); // 8 dias depois
    expect((await accept()).status).toBe(404);
    expect((await team()).json.invites[0]).toMatchObject({ expired: true });
    expect((await invite({ full_name: 'Beatriz Lopes', phone: '27998881122' })).status).toBe(201);
    expect((await team()).json.invites).toHaveLength(1);
    expect((await accept()).status).toBe(201);
  });

  it('convite cancelado deixa de valer; sem convite ninguém vira administrador', async () => {
    const r = await invite({ full_name: 'Beatriz Lopes', phone: '27998881122' });
    expect((await call(app, 'DELETE', `/v1/admin/team/invites/${r.json.id}`, w.admin)).status).toBe(204);
    expect((await accept()).status).toBe(404);
    expect((await call(app, 'DELETE', `/v1/admin/team/invites/${r.json.id}`, w.admin)).status).toBe(404);
    expect((await accept('88888888-bbbb-4bbb-8bbb-888888888888', '5527911112222')).status).toBe(404);
    expect((await accept(NEW_AUTH, null)).status).toBe(422); // login sem telefone verificado
    expect((await call(app, 'POST', '/v1/admin/accept-invite', null)).status).toBe(401);
    expect((await sql`SELECT count(*)::int AS n FROM users WHERE role = 'admin'`)[0]!.n).toBe(2); // continua só a equipe original
  });

  it('quem já tem conta não usa o convite para trocar de papel', async () => {
    await invite({ full_name: 'Beatriz Lopes', phone: '27998881122' });
    // o mesmo telefone se cadastra como cliente antes de aceitar o convite
    await call(app, 'POST', '/v1/me/register', null, { role: 'client', full_name: 'Beatriz Lopes', accepted_terms_version: 'v1' }, asIdentity(NEW_AUTH, '5527998881122'));
    expect((await accept()).json.error.code).toBe('already_registered');
    expect((await call(app, 'GET', '/v1/me', NEW_AUTH)).json.role).toBe('client');
  });
});

describe('equipe: níveis de acesso', () => {
  it('operador faz a rotina, mas não mexe em equipe, serviços nem parâmetros', async () => {
    expect((await invite({ full_name: 'Beatriz Lopes', phone: '27998881122' }, operator)).status).toBe(403);
    expect((await call(app, 'PUT', '/v1/admin/config/client_fee_bps', operator, { value: 600 })).status).toBe(403);
    expect((await call(app, 'DELETE', '/v1/admin/config/client_fee_bps', operator)).status).toBe(403);
    expect((await call(app, 'POST', '/v1/admin/categories', operator, { slug: 'teste-x', name: 'Teste', min_daily_rate_cents: 1, max_daily_rate_cents: 2 })).status).toBe(403);
    expect((await call(app, 'PUT', '/v1/admin/categories/pintor', operator, { active: false })).status).toBe(403);
    expect((await call(app, 'PUT', `/v1/admin/team/members/${w.admin}`, operator, { level: 'operator' })).status).toBe(403);
    expect((await call(app, 'POST', `/v1/admin/team/members/${w.admin}/deactivate`, operator)).status).toBe(403);
    // rotina continua liberada
    expect((await call(app, 'GET', '/v1/admin/config', operator)).status).toBe(200);
    expect((await call(app, 'GET', '/v1/admin/platform/overview', operator)).status).toBe(200);
    expect((await call(app, 'POST', `/v1/admin/users/${w.pro}/suspend`, operator, { reason: 'Teste' })).status).toBe(200);
    expect((await call(app, 'PUT', `/v1/admin/professionals/${w.pro2}/visible`, operator, { visible: false })).status).toBe(200);
    expect((await call(app, 'POST', `/v1/admin/kyc/${w.pro2}/decision`, operator, { decision: 'approve' })).status).toBe(200);
  });

  it('admin sem nível definido é tratado como operador', async () => {
    await sql`UPDATE users SET admin_level = NULL WHERE id = ${operator}`;
    expect((await call(app, 'GET', '/v1/me', operator)).json.admin_level).toBe('operator');
    expect((await invite({ full_name: 'Beatriz Lopes', phone: '27998881122' }, operator)).status).toBe(403);
  });

  it('promover e rebaixar; sempre sobra um administrador ativo', async () => {
    const lvl = (id: string, level: string) => call(app, 'PUT', `/v1/admin/team/members/${id}`, w.admin, { level });
    expect((await lvl(operator, 'owner')).json).toEqual({ id: operator, level: 'owner' });
    expect((await call(app, 'POST', '/v1/admin/team/invites', operator, { full_name: 'Quem Convida', phone: '27998881122' })).status).toBe(201);
    expect((await lvl(operator, 'owner')).status).toBe(200); // repetir é inofensivo
    expect((await lvl(operator, 'operator')).json.level).toBe('operator');

    expect((await lvl(w.admin, 'operator')).json.error.code).toBe('last_owner'); // único administrador
    expect((await lvl(operator, 'owner')).status).toBe(200);
    expect((await lvl(w.admin, 'operator')).status).toBe(200); // agora há outro
    expect((await invite({ full_name: 'Sem Permissão', phone: '27997776655' }, w.admin)).status).toBe(403); // e ele deixou de ser administrador

    expect((await call(app, 'PUT', `/v1/admin/team/members/${w.client}`, operator, { level: 'owner' })).status).toBe(404); // não é da equipe
    expect((await lvl(w.pro, 'owner')).status).toBe(403); // quem foi rebaixado não altera mais nada
    expect((await call(app, 'PUT', `/v1/admin/team/members/${operator}`, operator, { level: 'dono' })).status).toBe(400);
    const log = (await sql`SELECT before, after FROM audit_logs WHERE action = 'team.level_changed' ORDER BY created_at, id`);
    expect(log[0]).toMatchObject({ before: { level: 'operator' }, after: { level: 'owner' } });
  });

  it('desativar impede o acesso; reativar devolve', async () => {
    expect((await call(app, 'POST', `/v1/admin/team/members/${w.admin}/deactivate`, w.admin)).status).toBe(403); // a si mesmo
    const r = await call(app, 'POST', `/v1/admin/team/members/${operator}/deactivate`, w.admin);
    expect(r.json).toEqual({ id: operator, status: 'suspended' });
    expect((await call(app, 'GET', '/v1/me', operator)).status).toBe(401);
    expect((await call(app, 'GET', '/v1/admin/overview', operator)).status).toBe(401);
    expect((await team()).json.members.find((m: any) => m.id === operator)).toMatchObject({ status: 'suspended' });
    expect((await call(app, 'POST', `/v1/admin/team/members/${operator}/deactivate`, w.admin)).status).toBe(409);
    expect((await call(app, 'POST', `/v1/admin/team/members/${operator}/reactivate`, w.admin)).json.status).toBe('active');
    expect((await call(app, 'GET', '/v1/me', operator)).status).toBe(200);
    expect((await call(app, 'POST', `/v1/admin/team/members/${operator}/reactivate`, w.admin)).status).toBe(409);
    expect((await call(app, 'POST', `/v1/admin/team/members/${w.pro}/deactivate`, w.admin)).status).toBe(404); // profissional não é da equipe
    const acts = (await sql`SELECT action FROM audit_logs WHERE action LIKE 'team.%' ORDER BY created_at, id`).map((l) => l.action);
    expect(acts).toEqual(['team.deactivated', 'team.reactivated']);
  });

  it('um dono desativa o outro, mas o último nunca fica sem acesso', async () => {
    await call(app, 'PUT', `/v1/admin/team/members/${operator}`, w.admin, { level: 'owner' });
    expect((await call(app, 'POST', `/v1/admin/team/members/${operator}/deactivate`, w.admin)).status).toBe(200);
    expect((await call(app, 'PUT', `/v1/admin/team/members/${w.admin}`, w.admin, { level: 'operator' })).json.error.code).toBe('last_owner');
    expect((await call(app, 'POST', `/v1/admin/team/members/${w.admin}/deactivate`, w.admin)).status).toBe(403);
  });
});

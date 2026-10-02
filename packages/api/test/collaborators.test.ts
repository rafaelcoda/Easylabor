import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/db';
import { Easy365Error, type Easy365Client } from '../src/integrations/easy365';
import { collaboratorSyncTick, mapCollaborator, parseDate, requestSync, runSyncStep } from '../src/services/collaborators';
import { asIdentity, call, clock, makeApp, makeCtx, makeSql, seedWorld, type World } from './helpers';

let sql: Sql;
let w: World;
let operator: string;

beforeAll(() => { sql = makeSql(); });
afterAll(async () => { await sql.end(); });
beforeEach(async () => {
  clock.now = new Date('2026-10-19T12:00:00Z'); // 09h em São Paulo
  w = await seedWorld(sql);
  operator = (await sql`
    INSERT INTO users (role, admin_level, full_name, phone, accepted_terms_version, accepted_terms_at)
    VALUES ('admin', 'operator', 'Ana Operadora', '+5527900000070', 'staff-v1', now()) RETURNING id`)[0]!.id as string;
});

// ------------------------------------------------------------------ apoio
const raw = (n: number, over: Record<string, unknown> = {}) => ({
  id: `ext-${n}`, register: String(n).padStart(6, '0'), name: `Colaborador ${n}`, status: 'ACTIVE',
  contract: { id: 'CT-1', name: 'Contrato A', branch: '01', companyId: '10' }, managedContracts: [{ id: 'CT-1', name: 'Contrato A', branch: '01', companyId: '10' }],
  role: { id: '45', title: 'Auxiliar' }, position: { id: '12', title: 'Operação' },
  workShift: { id: '001', label: 'Segunda a sexta', notationRule: '5x2', sequence: '01' }, degree: 'Médio',
  hiredAt: '2022-03-14T00:00:00Z', hiredType: '1', firedAt: '', firedType: '', parentId: '', nextiPersonIds: [1000 + n],
  medicalRecord: `FM-${n}`, medicalRecordUpdatedAt: '2026-08-02T14:30:00Z', wageInCents: 300000 + n,
  createdAt: '2022-03-14T09:12:00Z', updatedAt: '2026-09-20T17:45:10Z', ...over,
});

function fake(initial: unknown[][]) {
  const state = { pages: initial, calls: [] as { cursor: string | null; limit: number }[], fail: null as Error | null };
  const client: Easy365Client = {
    async listCollaborators({ cursor, limit }) {
      state.calls.push({ cursor: cursor ?? null, limit });
      if (state.fail) throw state.fail;
      const i = cursor ? Number(cursor) : 0;
      return { items: state.pages[i] ?? [], nextCursor: i + 1 < state.pages.length ? String(i + 1) : null, pagination: 'cabeçalho x-next-cursor' };
    },
  };
  return { client, state };
}
const ctxWith = (client?: Easy365Client) => ({ ...makeCtx(sql), easy365: client });
const newRun = async (trigger = 'schedule', day = '2026-10-19') =>
  (await sql`INSERT INTO sync_runs (trigger, status, run_date) VALUES (${trigger}, 'queued', ${day}::date) RETURNING id`)[0]!.id as string;
const run = async (id: string) => (await sql`SELECT * FROM sync_runs WHERE id = ${id}`)[0]!;
const count = async () => (await sql`SELECT count(*)::int AS n FROM collaborators`)[0]!.n as number;
const doSync = async (f: ReturnType<typeof fake>, opts: { budgetMs?: number; pageSize?: number } = { pageSize: 2 }) => {
  const id = await newRun();
  const out = await runSyncStep(ctxWith(f.client), f.client, id, opts);
  return { id, out, row: await run(id) };
};
const FIVE = () => [[raw(1), raw(2)], [raw(3), raw(4)], [raw(5)]];

// ------------------------------------------------------------------ mapeamento
describe('mapeamento dos campos da API', () => {
  it('lê datas nos formatos AAAA-MM-DD, AAAAMMDD e DD/MM/AAAA e ignora datas vazias ou zeradas', () => {
    for (const [input, want] of [['2022-03-14T00:00:00Z', '2022-03-14'], ['2022-03-14', '2022-03-14'], ['20220314', '2022-03-14'], ['14/03/2022', '2022-03-14'],
      ['', null], ['00000000', null], ['0001-01-01T00:00:00Z', null], ['31/02/2022', null], ['abc', null], [null, null], [20220314, '2022-03-14']] as [unknown, string | null][]) {
      expect(parseDate(input), String(input)).toBe(want);
    }
  });

  it('separa o que é sensível, guarda campos novos em extra e descarta registro sem id ou nome', async () => {
    const m = (await mapCollaborator(raw(7, { apelido: 'Zé', novoCampo: { a: 1 }, firedAt: '', nextiPersonIds: [5, 'x', 6.5, 7] })))!;
    expect(m.row).toMatchObject({
      external_id: 'ext-7', register: '000007', name: 'Colaborador 7', status: 'ACTIVE', contract_id: 'CT-1', contract_company_id: '10', role_title: 'Auxiliar', position_title: 'Operação',
      work_shift_notation_rule: '5x2', hired_on: '2022-03-14', fired_on: null, fired_at: null, parent_external_id: null, nexti_person_ids: [5, 7],
      source_updated_at: '2026-09-20T17:45:10.000Z',
    });
    expect(m.row.extra).toEqual({ apelido: 'Zé', novoCampo: { a: 1 } });
    expect(JSON.stringify(m.row)).not.toContain('FM-7');
    expect(JSON.stringify(m.row)).not.toContain('300007');
    expect(m.priv).toEqual({ wage_cents: 300007, medical_record: 'FM-7' });
    expect(await mapCollaborator({ name: 'Sem id' })).toBeNull();
    expect(await mapCollaborator({ id: 'x' })).toBeNull();
    expect(await mapCollaborator('lixo')).toBeNull();
    expect((await mapCollaborator({ id: 'só-id-e-nome', name: 'Fulano' }))!.row.status).toBe('UNKNOWN');
  });

  it('o resumo identifica mudança em qualquer campo, inclusive nos sensíveis', async () => {
    const a = await mapCollaborator(raw(1));
    expect((await mapCollaborator(raw(1)))!.hash).toBe(a!.hash);
    expect((await mapCollaborator(raw(1, { role: { id: '45', title: 'Encarregado' } })))!.hash).not.toBe(a!.hash);
    expect((await mapCollaborator(raw(1, { wageInCents: 1 })))!.hash).not.toBe(a!.hash);
    expect((await mapCollaborator(raw(1, { extra1: true })))!.hash).not.toBe(a!.hash);
  });
});

// ------------------------------------------------------------------ gravação
describe('carga de colaboradores', () => {
  it('primeira carga: lê todas as páginas, cria os registros e guarda os dados sensíveis à parte', async () => {
    const f = fake(FIVE());
    const { out, row } = await doSync(f);
    expect(out.status).toBe('ok');
    expect(row).toMatchObject({ status: 'ok', pages: 3, fetched: 5, created: 5, updated: 0, unchanged: 0, missing: 0, pagination: 'cabeçalho x-next-cursor', error: null, cursor: null });
    expect(f.state.calls).toEqual([{ cursor: null, limit: 2 }, { cursor: '1', limit: 2 }, { cursor: '2', limit: 2 }]);
    expect(await count()).toBe(5);

    const c = (await sql`SELECT * FROM collaborators WHERE external_id = 'ext-3'`)[0]!;
    expect(c).toMatchObject({ register: '000003', name: 'Colaborador 3', status: 'ACTIVE', contract_name: 'Contrato A', role_title: 'Auxiliar', work_shift_label: 'Segunda a sexta', nexti_person_ids: [1003], missing_since: null, user_id: null });
    expect(String(c.hired_on)).toContain('2022');
    expect(c.managed_contracts).toEqual([{ id: 'CT-1', name: 'Contrato A', branch: '01', companyId: '10' }]);
    expect(Object.keys(c)).not.toContain('wage_cents');
    expect(JSON.stringify(c)).not.toContain('FM-3');
    const p = (await sql`SELECT p.wage_cents, p.medical_record FROM collaborator_private p JOIN collaborators c ON c.id = p.collaborator_id WHERE c.external_id = 'ext-3'`)[0]!;
    expect(p).toMatchObject({ wage_cents: 300003, medical_record: 'FM-3' });
  });

  it('segunda carga igual não altera nada; mudança em um campo atualiza só aquele registro', async () => {
    const f = fake(FIVE());
    await doSync(f);
    const before = (await sql`SELECT synced_at FROM collaborators WHERE external_id = 'ext-1'`)[0]!.synced_at as Date;
    clock.now = new Date('2026-10-20T12:00:00Z');
    const same = await doSync(f);
    expect(same.row).toMatchObject({ created: 0, updated: 0, unchanged: 5, missing: 0 });
    expect((await sql`SELECT synced_at, last_seen_at FROM collaborators WHERE external_id = 'ext-1'`)[0]).toMatchObject({ synced_at: before, last_seen_at: new Date('2026-10-20T12:00:00Z') });

    f.state.pages = [[raw(1), raw(2, { role: { id: '50', title: 'Encarregado' }, status: 'VACATION' })], [raw(3), raw(4)], [raw(5, { campoNovo: 'x' })]];
    const changed = await doSync(f);
    expect(changed.row).toMatchObject({ created: 0, updated: 2, unchanged: 3 });
    expect((await sql`SELECT role_title, status FROM collaborators WHERE external_id = 'ext-2'`)[0]).toEqual({ role_title: 'Encarregado', status: 'VACATION' });
    expect((await sql`SELECT extra FROM collaborators WHERE external_id = 'ext-5'`)[0]!.extra).toEqual({ campoNovo: 'x' });
  });

  it('mudança só nos dados sensíveis atualiza a tabela restrita', async () => {
    const f = fake([[raw(1)]]);
    await doSync(f);
    f.state.pages = [[raw(1, { wageInCents: 999900 })]];
    expect((await doSync(f)).row).toMatchObject({ updated: 1 });
    expect(Number((await sql`SELECT wage_cents FROM collaborator_private`)[0]!.wage_cents)).toBe(999900);
  });

  it('quem deixa de vir na API fica marcado como ausente; se voltar, a marca sai', async () => {
    const f = fake(FIVE());
    await doSync(f);
    f.state.pages = [[raw(1), raw(2)], [raw(3), raw(4)]];
    clock.now = new Date('2026-10-20T12:00:00Z');
    const gone = await doSync(f);
    expect(gone.row).toMatchObject({ status: 'ok', missing: 1, unchanged: 4 });
    expect((await sql`SELECT external_id, missing_since FROM collaborators WHERE missing_since IS NOT NULL`).map((r) => r.external_id)).toEqual(['ext-5']);
    clock.now = new Date('2026-10-21T12:00:00Z');
    expect((await doSync(f)).row.missing).toBe(0); // já estava marcado: não conta de novo
    f.state.pages = FIVE();
    await doSync(f);
    expect((await sql`SELECT count(*)::int AS n FROM collaborators WHERE missing_since IS NOT NULL`)[0]!.n).toBe(0);
  });

  it('registros repetidos na mesma página valem uma vez; inválidos são ignorados sem derrubar a carga', async () => {
    const f = fake([[raw(1), raw(1, { name: 'Colaborador 1 (atualizado)' }), { name: 'sem id' }, 'lixo', raw(2)]]);
    const { row } = await doSync(f, { pageSize: 100 });
    expect(row).toMatchObject({ status: 'ok', fetched: 5, created: 2 });
    expect((await sql`SELECT name FROM collaborators WHERE external_id = 'ext-1'`)[0]!.name).toBe('Colaborador 1 (atualizado)');
  });
});

describe('carga: travas de segurança', () => {
  it('lista vazia depois de já ter colaboradores é erro e não marca ninguém como ausente', async () => {
    const f = fake(FIVE());
    await doSync(f);
    f.state.pages = [[]];
    const { row } = await doSync(f);
    expect(row.status).toBe('error');
    expect(row.error).toMatch(/lista vazia/);
    expect((await sql`SELECT count(*)::int AS n FROM collaborators WHERE missing_since IS NOT NULL`)[0]!.n).toBe(0);
  });

  it('menos da metade dos colaboradores conhecidos é erro (credencial que perdeu acesso a contratos)', async () => {
    const many = Array.from({ length: 30 }, (_, i) => raw(i + 1));
    const f = fake([many]);
    await doSync(f, { pageSize: 100 });
    f.state.pages = [many.slice(0, 10)];
    const { row } = await doSync(f, { pageSize: 100 });
    expect(row.status).toBe('error');
    expect(row.error).toMatch(/só 10 de 30/);
    expect((await sql`SELECT count(*)::int AS n FROM collaborators WHERE missing_since IS NOT NULL`)[0]!.n).toBe(0);
    f.state.pages = [many.slice(0, 20)]; // 2/3: normal
    expect((await doSync(f, { pageSize: 100 })).row).toMatchObject({ status: 'ok', missing: 10 });
  });

  it('página cheia sem cursor, sem nunca ter visto cursor, para com instrução; a última página cheia depois de cursores é normal', async () => {
    const nocursor: Easy365Client = { async listCollaborators() { return { items: [raw(1), raw(2)], nextCursor: null, pagination: 'sem sinal de cursor' }; } };
    const id = await newRun();
    const out = await runSyncStep(ctxWith(nocursor), nocursor, id, { pageSize: 2 });
    expect(out.status).toBe('error');
    expect((await run(id)).error).toMatch(/página cheia e não informou o cursor/);
    expect(await count()).toBe(2); // o que foi lido fica salvo

    const f = fake([[raw(1), raw(2)], [raw(3), raw(4)]]); // a última página tem exatamente 2 (= limite) e não traz cursor: fim legítimo
    expect((await doSync(f)).row).toMatchObject({ status: 'ok', fetched: 4 });
  });

  it('cursor repetido interrompe a carga; falha da API vira erro legível e não apaga dados', async () => {
    const loop: Easy365Client = { async listCollaborators() { return { items: [raw(1)], nextCursor: 'mesmo', pagination: 'x' }; } };
    const id = await newRun();
    expect((await runSyncStep(ctxWith(loop), loop, id, { pageSize: 5 })).status).toBe('error');
    expect((await run(id)).error).toMatch(/repetiu o mesmo cursor/);

    const f = fake(FIVE());
    await doSync(f);
    f.state.fail = new Easy365Error('Login na Easy365 recusado (HTTP 401)', 401);
    const bad = await doSync(f);
    expect(bad.row).toMatchObject({ status: 'error', error: 'Login na Easy365 recusado (HTTP 401)' });
    f.state.fail = new Error('boom');
    expect((await doSync(f)).row.error).toBe('Erro inesperado na carga: boom');
    expect(await count()).toBe(5);
  });

  it('sem tempo para terminar, fica parcial com o cursor e continua de onde parou, sem repetir nem perder', async () => {
    const f = fake(FIVE());
    const id = await newRun();
    const ctx = ctxWith(f.client);
    expect((await runSyncStep(ctx, f.client, id, { pageSize: 2, budgetMs: 0 })).status).toBe('partial');
    expect(await run(id)).toMatchObject({ status: 'partial', cursor: '1', pages: 1, fetched: 2, created: 2, attempt: 1 });
    expect(await count()).toBe(2);
    expect((await runSyncStep(ctx, f.client, id, { pageSize: 2 })).status).toBe('ok');
    expect(await run(id)).toMatchObject({ status: 'ok', cursor: null, pages: 3, fetched: 5, created: 5, attempt: 2 });
    expect(f.state.calls.map((c) => c.cursor)).toEqual([null, '1', '2']);
    expect(await count()).toBe(5);
    expect((await runSyncStep(ctx, f.client, id, { pageSize: 2 })).status).toBe('skipped'); // não reabre carga concluída
  });
});

// ------------------------------------------------------------------ agendamento
describe('agendamento da carga diária', () => {
  const at = (iso: string) => { clock.now = new Date(iso); };
  const runs = async () => await sql`SELECT trigger, status, run_date::text AS day FROM sync_runs ORDER BY created_at, id`;

  it('sem credenciais não faz nada', async () => {
    expect(await collaboratorSyncTick(ctxWith(undefined))).toBe('not_configured');
    expect(await runs()).toEqual([]);
  });

  it('só começa depois das 03h de São Paulo e faz uma carga bem-sucedida por dia', async () => {
    const f = fake([[raw(1), raw(2)]]);
    const ctx = () => ctxWith(f.client);
    at('2026-10-20T05:30:00Z'); // 02h30 em São Paulo
    expect(await collaboratorSyncTick(ctx(), { pageSize: 5 })).toBe('idle');
    expect(await runs()).toEqual([]);
    at('2026-10-20T06:10:00Z'); // 03h10
    expect(await collaboratorSyncTick(ctx(), { pageSize: 5 })).toBe('ok');
    expect(await runs()).toEqual([{ trigger: 'schedule', status: 'ok', day: '2026-10-20' }]);
    expect(await count()).toBe(2);
    at('2026-10-20T15:00:00Z');
    expect(await collaboratorSyncTick(ctx(), { pageSize: 5 })).toBe('idle'); // já fez hoje
    expect(f.state.calls).toHaveLength(1);
    at('2026-10-21T06:05:00Z');
    expect(await collaboratorSyncTick(ctx(), { pageSize: 5 })).toBe('ok'); // dia seguinte
    expect((await runs()).map((r) => r.day)).toEqual(['2026-10-20', '2026-10-21']);
  });

  it('o dia é o de São Paulo: 01h de São Paulo ainda é o dia anterior para efeito de horário', async () => {
    const f = fake([[raw(1)]]);
    at('2026-10-21T02:00:00Z'); // 23h do dia 20 em São Paulo: depois das 03h do dia 20, ainda sem carga nesse dia
    expect(await collaboratorSyncTick(ctxWith(f.client), { pageSize: 5 })).toBe('ok');
    expect((await runs())[0]!.day).toBe('2026-10-20');
  });

  it('erro: espera 15 minutos entre tentativas e para depois de 5 no dia', async () => {
    const f = fake([[raw(1)]]);
    f.state.fail = new Easy365Error('API fora do ar', 503);
    const tick = () => collaboratorSyncTick(ctxWith(f.client), { pageSize: 5 });
    at('2026-10-20T06:00:00Z');
    expect(await tick()).toBe('error');
    at('2026-10-20T06:10:00Z');
    expect(await tick()).toBe('waiting'); // só 10 min
    expect(f.state.calls).toHaveLength(1);
    for (let i = 1; i < 5; i++) { at(`2026-10-20T${String(6 + i).padStart(2, '0')}:00:00Z`); expect(await tick(), `tentativa ${i + 1}`).toBe('error'); }
    f.state.fail = null;
    at('2026-10-20T14:00:00Z');
    expect(await tick()).toBe('idle'); // 5 erros hoje: para até amanhã
    at('2026-10-21T06:00:00Z');
    expect(await tick()).toBe('ok');
  });

  it('continua uma carga parcial na rodada seguinte, mesmo fora do horário', async () => {
    const f = fake(FIVE());
    at('2026-10-20T06:00:00Z');
    expect(await collaboratorSyncTick(ctxWith(f.client), { pageSize: 2, budgetMs: 0 })).toBe('partial');
    at('2026-10-20T06:05:00Z');
    expect(await collaboratorSyncTick(ctxWith(f.client), { pageSize: 2 })).toBe('ok');
    expect(await count()).toBe(5);
    expect((await runs())).toEqual([{ trigger: 'schedule', status: 'ok', day: '2026-10-20' }]); // uma única carga
  });

  it('carga travada há mais de 10 minutos vira erro; carga em andamento recente faz esperar', async () => {
    const f = fake([[raw(1)]]);
    at('2026-10-20T06:00:00Z');
    const id = (await sql`INSERT INTO sync_runs (trigger, status, run_date, updated_at) VALUES ('schedule', 'running', '2026-10-20', '2026-10-20T05:55:00Z') RETURNING id`)[0]!.id as string;
    expect(await collaboratorSyncTick(ctxWith(f.client), { pageSize: 5 })).toBe('waiting'); // 5 min: ainda vale
    at('2026-10-20T06:20:00Z');
    await collaboratorSyncTick(ctxWith(f.client), { pageSize: 5 });
    expect(await run(id)).toMatchObject({ status: 'error' });
    expect((await run(id)).error).toMatch(/Interrompida/);
  });

  it('pedido manual vai para a fila e é atendido na próxima rodada, a qualquer hora', async () => {
    const f = fake([[raw(1)]]);
    const admin = { id: w.admin, role: 'admin' as const, adminLevel: 'owner' as const };
    at('2026-10-20T04:00:00Z'); // 01h em São Paulo
    const q = await requestSync(ctxWith(f.client), admin);
    expect(q.status).toBe('queued');
    await expect(requestSync(ctxWith(f.client), admin)).rejects.toMatchObject({ code: 'sync_in_progress' });
    expect(await collaboratorSyncTick(ctxWith(f.client), { pageSize: 5 })).toBe('ok');
    expect(await runs()).toEqual([{ trigger: 'manual', status: 'ok', day: '2026-10-20' }]);
    expect((await run(q.id)).requested_by).toBe(w.admin);
    await expect(requestSync(ctxWith(undefined), admin)).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('a rodada geral (runJobs) executa a carga e uma falha nela não derruba as outras rotinas', async () => {
    const { runJobs } = await import('../src/jobs');
    const f = fake([[raw(1)]]);
    at('2026-10-20T06:00:00Z');
    expect((await runJobs(ctxWith(f.client), { payouts: false })).collaborator_sync).toBe('ok');
    expect((await runJobs(ctxWith(undefined), { payouts: false })).collaborator_sync).toBe('not_configured');
    await sql`ALTER TABLE sync_runs RENAME TO sync_runs_x`; // simula falha de banco só nessa etapa
    try {
      const s = await runJobs(ctxWith(f.client), { payouts: false });
      expect(s.collaborator_sync).toBe('error');
      expect(s.errors).toBe(0);
    } finally { await sql`ALTER TABLE sync_runs_x RENAME TO sync_runs`; }
  });
});

// ------------------------------------------------------------------ painel (API)
describe('colaboradores no painel', () => {
  const PHONE_RAW = '(27) 99888-1122';
  const PHONE = '+5527998881122';
  const AUTH_ID = '66666666-aaaa-4aaa-8aaa-666666666666';
  let app: ReturnType<typeof makeApp>;
  let f: ReturnType<typeof fake>;
  const list = (qs = '', who: string | null = w.admin) => call(app, 'GET', `/v1/admin/collaborators${qs}`, who);
  const idOf = async (ext: string) => (await sql`SELECT id FROM collaborators WHERE external_id = ${ext}`)[0]!.id as string;

  beforeEach(async () => {
    f = fake([[raw(1), raw(2, { status: 'VACATION' })], [raw(3, { contract: { id: 'CT-2', name: 'Contrato B', branch: '02', companyId: '10' } })]]);
    app = makeApp(sql, true, undefined, { easy365: f.client });
    await doSync(f);
  });

  it('só a equipe vê; a resposta nunca traz salário nem ficha médica', async () => {
    expect((await list('', w.client)).status).toBe(403);
    expect((await list('', w.pro)).status).toBe(403);
    expect((await list('', null)).status).toBe(401);
    const r = await list('', operator);
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.json);
    expect(text).not.toMatch(/FM-\d/);
    expect(text).not.toContain('30000');
    expect(text).not.toMatch(/wage|medical_record"/);
  });

  it('lista com resumo, contratos, situações, filtros e paginação', async () => {
    const r = (await list()).json;
    expect(r.total).toBe(3);
    expect(r.summary).toMatchObject({ total: 3, active: 2, missing: 0, linked: 0, waiting: 0 });
    expect(r.contracts).toEqual([{ id: 'CT-1', name: 'Contrato A', count: 2 }, { id: 'CT-2', name: 'Contrato B', count: 1 }]);
    expect(r.statuses).toEqual([{ status: 'ACTIVE', count: 2 }, { status: 'VACATION', count: 1 }]);
    expect(r.sync.configured).toBe(true);
    expect(r.sync.last).toMatchObject({ status: 'ok', fetched: 3, created: 3 });
    expect(r.items[0]).toMatchObject({
      register: '000001', name: 'Colaborador 1', status: 'ACTIVE', contract: { id: 'CT-1', name: 'Contrato A', branch: '01' }, role_title: 'Auxiliar',
      work_shift: { label: 'Segunda a sexta', notation_rule: '5x2' }, hired_on: '2022-03-14', link: { state: 'none', phone: null, user_id: null },
    });
    const names = async (qs: string) => (await list(qs)).json.items.map((i: any) => i.name);
    expect(await names('?q=colaborador 2')).toEqual(['Colaborador 2']);
    expect(await names('?q=000003')).toEqual(['Colaborador 3']);
    expect(await names('?status=VACATION')).toEqual(['Colaborador 2']);
    expect(await names('?contract=CT-2')).toEqual(['Colaborador 3']);
    expect(await names('?view=unlinked')).toHaveLength(3);
    expect(await names('?view=missing')).toEqual([]);
    expect(await names('?q=%25')).toEqual([]);
    expect((await list('?limit=1&offset=1')).json.items.map((i: any) => i.name)).toEqual(['Colaborador 2']);
    expect((await list('?view=qualquer')).status).toBe(400);
  });

  it('o histórico de cargas está disponível para a equipe', async () => {
    const r = await call(app, 'GET', '/v1/admin/collaborators/sync-runs', operator);
    expect(r.json.items[0]).toMatchObject({ trigger: 'schedule', status: 'ok', fetched: 3, created: 3, pagination: 'cabeçalho x-next-cursor' });
    expect((await call(app, 'GET', '/v1/admin/collaborators/sync-runs', w.client)).status).toBe(403);
  });

  it('pedir carga agora: só administrador, entra na fila uma vez', async () => {
    expect((await call(app, 'POST', '/v1/admin/collaborators/sync', operator, {})).status).toBe(403);
    expect((await call(app, 'POST', '/v1/admin/collaborators/sync', w.admin, {})).status).toBe(202);
    expect((await call(app, 'POST', '/v1/admin/collaborators/sync', w.admin, {})).json.error.code).toBe('sync_in_progress');
    const semIntegracao = makeApp(sql);
    await sql`DELETE FROM sync_runs WHERE status = 'queued'`;
    expect((await call(semIntegracao, 'POST', '/v1/admin/collaborators/sync', w.admin, {})).json.error.code).toBe('not_configured');
    expect((await call(semIntegracao, 'GET', '/v1/admin/collaborators', w.admin)).json.sync.configured).toBe(false);
  });

  it('vincular a um celular novo deixa aguardando; o cadastro como profissional com esse celular faz o vínculo sozinho', async () => {
    const id = await idOf('ext-1');
    expect((await call(app, 'PUT', `/v1/admin/collaborators/${id}/link`, operator, { phone: PHONE_RAW })).status).toBe(403);
    const r = await call(app, 'PUT', `/v1/admin/collaborators/${id}/link`, w.admin, { phone: PHONE_RAW });
    expect(r.json).toEqual({ id, state: 'waiting', phone: PHONE });
    expect((await list('?view=waiting')).json.items.map((i: any) => [i.name, i.link.state, i.link.phone])).toEqual([['Colaborador 1', 'waiting', PHONE]]);
    expect((await list()).json.summary).toMatchObject({ waiting: 1, linked: 0 });

    const reg = await call(app, 'POST', '/v1/me/register', null, { role: 'professional', full_name: 'Colaborador Um', accepted_terms_version: 'v1' }, asIdentity(AUTH_ID, '5527998881122'));
    expect(reg.status).toBe(201);
    const c = (await sql`SELECT user_id, link_phone, linked_at FROM collaborators WHERE id = ${id}`)[0]!;
    expect(c.user_id).toBe(AUTH_ID);
    expect(c.link_phone).toBeNull();
    expect(c.linked_at).not.toBeNull();
    expect((await list('?view=linked')).json.items[0]).toMatchObject({ name: 'Colaborador 1', link: { state: 'linked', user_id: AUTH_ID, user_name: 'Colaborador Um' } });
    expect((await sql`SELECT action FROM audit_logs WHERE action LIKE 'collaborator.%' ORDER BY created_at, id`).map((a) => a.action)).toEqual(['collaborator.linked', 'collaborator.auto_linked']);

    const pros = (await call(app, 'GET', '/v1/admin/professionals?q=Colaborador', w.admin)).json.items;
    expect(pros.find((p: any) => p.id === AUTH_ID)).toMatchObject({ is_collaborator: true });
    const det = (await call(app, 'GET', `/v1/admin/professionals/${AUTH_ID}`, w.admin)).json;
    expect(det.collaborator).toMatchObject({ register: '000001', status: 'ACTIVE', contract: 'Contrato A', role: 'Auxiliar', work_shift: 'Segunda a sexta', hired_on: '2022-03-14' });
    expect((await call(app, 'GET', `/v1/admin/professionals/${w.pro}`, w.admin)).json.collaborator).toBeNull();
  });

  it('vincular a um profissional que já tem conta faz o vínculo na hora', async () => {
    const id = await idOf('ext-2');
    const r = await call(app, 'PUT', `/v1/admin/collaborators/${id}/link`, w.admin, { phone: '(27) 90000-0003' }); // telefone do profissional de teste
    expect(r.json).toEqual({ id, state: 'linked', phone: null });
    expect((await sql`SELECT user_id, link_phone FROM collaborators WHERE id = ${id}`)[0]).toEqual({ user_id: w.pro, link_phone: null });
  });

  it('recusa telefone inválido, de conta que não é profissional, repetido, e colaborador já vinculado', async () => {
    const [a, b] = [await idOf('ext-1'), await idOf('ext-2')];
    const put = (id: string, phone: string) => call(app, 'PUT', `/v1/admin/collaborators/${id}/link`, w.admin, { phone });
    expect((await put(a, '12345678')).json.error.code).toBe('phone_invalid');
    expect((await put(a, '123')).status).toBe(400);
    expect((await put(a, '(27) 90000-0001')).json.error.code).toBe('phone_in_use'); // é de um cliente
    expect((await put(a, '(27) 90000-0005')).json.error.code).toBe('phone_in_use'); // é de um administrador
    expect((await put(a, PHONE_RAW)).status).toBe(200);
    expect((await put(b, '27998881122')).json.error.code).toBe('phone_taken');
    expect((await put(b, '(27) 90000-0003')).status).toBe(200);
    expect((await put(a, '(27) 90000-0004')).status).toBe(200); // reservado pode ser trocado enquanto aguarda
    const c = await idOf('ext-3');
    expect((await put(c, '(27) 90000-0003')).json.error.code).toBe('user_already_linked'); // essa conta já é do ext-2
    expect((await put(b, '(27) 90000-0004')).json.error.code).toBe('already_linked');
    expect((await call(app, 'PUT', '/v1/admin/collaborators/11111111-1111-4111-8111-111111111111/link', w.admin, { phone: PHONE_RAW })).status).toBe(404);
  });

  it('colaborador desligado ou fora da base não pode ser vinculado', async () => {
    f.state.pages = [[raw(1), raw(2, { status: 'FIRED' }), raw(3, { status: 'INACTIVE' })]];
    await doSync(f, { pageSize: 100 });
    for (const ext of ['ext-2', 'ext-3']) {
      expect((await call(app, 'PUT', `/v1/admin/collaborators/${await idOf(ext)}/link`, w.admin, { phone: PHONE_RAW })).json.error.code, ext).toBe('collaborator_left');
    }
    f.state.pages = [[raw(1), raw(2, { status: 'FIRED' })]]; // ext-3 saiu da base
    clock.now = new Date('2026-10-20T12:00:00Z');
    await doSync(f, { pageSize: 100 });
    expect((await call(app, 'PUT', `/v1/admin/collaborators/${await idOf('ext-3')}/link`, w.admin, { phone: PHONE_RAW })).json.error.code).toBe('collaborator_left');
    expect((await call(app, 'PUT', `/v1/admin/collaborators/${await idOf('ext-1')}/link`, w.admin, { phone: PHONE_RAW })).status).toBe(200);
  });

  it('profissional vinculado que é desligado ou sai da base some da busca, com registro; os demais não são afetados', async () => {
    const search = () => call(app, 'GET', `/v1/search/professionals?category=pintor&date=2026-10-20&address_id=${w.address}`, w.client);
    f.state.pages = [[raw(1), raw(2), raw(3)]];
    await doSync(f, { pageSize: 100 });
    await sql`UPDATE users SET phone = '+5527900000003' WHERE id = ${w.pro}`;
    await call(app, 'PUT', `/v1/admin/collaborators/${await idOf('ext-1')}/link`, w.admin, { phone: '(27) 90000-0003' }); // w.pro
    await call(app, 'PUT', `/v1/admin/collaborators/${await idOf('ext-2')}/link`, w.admin, { phone: '(27) 90000-0004' }); // w.pro2
    expect((await search()).json.items).toHaveLength(2);

    f.state.pages = [[raw(1, { status: 'FIRED' }), raw(3)]]; // ext-1 desligado; ext-2 saiu da base
    clock.now = new Date('2026-10-20T12:00:00Z');
    await doSync(f, { pageSize: 100 });
    expect((await sql`SELECT user_id, visible FROM professional_profiles ORDER BY visible, user_id`).map((r) => r.visible)).toEqual([false, false]);
    expect((await search()).json.items).toEqual([]);
    const log = await sql`SELECT actor_id, after FROM audit_logs WHERE action = 'collaborator.auto_hidden' ORDER BY (after->>'name')`;
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ actor_id: null, after: { visible: false, reason: 'Situação FIRED no Protheus', name: 'Colaborador 1' } });
    expect(log[1]!.after).toMatchObject({ reason: 'Saiu da base do Protheus', name: 'Colaborador 2' });
    // a conta continua ativa, e a operação pode exibir de novo se decidir
    expect((await sql`SELECT status FROM users WHERE id = ${w.pro}`)[0]!.status).toBe('active');
    expect((await call(app, 'PUT', `/v1/admin/professionals/${w.pro}/visible`, w.admin, { visible: true })).status).toBe(200);
    // uma nova carga não repete o registro para quem já estava oculto
    clock.now = new Date('2026-10-21T12:00:00Z');
    await doSync(f, { pageSize: 100 });
    expect((await sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'collaborator.auto_hidden'`)[0]!.n).toBe(3); // ext-1 voltou a ser ocultado pois foi reexibido
  });

  it('desvincular libera o colaborador e o celular', async () => {
    const id = await idOf('ext-1');
    await call(app, 'PUT', `/v1/admin/collaborators/${id}/link`, w.admin, { phone: PHONE_RAW });
    expect((await call(app, 'DELETE', `/v1/admin/collaborators/${id}/link`, operator)).status).toBe(403);
    expect((await call(app, 'DELETE', `/v1/admin/collaborators/${id}/link`, w.admin)).status).toBe(204);
    expect((await list('?view=unlinked')).json.items).toHaveLength(3);
    expect((await call(app, 'DELETE', `/v1/admin/collaborators/${id}/link`, w.admin)).json.error.code).toBe('not_linked');
    // o celular fica livre para outro colaborador
    expect((await call(app, 'PUT', `/v1/admin/collaborators/${await idOf('ext-2')}/link`, w.admin, { phone: PHONE_RAW })).status).toBe(200);
  });

  it('quem se cadastra como cliente com um celular reservado não é vinculado', async () => {
    await call(app, 'PUT', `/v1/admin/collaborators/${await idOf('ext-1')}/link`, w.admin, { phone: PHONE_RAW });
    await call(app, 'POST', '/v1/me/register', null, { role: 'client', full_name: 'Alguém', accepted_terms_version: 'v1' }, asIdentity(AUTH_ID, '5527998881122'));
    expect((await sql`SELECT user_id, link_phone FROM collaborators WHERE external_id = 'ext-1'`)[0]).toEqual({ user_id: null, link_phone: PHONE });
  });
});

// ------------------------------------------------------------------ lista única de profissionais
describe('lista única: profissionais e colaboradores juntos', () => {
  let app: ReturnType<typeof makeApp>;
  let f: ReturnType<typeof fake>;
  const list = (qs = '', who: string | null = w.admin) => call(app, 'GET', `/v1/admin/professionals${qs}`, who);
  const names = async (qs = '') => (await list(qs)).json.items.map((i: any) => i.full_name).sort();
  const idOf = async (ext: string) => (await sql`SELECT id FROM collaborators WHERE external_id = ${ext}`)[0]!.id as string;

  beforeEach(async () => {
    f = fake([[raw(1), raw(2), raw(3, { status: 'FIRED' }), raw(4), raw(5), raw(6)]]);
    app = makeApp(sql, true, undefined, { easy365: f.client });
    await doSync(f, { pageSize: 100 });
    // ext-1 vira o profissional de teste (conta existente); ext-2 é convidado e ainda não entrou
    await call(app, 'PUT', `/v1/admin/collaborators/${await idOf('ext-1')}/link`, w.admin, { phone: '(27) 90000-0003' });
    await call(app, 'PUT', `/v1/admin/collaborators/${await idOf('ext-2')}/link`, w.admin, { phone: '(27) 99888-1122' });
  });

  it('"Todos" mostra as contas de profissional e os colaboradores convidados que ainda não entraram; a base inteira fica de fora', async () => {
    const r = (await list()).json;
    expect(r.total).toBe(3);
    expect(await names()).toEqual(['Colaborador 2', 'Marcos S.', 'Rafaela T.']);
    expect(r.summary).toMatchObject({ total: 3, approved: 2, visible: 2, prereg: 1, base: 3, from_protheus: 2, suspended: 0, incomplete: 0 });
  });

  it('cada linha diz de onde vem: conta com registro no Protheus, conta direta, ou colaborador aguardando o 1º acesso', async () => {
    const items = (await list()).json.items;
    const by = (n: string) => items.find((i: any) => i.full_name === n);
    expect(by('Marcos S.')).toMatchObject({
      kind: 'professional', is_collaborator: true, kyc_status: 'approved', visible: true,
      collaborator: { register: '000001', contract: 'Contrato A', role: 'Auxiliar', position: 'Operação', status: 'ACTIVE', hired_on: '2022-03-14', link_state: 'linked', link_phone: null },
    });
    expect(by('Marcos S.').offers).toEqual([{ category: 'pintor', rate_cents: 20000 }]);
    expect(by('Rafaela T.')).toMatchObject({ kind: 'professional', is_collaborator: false, collaborator: null });
    const waiting = by('Colaborador 2');
    expect(waiting).toMatchObject({
      kind: 'collaborator', id: await idOf('ext-2'), phone: '+5527998881122', is_collaborator: true, has_profile: false, kyc_status: null, visible: false,
      rating_count: 0, completed_count: 0, offers: [], bookings_total: 0, active_strikes: 0,
      collaborator: { register: '000002', link_state: 'waiting', link_phone: '+5527998881122' },
    });
  });

  it('"Base Protheus" lista só quem ainda pode ser convidado: sem convite, sem conta, ativo e presente na base', async () => {
    await sql`UPDATE collaborators SET missing_since = now() WHERE external_id = 'ext-6'`;
    const r = (await list('?view=base')).json;
    expect(r.items.map((i: any) => i.full_name).sort()).toEqual(['Colaborador 4', 'Colaborador 5']); // 1 e 2 já têm convite/conta, 3 foi desligado, 6 saiu da base
    expect(r.items.every((i: any) => i.kind === 'collaborator' && i.phone === null && i.collaborator.link_state === 'none')).toBe(true);
    expect(r.total).toBe(2);
    expect((await list('?view=prereg')).json.items.map((i: any) => i.full_name)).toEqual(['Colaborador 2']);
  });

  it('origem: Protheus (com conta ou convidado) ou cadastro direto', async () => {
    expect(await names('?origin=protheus')).toEqual(['Colaborador 2', 'Marcos S.']);
    expect(await names('?origin=direct')).toEqual(['Rafaela T.']);
  });

  it('filtros que só valem para quem tem conta tiram os colaboradores da lista', async () => {
    for (const qs of ['?kyc=approved', '?visible=true', '?service=pintor', '?status=active']) expect(await names(qs), qs).toEqual(['Marcos S.', 'Rafaela T.']);
    expect(await names('?kyc=pending')).toEqual([]);
    expect(await names('?kyc=incomplete')).toEqual([]);
    expect(await names('?status=suspended')).toEqual([]);
    expect(await names('?origin=direct&kyc=approved')).toEqual(['Rafaela T.']);
  });

  it('a busca acha pelo nome, matrícula e celular, e respeita onde a pessoa está', async () => {
    expect(await names('?q=Colaborador 2')).toEqual(['Colaborador 2']);
    expect(await names('?q=000002')).toEqual(['Colaborador 2']);
    expect(await names('?q=99888')).toEqual(['Colaborador 2']);
    expect(await names('?q=marc')).toEqual(['Marcos S.']);
    expect(await names('?q=Colaborador 4')).toEqual([]); // está na base, não em "Todos"
    expect(await names('?view=base&q=Colaborador 4')).toEqual(['Colaborador 4']);
    expect(await names('?view=base&q=000005')).toEqual(['Colaborador 5']);
    expect(await names('?q=%25')).toEqual([]);
  });

  it('a paginação percorre as duas fontes sem repetir nem perder ninguém', async () => {
    const seen: string[] = [];
    for (let offset = 0; offset < 4; offset++) {
      const r = (await list(`?limit=1&offset=${offset}`)).json;
      expect(r.total).toBe(3);
      seen.push(...r.items.map((i: any) => `${i.kind}:${i.id}`));
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  it('quando o convidado faz o 1º acesso, a linha de colaborador dá lugar à conta, sem duplicar', async () => {
    const AUTH = '55555555-aaaa-4aaa-8aaa-555555555555';
    const before = (await list()).json;
    expect(before.items.filter((i: any) => i.full_name === 'Colaborador 2')).toHaveLength(1);
    await call(app, 'POST', '/v1/me/register', null, { role: 'professional', full_name: 'José Carlos', accepted_terms_version: 'v1' }, asIdentity(AUTH, '5527998881122'));
    const after = (await list()).json;
    expect(after.total).toBe(3);
    expect(after.items.find((i: any) => i.full_name === 'Colaborador 2')).toBeUndefined();
    expect(after.items.find((i: any) => i.id === AUTH)).toMatchObject({ kind: 'professional', has_profile: false, collaborator: { register: '000002', link_state: 'linked' } });
    expect(after.summary).toMatchObject({ incomplete: 1, prereg: 0, from_protheus: 2 });
    expect((await list('?kyc=incomplete')).json.items.map((i: any) => i.id)).toEqual([AUTH]);
  });

  it('salário e ficha médica não aparecem; acesso e validação', async () => {
    const text = JSON.stringify([(await list()).json, (await list('?view=base')).json]);
    expect(text).not.toMatch(/FM-\d|3000\d\d|wage|medical/);
    expect((await list('', operator)).status).toBe(200);
    expect((await list('', w.client)).status).toBe(403);
    expect((await list('', null)).status).toBe(401);
    expect((await list('?origin=xyz')).status).toBe(400);
    expect((await list('?view=xyz')).status).toBe(400);
  });
});

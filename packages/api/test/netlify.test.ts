import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handle } from '../../../netlify/handler';
import { TEST_DB } from './globalSetup';

const env: Record<string, string | undefined> = {};
(globalThis as any).Netlify = { env: { get: (k: string) => env[k] } };
const get = (path: string) => handle(new Request(`http://localhost${path}`));

describe('função da Netlify', () => {
  beforeAll(() => {
    delete env.DATABASE_URL;
  });
  afterAll(() => {
    delete env.DATABASE_URL;
  });

  it('responde /health mesmo sem configuração, indicando que falta o banco', async () => {
    const r = await get('/health');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, configured: false });
  });

  it('devolve 503 not_configured nas rotas da API sem DATABASE_URL', async () => {
    const r = await get('/v1/categories');
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe('not_configured');
  });

  it('com DATABASE_URL, serve a API (categorias públicas e 401 nas rotas protegidas)', async () => {
    env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? `postgres://root:root@localhost/${TEST_DB}`;
    const cats = await get('/v1/categories');
    expect(cats.status).toBe(200);
    expect((await cats.json()).items.length).toBeGreaterThanOrEqual(3);
    const priv = await get('/v1/bookings');
    expect(priv.status).toBe(401);
  });

  it('diagnóstico do /health?db=1 não vaza segredos e mostra o tipo de problema', async () => {
    const good = process.env.TEST_DATABASE_URL ?? `postgres://root:root@localhost/${TEST_DB}`;
    env.DATABASE_URL = good;
    let body = await (await get('/health?db=1')).json();
    expect(body).toMatchObject({ configured: true, url_valid: true, db: 'ok', host_kind: 'other', password_present: true });
    expect(JSON.stringify(body)).not.toContain('root:root');

    env.DATABASE_URL = 'postgres://root:senhaerrada@localhost/' + TEST_DB;
    body = await (await get('/health?db=1')).json();
    expect(body).toMatchObject({ db: 'error', error_code: '28P01' });
    expect(body.hint).toMatch(/Senha recusada/);
    expect(JSON.stringify(body)).not.toContain('senhaerrada');

    env.DATABASE_URL = 'postgres://x:y@host com espaco:99/db';
    body = await (await get('/health?db=1')).json();
    expect(body.url_valid).toBe(false);

    env.DATABASE_URL = 'postgres://postgres.abc:segredo@db.abc.supabase.co:5432/postgres';
    // nada de rede real: só a classificação do endereço importa aqui, por isso usamos um nome que não resolve
    env.DATABASE_URL = 'postgres://postgres:segredo@db.naoexiste-xyz.supabase.co:5432/postgres';
    body = await (await get('/health?db=1')).json();
    expect(body).toMatchObject({ host_kind: 'direct', port: '5432', user_has_project_ref: false, db: 'error' });
    expect(JSON.stringify(body)).not.toContain('segredo');
  });
});


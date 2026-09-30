import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import handler from '../../../netlify/functions/api.mts';
import { TEST_DB } from './globalSetup';

const env: Record<string, string | undefined> = {};
(globalThis as any).Netlify = { env: { get: (k: string) => env[k] } };
const ctx = {} as any;
const get = (path: string) => handler(new Request(`http://localhost${path}`), ctx);

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
});

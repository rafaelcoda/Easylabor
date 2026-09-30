import type { Config, Context } from '@netlify/functions';
import { createApp } from '../../packages/api/src/app';
import { supabaseAuthenticator } from '../../packages/api/src/auth';
import { createSql } from '../../packages/api/src/db';

type AppHandle = ReturnType<typeof createApp>;
let cached: AppHandle | null = null;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Cria a aplicação na primeira chamada (e reaproveita enquanto a instância estiver quente). */
function getApp(): AppHandle | null {
  if (cached) return cached;
  const databaseUrl = Netlify.env.get('DATABASE_URL');
  if (!databaseUrl) return null;

  // Pooler do Supabase (modo transação): sem prepared statements e sem parâmetros de inicialização.
  const sql = createSql(databaseUrl, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10, connection: {} });
  const supabaseUrl = Netlify.env.get('SUPABASE_URL');
  const anonKey = Netlify.env.get('SUPABASE_ANON_KEY');
  const authenticate =
    supabaseUrl && anonKey ? supabaseAuthenticator({ supabaseUrl, anonKey, sql }) : async () => null;

  cached = createApp({ sql, authenticate, devRoutes: Netlify.env.get('DEV_ROUTES') === 'true' });
  return cached;
}

export default async (req: Request, _context: Context) => {
  const { pathname } = new URL(req.url);
  if (pathname === '/health') {
    return json(200, { ok: true, configured: Boolean(Netlify.env.get('DATABASE_URL')) });
  }
  const app = getApp();
  if (!app) {
    return json(503, { error: { code: 'not_configured', message: 'A API ainda não está configurada (DATABASE_URL ausente).', details: {} } });
  }
  return app.fetch(req);
};

export const config: Config = {
  path: ['/health', '/v1/*'],
};

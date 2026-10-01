import { createApp } from '../packages/api/src/app';
import { authenticatorFrom, supabaseIdentity } from '../packages/api/src/auth';
import { createSql } from '../packages/api/src/db';
import { createMockProvider } from '../packages/api/src/payments/provider';

// Variável global fornecida pelo runtime da Netlify.
declare const Netlify: { env: { get(name: string): string | undefined } };

type AppHandle = ReturnType<typeof createApp>;
let cached: AppHandle | null = null;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Lógica da função. O build a empacota em um único arquivo (netlify/functions/_generated/handler.mjs).
 * Cria a aplicação na primeira chamada (e reaproveita enquanto a instância estiver quente). */
function getApp(): AppHandle | null {
  if (cached) return cached;
  const databaseUrl = Netlify.env.get('DATABASE_URL');
  if (!databaseUrl) return null;

  // Pooler do Supabase (modo transação): sem prepared statements e sem parâmetros de inicialização.
  const sql = createSql(databaseUrl, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10, connection: {} });
  const supabaseUrl = Netlify.env.get('SUPABASE_URL');
  const anonKey = Netlify.env.get('SUPABASE_ANON_KEY');
  const identify = supabaseUrl && anonKey ? supabaseIdentity({ supabaseUrl, anonKey }) : async () => null;
  const authenticate = authenticatorFrom(identify, sql);

  // Provedor de pagamentos: por enquanto o simulado. O webhook só funciona com MOCK_WEBHOOK_SECRET definido.
  const paymentProvider = createMockProvider({ webhookSecret: Netlify.env.get('MOCK_WEBHOOK_SECRET') });

  const corsOrigins = (Netlify.env.get('CORS_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);

  cached = createApp({ sql, authenticate, identify, paymentProvider, corsOrigins, verifyPhotoUploads: true, dbConfig: true, devRoutes: Netlify.env.get('DEV_ROUTES') === 'true' });
  return cached;
}


const HINTS: Record<string, string> = {
  '28P01': 'Senha recusada pelo banco: a senha da DATABASE_URL não é a senha atual do banco.',
  '28000': 'Usuário ou senha recusados pelo banco.',
  XX000: 'Usuário não encontrado no pooler: use o usuário postgres.<código-do-projeto>.',
  ENOTFOUND: 'O endereço do servidor não foi encontrado: confira o host da string de conexão.',
  ENETUNREACH: 'Servidor inalcançável (provável conexão direta só IPv6): use o Transaction pooler, porta 6543.',
  ECONNREFUSED: 'Conexão recusada: confira host e porta.',
  ETIMEDOUT: 'Tempo esgotado ao conectar: confira host e porta.',
  CONNECT_TIMEOUT: 'Tempo esgotado ao conectar: confira host e porta.',
};

/** Diagnóstico seguro da conexão: nunca devolve senha, usuário completo nem endereço do servidor. */
async function diagnose(databaseUrl: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ok: true, configured: true };
  let u: URL;
  try {
    u = new URL(databaseUrl);
  } catch {
    return { ...out, url_valid: false, hint: 'A DATABASE_URL não é uma URL válida: confira espaços e caracteres especiais na senha (use só letras e números).' };
  }
  out.url_valid = true;
  out.port = u.port || '5432';
  out.host_kind = u.hostname.endsWith('.pooler.supabase.com')
    ? 'pooler'
    : u.hostname.startsWith('db.') && u.hostname.endsWith('.supabase.co')
      ? 'direct'
      : 'other';
  out.user_has_project_ref = decodeURIComponent(u.username).includes('.');
  out.password_present = u.password.length > 0;

  const sql = createSql(databaseUrl, { max: 1, prepare: false, connect_timeout: 8, idle_timeout: 2, connection: {} });
  try {
    await sql`select 1`;
    out.db = 'ok';
  } catch (e) {
    const err = e as { code?: string; name?: string };
    out.db = 'error';
    out.error_code = err.code ?? null;
    out.error_name = err.name ?? null;
    out.hint = (err.code && HINTS[err.code]) || 'Erro ao conectar ao banco; veja error_code.';
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
  return out;
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  if (pathname === '/health') {
    const databaseUrl = Netlify.env.get('DATABASE_URL');
    if (databaseUrl && url.searchParams.get('db') === '1') return json(200, await diagnose(databaseUrl));
    return json(200, { ok: true, configured: Boolean(databaseUrl) });
  }
  const app = getApp();
  if (!app) {
    return json(503, { error: { code: 'not_configured', message: 'A API ainda não está configurada (DATABASE_URL ausente).', details: {} } });
  }
  return app.fetch(req);
}

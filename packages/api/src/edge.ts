// @ts-nocheck
// Entrada para Supabase Edge Functions (Deno). Variáveis SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_DB_URL
// são injetadas pela plataforma. Publicar com: supabase functions deploy api
import { createApp } from './app.ts';
import { supabaseAuthenticator } from './auth.ts';
import { createSql } from './db.ts';

const sql = createSql(Deno.env.get('SUPABASE_DB_URL')!, { max: 3, prepare: false });
const authenticate = supabaseAuthenticator({
  supabaseUrl: Deno.env.get('SUPABASE_URL')!,
  anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
  sql,
});
const app = createApp({ sql, authenticate, devRoutes: Deno.env.get('DEV_ROUTES') === 'true' });

Deno.serve((req: Request) => {
  const url = new URL(req.url);
  url.pathname = url.pathname.replace(/^\/(functions\/v1\/)?api/, '') || '/';
  return app.fetch(new Request(url, req));
});

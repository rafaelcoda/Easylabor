// Entrada para Node (desenvolvimento e hospedagem tradicional).
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { supabaseAuthenticator } from './auth';
import { createSql } from './db';

const env = process.env;
const databaseUrl = env.DATABASE_URL;
if (!databaseUrl) throw new Error('Defina DATABASE_URL');
const sql = createSql(databaseUrl);

const authenticate =
  env.SUPABASE_URL && env.SUPABASE_ANON_KEY
    ? supabaseAuthenticator({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, sql })
    : async () => null;

const app = createApp({ sql, authenticate, devRoutes: env.DEV_ROUTES === 'true' });
const port = Number(env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`API em http://localhost:${port}`);

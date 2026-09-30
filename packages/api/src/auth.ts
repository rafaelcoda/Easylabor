import type { Sql } from './db';
import type { Authenticate } from './types';

/**
 * Valida o token do Supabase Auth e carrega o perfil em public.users.
 * Premissa: users.id é igual ao id do usuário no Supabase Auth.
 */
export function supabaseAuthenticator(opts: { supabaseUrl: string; anonKey: string; sql: Sql }): Authenticate {
  return async (req) => {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return null;
    const res = await fetch(`${opts.supabaseUrl}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: opts.anonKey },
    });
    if (!res.ok) return null;
    const authUser = (await res.json()) as { id?: string };
    if (!authUser.id) return null;
    const rows = await opts.sql`SELECT id, role, status FROM users WHERE id = ${authUser.id}`;
    const u = rows[0];
    if (!u || u.status !== 'active') return null;
    return { id: u.id as string, role: u.role as 'client' | 'professional' | 'admin' };
  };
}

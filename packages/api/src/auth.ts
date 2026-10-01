import type { Sql } from './db';
import { ApiError } from './errors';
import type { Authenticate, Identify } from './types';

/**
 * Identidade pelo Supabase Auth: valida o token no endpoint /auth/v1/user.
 * O telefone vem do login por SMS (ou dos números de teste do projeto).
 */
export function supabaseIdentity(opts: { supabaseUrl: string; anonKey: string }): Identify {
  return async (req) => {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return null;
    let res: Response;
    try {
      res = await fetch(`${opts.supabaseUrl}/auth/v1/user`, {
        headers: { authorization: `Bearer ${token}`, apikey: opts.anonKey },
      });
    } catch {
      throw new ApiError(503, 'auth_unavailable', 'Não foi possível validar o login agora. Tente novamente.');
    }
    if (res.status >= 500) throw new ApiError(503, 'auth_unavailable', 'Não foi possível validar o login agora. Tente novamente.');
    if (!res.ok) return null; // token inválido ou expirado
    const u = (await res.json()) as { id?: string; phone?: string };
    if (!u.id) return null;
    return { id: u.id, phone: u.phone ?? null };
  };
}

/**
 * Usuário cadastrado e ativo. Premissa: users.id é igual ao id do usuário no Supabase Auth
 * (o cadastro em POST /v1/me/register grava esse id).
 */
export function authenticatorFrom(identify: Identify, sql: Sql): Authenticate {
  return async (req) => {
    const identity = await identify(req);
    if (!identity) return null;
    const rows = await sql`SELECT id, role, status FROM users WHERE id = ${identity.id}`;
    const u = rows[0];
    if (!u || u.status !== 'active') return null;
    return { id: u.id as string, role: u.role as 'client' | 'professional' | 'admin' };
  };
}

/** Atalho: identidade + usuário cadastrado pelo Supabase Auth. */
export function supabaseAuthenticator(opts: { supabaseUrl: string; anonKey: string; sql: Sql }): Authenticate {
  return authenticatorFrom(supabaseIdentity(opts), opts.sql);
}

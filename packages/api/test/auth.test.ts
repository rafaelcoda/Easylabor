import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabaseIdentity } from '../src/auth';
import { ApiError } from '../src/errors';

const opts = { supabaseUrl: 'https://x.supabase.co', anonKey: 'chave-publica' };
const req = (token?: string) => new Request('http://api/v1/me', { headers: token ? { authorization: `Bearer ${token}` } : {} });

afterEach(() => vi.unstubAllGlobals());

describe('identidade pelo Supabase Auth', () => {
  it('sem cabeçalho de autorização não há identidade', async () => {
    expect(await supabaseIdentity(opts)(req())).toBeNull();
  });

  it('devolve id e telefone quando o Supabase valida o token', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'u-1', phone: '5527999990001' }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(await supabaseIdentity(opts)(req('tok'))).toEqual({ id: 'u-1', phone: '5527999990001' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x.supabase.co/auth/v1/user');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect((init.headers as Record<string, string>).apikey).toBe('chave-publica');
  });

  it('token inválido ou expirado vira "sem identidade" (401 na API)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    expect(await supabaseIdentity(opts)(req('ruim'))).toBeNull();
  });

  it('falha ou erro 5xx do Supabase vira 503, não 500 nem logout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede'); }));
    await expect(supabaseIdentity(opts)(req('tok'))).rejects.toMatchObject({ status: 503, code: 'auth_unavailable' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 502 })));
    const err = await supabaseIdentity(opts)(req('tok')).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
  });
});

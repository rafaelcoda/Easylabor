import { describe, expect, it, vi } from 'vitest';
import { Easy365Error, createEasy365Client, easy365FromEnv, extractPage } from '../src/integrations/easy365';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const NOW = new Date('2026-10-20T09:00:00Z');
const LOGIN_OK = (token = 'tok-1', expires = '2026-10-20T10:00:00Z') => json(200, { accessToken: token, accessTokenExpiresAt: expires, refreshToken: 'r', userData: {} });

function make(handler: (url: string, init: RequestInit) => Response | Promise<Response>, extra: Record<string, unknown> = {}) {
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init ?? {}));
  const client = createEasy365Client({ baseUrl: 'https://api.test/', clientId: 'svc-eco', clientSecret: 's3cr3t-value', fetch: f as unknown as typeof fetch, now: () => NOW, ...extra });
  return { f, client };
}
const headersOf = (f: ReturnType<typeof make>['f'], i: number) => (f.mock.calls[i]![1]!.headers ?? {}) as Record<string, string>;

describe('cliente Easy365: autenticação', () => {
  it('entra com id e segredo, envia o Bearer e reaproveita o token enquanto vale', async () => {
    const { f, client } = make((url) => (url.endsWith('/auth/login') ? LOGIN_OK() : json(200, [{ id: 'a' }])));
    await client.listCollaborators({ limit: 100 });
    await client.listCollaborators({ limit: 100, cursor: 'c2' });
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(['https://api.test/auth/login', 'https://api.test/collaborators?limit=100', 'https://api.test/collaborators?limit=100&cursor=c2']);
    expect(JSON.parse(f.mock.calls[0]![1]!.body as string)).toEqual({ id: 'svc-eco', secret: 's3cr3t-value' });
    expect(headersOf(f, 1).authorization).toBe('Bearer tok-1');
    expect(headersOf(f, 2).authorization).toBe('Bearer tok-1'); // sem novo login
  });

  it('token perto de vencer ou recusado (401) faz novo login uma vez', async () => {
    let n = 0;
    const { f, client } = make((url, init) => {
      if (url.endsWith('/auth/login')) return LOGIN_OK(`tok-${++n}`);
      return (init.headers as Record<string, string>).authorization === 'Bearer tok-2' ? json(200, []) : json(401, { error: 'expirado' });
    });
    await expect(client.listCollaborators({ limit: 10 })).resolves.toMatchObject({ items: [] });
    expect(f.mock.calls.filter((c) => String(c[0]).endsWith('/auth/login'))).toHaveLength(2);
    // segundo 401 seguido: desiste com erro claro, sem ficar em laço
    const bad = make((url) => (url.endsWith('/auth/login') ? LOGIN_OK() : json(401, {})));
    await expect(bad.client.listCollaborators({ limit: 10 })).rejects.toMatchObject({ status: 401 });
    expect(bad.f.mock.calls.filter((c) => String(c[0]).endsWith('/auth/login'))).toHaveLength(2);
  });

  it('renova o token quando a validade informada já passou', async () => {
    const { f, client } = make((url) => (url.endsWith('/auth/login') ? LOGIN_OK('tok', '2026-10-20T09:00:30Z') : json(200, []))); // vence em 30 s, menos a folga de 60 s
    await client.listCollaborators({ limit: 10 });
    await client.listCollaborators({ limit: 10 });
    expect(f.mock.calls.filter((c) => String(c[0]).endsWith('/auth/login'))).toHaveLength(2);
  });

  it('falha de login nunca vaza o segredo na mensagem', async () => {
    const { client } = make(() => json(401, { message: 'segredo s3cr3t-value inválido' }));
    const err = await client.listCollaborators({ limit: 10 }).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Easy365Error);
    expect((err as Easy365Error).status).toBe(401);
    expect(String((err as Error).message)).not.toContain('s3cr3t');
    expect((err as Error).message).toMatch(/Login na Easy365 recusado \(HTTP 401\)/);
    const noToken = make((url) => (url.endsWith('/auth/login') ? json(200, {}) : json(200, [])));
    await expect(noToken.client.listCollaborators({ limit: 10 })).rejects.toThrow(/não devolveu o token/);
  });

  it('com só a chave de API, envia X-Api-Key e não tenta login', async () => {
    const f = vi.fn(async () => json(200, []));
    const client = createEasy365Client({ baseUrl: 'https://api.test', apiKey: 'cred.abc', fetch: f as unknown as typeof fetch });
    await client.listCollaborators({ limit: 5 });
    expect(f).toHaveBeenCalledTimes(1);
    expect(((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>)['x-api-key']).toBe('cred.abc');
    const none = createEasy365Client({ baseUrl: 'https://api.test', fetch: f as unknown as typeof fetch });
    await expect(none.listCollaborators({ limit: 5 })).rejects.toThrow(/não configuradas/);
  });

  it('erros do servidor, rede e resposta que não é JSON viram mensagens claras', async () => {
    const e500 = make((url) => (url.endsWith('/auth/login') ? LOGIN_OK() : json(503, {})));
    await expect(e500.client.listCollaborators({ limit: 10 })).rejects.toThrow('A Easy365 respondeu HTTP 503 em /collaborators');
    const net = make((url) => { if (url.endsWith('/auth/login')) return LOGIN_OK(); throw new TypeError('fetch failed: ECONNRESET com s3cr3t-value'); });
    const err = (await net.client.listCollaborators({ limit: 10 }).catch((e) => e)) as Error;
    expect(err.message).toBe('Falha de rede ao chamar /collaborators?limit=10');
    const html = make((url) => (url.endsWith('/auth/login') ? LOGIN_OK() : new Response('<html>erro</html>', { status: 200 })));
    await expect(html.client.listCollaborators({ limit: 10 })).rejects.toThrow('não é JSON');
  });
});

describe('cliente Easy365: onde está a próxima página', () => {
  const h = (o: Record<string, string> = {}) => new Headers(o);
  it('cabeçalho X-Next-Cursor', () => {
    expect(extractPage([{ id: 1 }], h({ 'x-next-cursor': 'abc' }))).toEqual({ items: [{ id: 1 }], nextCursor: 'abc', pagination: 'cabeçalho x-next-cursor' });
  });
  it('cabeçalho Link com rel=next', () => {
    const r = extractPage([], h({ link: '<https://api.test/collaborators?limit=100&cursor=zzz>; rel="next", <https://x>; rel="prev"' }));
    expect(r.nextCursor).toBe('zzz');
    expect(r.pagination).toMatch(/Link/);
  });
  it('envelope no corpo: items/data e nextCursor/next_cursor/pagination.next', () => {
    expect(extractPage({ items: [1, 2], nextCursor: 'n1' }, h())).toMatchObject({ items: [1, 2], nextCursor: 'n1', pagination: 'campo nextCursor do corpo' });
    expect(extractPage({ data: [1], next_cursor: 'n2' }, h())).toMatchObject({ items: [1], nextCursor: 'n2' });
    expect(extractPage({ results: [1], pagination: { next: 'n3' } }, h())).toMatchObject({ nextCursor: 'n3', pagination: 'campo pagination.next do corpo' });
  });
  it('sem sinal: lista pura sem cursor, cursor vazio e corpo inesperado', () => {
    expect(extractPage([{ id: 1 }], h())).toEqual({ items: [{ id: 1 }], nextCursor: null, pagination: 'sem sinal de cursor' });
    expect(extractPage({ items: [], nextCursor: '' }, h()).nextCursor).toBeNull();
    expect(extractPage('texto', h()).items).toEqual([]);
    expect(extractPage(null, h()).items).toEqual([]);
  });
});

describe('configuração por variáveis de ambiente', () => {
  const env = (o: Record<string, string>) => (n: string) => o[n];
  it('só cria o cliente se houver credencial', () => {
    expect(easy365FromEnv(env({}))).toBeUndefined();
    expect(easy365FromEnv(env({ EASY365_CLIENT_ID: 'x' }))).toBeUndefined(); // faltou o segredo
    expect(easy365FromEnv(env({ EASY365_CLIENT_ID: 'x', EASY365_CLIENT_SECRET: 'y' }))).toBeDefined();
    expect(easy365FromEnv(env({ EASY365_API_KEY: 'k.z' }))).toBeDefined();
  });
});

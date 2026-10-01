/**
 * Cliente da API Easy365 (colaboradores vindos do Protheus).
 *
 * Autenticação: as rotas de colaboradores usam Bearer (JWT). O token vem de `POST /auth/login` com `{ id, secret }` e expira,
 * então o cliente faz o login sozinho, guarda o token enquanto vale e entra de novo se receber 401.
 * Se só houver uma chave de API (`X-Api-Key`), ela é enviada no lugar do Bearer.
 *
 * Paginação: a documentação fala em "cursor" mas não diz onde a próxima página é informada. O cliente procura em
 * cabeçalhos, no cabeçalho Link e em campos do corpo, e devolve como encontrou (`pagination`) para ficar registrado.
 */

export interface Easy365Options {
  baseUrl: string;
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export interface CollaboratorPage {
  items: unknown[];
  nextCursor: string | null;
  /** Como o cursor foi identificado (ou "sem sinal de cursor"). */
  pagination: string;
}

export interface Easy365Client {
  listCollaborators(p: { cursor?: string | null; limit: number }): Promise<CollaboratorPage>;
}

/** Erro da integração. A mensagem nunca contém credenciais. */
export class Easy365Error extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'Easy365Error';
  }
}

const CURSOR_HEADERS = ['x-next-cursor', 'x-cursor', 'next-cursor', 'x-pagination-cursor', 'x-next-page-token'];
const ITEM_FIELDS = ['items', 'data', 'results', 'collaborators'];
const CURSOR_FIELDS = ['nextCursor', 'next_cursor', 'cursor', 'next'];

const asCursor = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

/** Extrai a lista e o cursor da próxima página de uma resposta. */
export function extractPage(body: unknown, headers: Pick<Headers, 'get'>): CollaboratorPage {
  let items: unknown[] = [];
  let envelope: Record<string, unknown> | null = null;
  if (Array.isArray(body)) items = body;
  else if (body && typeof body === 'object') {
    envelope = body as Record<string, unknown>;
    const key = ITEM_FIELDS.find((k) => Array.isArray(envelope![k]));
    if (key) items = envelope[key] as unknown[];
  }

  for (const h of CURSOR_HEADERS) {
    const v = asCursor(headers.get(h));
    if (v) return { items, nextCursor: v, pagination: `cabeçalho ${h}` };
  }
  const link = headers.get('link');
  if (link) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(link);
    if (m) {
      try {
        const c = asCursor(new URL(m[1]!, 'https://x.invalid').searchParams.get('cursor'));
        if (c) return { items, nextCursor: c, pagination: 'cabeçalho Link (rel=next)' };
      } catch { /* link malformado: segue procurando */ }
    }
  }
  if (envelope) {
    for (const f of CURSOR_FIELDS) {
      const v = asCursor(envelope[f]);
      if (v) return { items, nextCursor: v, pagination: `campo ${f} do corpo` };
    }
    const nested = envelope.pagination;
    if (nested && typeof nested === 'object') {
      for (const f of CURSOR_FIELDS) {
        const v = asCursor((nested as Record<string, unknown>)[f]);
        if (v) return { items, nextCursor: v, pagination: `campo pagination.${f} do corpo` };
      }
    }
  }
  return { items, nextCursor: null, pagination: 'sem sinal de cursor' };
}

export function createEasy365Client(opts: Easy365Options): Easy365Client {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  const timeoutMs = opts.timeoutMs ?? 8000;
  let token: { value: string; expiresAt: number } | null = null;

  async function send(path: string, init: RequestInit): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await doFetch(`${base}${path}`, { ...init, signal: ctl.signal });
    } catch (e) {
      throw new Easy365Error(ctl.signal.aborted ? `Tempo esgotado ao chamar ${path}` : `Falha de rede ao chamar ${path}`, undefined);
    } finally {
      clearTimeout(timer);
    }
  }

  async function login(): Promise<string> {
    if (!opts.clientId || !opts.clientSecret) throw new Easy365Error('Credenciais da Easy365 não configuradas');
    const res = await send('/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ id: opts.clientId, secret: opts.clientSecret }),
    });
    if (!res.ok) throw new Easy365Error(`Login na Easy365 recusado (HTTP ${res.status})`, res.status);
    const body = (await res.json().catch(() => null)) as { accessToken?: string; accessTokenExpiresAt?: string } | null;
    if (!body?.accessToken) throw new Easy365Error('Login na Easy365 não devolveu o token de acesso');
    const exp = body.accessTokenExpiresAt ? Date.parse(body.accessTokenExpiresAt) : NaN;
    token = { value: body.accessToken, expiresAt: Number.isFinite(exp) ? exp - 60_000 : now().getTime() + 5 * 60_000 };
    return token.value;
  }

  async function authHeaders(): Promise<Record<string, string>> {
    if (opts.clientId && opts.clientSecret) {
      const t = token && token.expiresAt > now().getTime() ? token.value : await login();
      return { authorization: `Bearer ${t}` };
    }
    if (opts.apiKey) return { 'x-api-key': opts.apiKey };
    throw new Easy365Error('Credenciais da Easy365 não configuradas');
  }

  async function get(path: string, retried = false): Promise<Response> {
    const res = await send(path, { method: 'GET', headers: { accept: 'application/json', ...(await authHeaders()) } });
    if (res.status === 401 && !retried && opts.clientId && opts.clientSecret) {
      token = null; // token recusado: entra de novo uma vez
      return get(path, true);
    }
    return res;
  }

  return {
    async listCollaborators({ cursor, limit }) {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (cursor) qs.set('cursor', cursor);
      const res = await get(`/collaborators?${qs}`);
      if (!res.ok) throw new Easy365Error(`A Easy365 respondeu HTTP ${res.status} em /collaborators`, res.status);
      const body = await res.json().catch(() => { throw new Easy365Error('A Easy365 devolveu uma resposta que não é JSON'); });
      return extractPage(body, res.headers);
    },
  };
}

/**
 * Monta o cliente a partir das variáveis de ambiente do Netlify. Devolve undefined se a integração não estiver configurada.
 *   EASY365_CLIENT_ID e EASY365_CLIENT_SECRET (login que gera o Bearer) ou EASY365_API_KEY; EASY365_API_URL é opcional.
 */
export function easy365FromEnv(get: (name: string) => string | undefined): Easy365Client | undefined {
  const clientId = get('EASY365_CLIENT_ID');
  const clientSecret = get('EASY365_CLIENT_SECRET');
  const apiKey = get('EASY365_API_KEY');
  if (!(clientId && clientSecret) && !apiKey) return undefined;
  return createEasy365Client({ baseUrl: get('EASY365_API_URL') || 'https://easy365-api.fly.dev', clientId, clientSecret, apiKey });
}

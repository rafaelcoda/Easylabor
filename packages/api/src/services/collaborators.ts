import { inTransaction, type Sql } from '../db';
import { conflict, notFound, unprocessable } from '../errors';
import { Easy365Error, type Easy365Client } from '../integrations/easy365';
import type { AuthUser, Ctx } from '../types';
import { spToday } from './accounts';
import { audit } from './manage';
import { brPhone } from './team';

const SOURCE = 'easy365_collaborators';
const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const STEP_BUDGET_MS = 20_000; // a função agendada do Netlify tem 30 s
const STALE_MS = 10 * 60_000;
const RETRY_AFTER_ERROR_MS = 15 * 60_000;
const MAX_ATTEMPTS_PER_DAY = 5;
/** Situações em que a pessoa não faz mais parte do quadro. */
const LEFT_STATUSES = ['FIRED', 'INACTIVE'];
const START_HOUR_SP = 3; // a carga diária começa depois das 03h (São Paulo)

// ------------------------------------------------------------------ mapeamento
const KNOWN = new Set([
  'id', 'register', 'name', 'status', 'contract', 'managedContracts', 'role', 'position', 'workShift', 'degree', 'hiredAt', 'hiredType', 'firedAt', 'firedType',
  'parentId', 'nextiPersonIds', 'medicalRecord', 'medicalRecordUpdatedAt', 'createdAt', 'updatedAt', 'wageInCents',
]);

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

/** Aceita AAAA-MM-DD (com ou sem hora), AAAAMMDD e DD/MM/AAAA. Datas vazias ou "zeradas" viram null. */
export function parseDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  const parts = iso ? [iso[1], iso[2], iso[3]] : br ? [br[3], br[2], br[1]] : null;
  if (!parts) return null;
  const [y, m, d] = parts as [string, string, string];
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== Number(m) - 1 || dt.getUTCDate() !== Number(d) || Number(y) < 1900) return null;
  return `${y}-${m}-${d}`;
}

function parseTs(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) && new Date(t).getUTCFullYear() >= 1990 ? new Date(t).toISOString() : null;
}

const sortKeys = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

export interface MappedCollaborator {
  row: Record<string, string | number | null | unknown[] | Record<string, unknown>>;
  priv: { wage_cents: number | null; medical_record: string | null };
  hash: string;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Converte um item da API no formato da tabela. Devolve null se faltar id ou nome. */
export async function mapCollaborator(raw: unknown): Promise<MappedCollaborator | null> {
  const r = obj(raw);
  const id = str(r.id);
  const name = str(r.name);
  if (!id || !name) return null;
  const contract = obj(r.contract), role = obj(r.role), position = obj(r.position), shift = obj(r.workShift);
  const managed = (Array.isArray(r.managedContracts) ? r.managedContracts : []).map(obj).map((c) => ({
    id: str(c.id), name: str(c.name), branch: str(c.branch), companyId: str(c.companyId),
  }));
  const nexti = (Array.isArray(r.nextiPersonIds) ? r.nextiPersonIds : []).map(Number).filter((n) => Number.isInteger(n));
  const extra: Record<string, unknown> = {};
  for (const k of Object.keys(r)) if (!KNOWN.has(k)) extra[k] = r[k];
  const wage = typeof r.wageInCents === 'number' && Number.isFinite(r.wageInCents) ? Math.round(r.wageInCents) : null;
  const row = {
    external_id: id, register: str(r.register), name, status: str(r.status) ?? 'UNKNOWN',
    contract_id: str(contract.id), contract_name: str(contract.name), contract_branch: str(contract.branch), contract_company_id: str(contract.companyId),
    managed_contracts: managed,
    role_id: str(role.id), role_title: str(role.title), position_id: str(position.id), position_title: str(position.title),
    work_shift_id: str(shift.id), work_shift_label: str(shift.label), work_shift_notation_rule: str(shift.notationRule), work_shift_sequence: str(shift.sequence),
    degree: str(r.degree), hired_at: str(r.hiredAt), hired_type: str(r.hiredType), fired_at: str(r.firedAt), fired_type: str(r.firedType),
    hired_on: parseDate(r.hiredAt), fired_on: parseDate(r.firedAt),
    parent_external_id: str(r.parentId), nexti_person_ids: nexti,
    medical_record_updated_at: parseTs(r.medicalRecordUpdatedAt), source_created_at: parseTs(r.createdAt), source_updated_at: parseTs(r.updatedAt),
    extra: sortKeys(extra),
  };
  const priv = { wage_cents: wage, medical_record: str(r.medicalRecord) };
  return { row, priv, hash: await sha256(JSON.stringify([row, priv])) };
}

// ------------------------------------------------------------------ gravação de uma página
const TEXT_COLS = [
  'external_id', 'register', 'name', 'status', 'contract_id', 'contract_name', 'contract_branch', 'contract_company_id', 'role_id', 'role_title',
  'position_id', 'position_title', 'work_shift_id', 'work_shift_label', 'work_shift_notation_rule', 'work_shift_sequence', 'degree',
  'hired_at', 'hired_type', 'fired_at', 'fired_type', 'parent_external_id', 'payload_hash',
];
const JSON_COLS = ['managed_contracts', 'nexti_person_ids', 'extra'];
const DATE_COLS = ['hired_on', 'fired_on'];
const TS_COLS = ['medical_record_updated_at', 'source_created_at', 'source_updated_at'];
const ALL_COLS = [...TEXT_COLS, ...JSON_COLS, ...DATE_COLS, ...TS_COLS];
// Listas fixas e internas (nunca vêm de entrada externa), por isso podem entrar como texto no SQL.
const RECORD_DEFS = [...TEXT_COLS.map((c) => `${c} text`), ...JSON_COLS.map((c) => `${c} jsonb`), ...[...DATE_COLS, ...TS_COLS].map((c) => `${c} text`)].join(', ');
const SELECT_EXPR = ALL_COLS.map((c) => {
  if (c === 'managed_contracts' || c === 'extra') return `COALESCE(r.${c}, ${c === 'extra' ? "'{}'" : "'[]'"}::jsonb)`;
  if (c === 'nexti_person_ids') return "ARRAY(SELECT jsonb_array_elements_text(COALESCE(r.nexti_person_ids, '[]'::jsonb))::int)";
  if (DATE_COLS.includes(c)) return `r.${c}::date`;
  if (TS_COLS.includes(c)) return `r.${c}::timestamptz`;
  return `r.${c}`;
}).join(', ');
const UPDATE_SET = ALL_COLS.filter((c) => c !== 'external_id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');

interface PageResult { created: number; updated: number; unchanged: number; skipped: number }

async function writePage(ctx: Ctx, runId: string, items: unknown[]): Promise<PageResult> {
  const mapped = (await Promise.all(items.map(mapCollaborator))).filter((m): m is MappedCollaborator => m !== null);
  // Se o mesmo id vier duas vezes na página, vale o último.
  const byId = new Map(mapped.map((m) => [m.row.external_id as string, m]));
  const list = [...byId.values()];
  const skipped = items.length - mapped.length;
  if (list.length === 0) return { created: 0, updated: 0, unchanged: 0, skipped };
  const ids = list.map((m) => m.row.external_id as string);
  const nowIso = ctx.now().toISOString();
  return inTransaction(ctx.sql, async (tx) => {
    const existing = new Map((await tx`SELECT external_id, payload_hash FROM collaborators WHERE external_id = ANY(${ids})`).map((r) => [r.external_id as string, r.payload_hash as string]));
    const write = list.filter((m) => existing.get(m.row.external_id as string) !== m.hash);
    if (write.length > 0) {
      const rows = write.map((m) => ({ ...m.row, payload_hash: m.hash }));
      await tx`
        INSERT INTO collaborators (${tx.unsafe(ALL_COLS.join(', '))}, synced_at)
        SELECT ${tx.unsafe(SELECT_EXPR)}, ${nowIso}::timestamptz
        FROM jsonb_to_recordset(${tx.json(rows as never)}::jsonb) AS r(${tx.unsafe(RECORD_DEFS)})
        ON CONFLICT (external_id) DO UPDATE SET ${tx.unsafe(UPDATE_SET)}, synced_at = EXCLUDED.synced_at`;
      const priv = write.map((m) => ({ external_id: m.row.external_id, ...m.priv }));
      await tx`
        INSERT INTO collaborator_private (collaborator_id, wage_cents, medical_record, updated_at)
        SELECT c.id, r.wage_cents, r.medical_record, ${nowIso}::timestamptz
        FROM jsonb_to_recordset(${tx.json(priv as never)}::jsonb) AS r(external_id text, wage_cents bigint, medical_record text)
        JOIN collaborators c ON c.external_id = r.external_id
        ON CONFLICT (collaborator_id) DO UPDATE SET wage_cents = EXCLUDED.wage_cents, medical_record = EXCLUDED.medical_record, updated_at = EXCLUDED.updated_at`;
    }
    await tx`
      UPDATE collaborators SET last_seen_at = ${nowIso}::timestamptz, last_seen_run = ${runId}, missing_since = NULL
      WHERE external_id = ANY(${ids})`;
    const created = write.filter((m) => !existing.has(m.row.external_id as string)).length;
    return { created, updated: write.length - created, unchanged: list.length - write.length, skipped };
  });
}

// ------------------------------------------------------------------ execução de uma carga
interface Run {
  id: string; status: string; cursor: string | null; attempt: number; fetched: number; run_date: string;
}

export interface StepOutcome { status: 'ok' | 'partial' | 'error' | 'skipped'; message?: string }

/** Executa (ou continua) uma carga dentro de um limite de tempo. Se não der para terminar, deixa "parcial" com o cursor salvo. */
export async function runSyncStep(ctx: Ctx, client: Easy365Client, runId: string, opts: { budgetMs?: number; pageSize?: number } = {}): Promise<StepOutcome> {
  const budget = opts.budgetMs ?? STEP_BUDGET_MS;
  const limit = opts.pageSize ?? PAGE_SIZE;
  const startedAt = Date.now();
  const nowIso = () => ctx.now().toISOString();

  const claimed = (await ctx.sql`
    UPDATE sync_runs SET status = 'running', attempt = attempt + 1, started_at = COALESCE(started_at, ${nowIso()}::timestamptz), updated_at = ${nowIso()}::timestamptz, error = NULL
    WHERE id = ${runId} AND status IN ('queued', 'partial')
    RETURNING id, status, cursor, attempt, fetched, run_date::text AS run_date`)[0] as Run | undefined;
  if (!claimed) return { status: 'skipped' };

  let cursor: string | null = claimed.cursor;
  const seenCursors = new Set<string>(cursor ? [cursor] : []);
  let pagination: string | null = null;
  let pages = 0;
  let sawCursor = Boolean(cursor); // a API já informou cursor nesta carga (ou ela está sendo retomada)
  try {
    for (;;) {
      if (pages > 0 && Date.now() - startedAt >= budget) {
        await ctx.sql`UPDATE sync_runs SET status = 'partial', cursor = ${cursor}, pagination = COALESCE(${pagination}, pagination), updated_at = ${nowIso()}::timestamptz WHERE id = ${runId}`;
        return { status: 'partial' };
      }
      if (pages >= MAX_PAGES) throw new Easy365Error(`Mais de ${MAX_PAGES} páginas: a carga foi interrompida por segurança`);
      const page = await client.listCollaborators({ cursor, limit });
      pagination = page.pagination;
      pages += 1;
      const r = await writePage(ctx, runId, page.items);
      const next = page.nextCursor;
      await ctx.sql`
        UPDATE sync_runs SET pages = pages + 1, fetched = fetched + ${page.items.length}, created = created + ${r.created}, updated = updated + ${r.updated}, unchanged = unchanged + ${r.unchanged},
               cursor = ${next}, pagination = ${pagination}, updated_at = ${nowIso()}::timestamptz
        WHERE id = ${runId}`;
      if (next) sawCursor = true;
      if (!next) {
        // Página cheia sem cursor, e a API nunca informou cursor: provavelmente há mais páginas que não conseguimos alcançar.
        if (page.items.length >= limit && !sawCursor) {
          throw new Easy365Error('A API devolveu uma página cheia e não informou o cursor da próxima. A carga parou para não ficar incompleta: confirme com a Easy365 onde vem o cursor.');
        }
        break;
      }
      if (seenCursors.has(next)) throw new Easy365Error('A API repetiu o mesmo cursor: a carga foi interrompida para não entrar em repetição');
      seenCursors.add(next);
      cursor = next;
    }
    return await finishRun(ctx, runId);
  } catch (e) {
    const message = (e instanceof Easy365Error ? e.message : `Erro inesperado na carga: ${e instanceof Error ? e.message : String(e)}`).slice(0, 400);
    await ctx.sql`UPDATE sync_runs SET status = 'error', error = ${message}, finished_at = ${nowIso()}::timestamptz, updated_at = ${nowIso()}::timestamptz WHERE id = ${runId}`;
    return { status: 'error', message };
  }
}

/** Fecha uma carga completa: marca quem deixou de vir na API, com uma trava contra resposta vazia ou muito menor que a anterior. */
async function finishRun(ctx: Ctx, runId: string): Promise<StepOutcome> {
  const nowIso = ctx.now().toISOString();
  const run = (await ctx.sql`SELECT fetched FROM sync_runs WHERE id = ${runId}`)[0]!;
  const known = (await ctx.sql`SELECT count(*)::int AS n FROM collaborators WHERE missing_since IS NULL AND last_seen_run IS DISTINCT FROM ${runId}`)[0]!.n as number;
  const seen = (await ctx.sql`SELECT count(*)::int AS n FROM collaborators WHERE last_seen_run = ${runId}`)[0]!.n as number;
  if (known > 0 && seen === 0) {
    const message = 'A API devolveu uma lista vazia. Nada foi marcado como ausente; confira a credencial e os contratos liberados para ela.';
    await ctx.sql`UPDATE sync_runs SET status = 'error', error = ${message}, finished_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz WHERE id = ${runId}`;
    return { status: 'error', message };
  }
  const total = known + seen;
  if (total >= 20 && seen < total * 0.5) {
    const message = `A API devolveu só ${seen} de ${total} colaboradores conhecidos (menos da metade). Nada foi marcado como ausente; confira se a credencial perdeu acesso a contratos.`;
    await ctx.sql`UPDATE sync_runs SET status = 'error', error = ${message}, finished_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz WHERE id = ${runId}`;
    return { status: 'error', message };
  }
  const gone = await ctx.sql`
    UPDATE collaborators SET missing_since = ${nowIso}::timestamptz
    WHERE missing_since IS NULL AND last_seen_run IS DISTINCT FROM ${runId} RETURNING 1`;
  await hideLeavers(ctx);
  await ctx.sql`UPDATE sync_runs SET status = 'ok', missing = ${gone.length}, cursor = NULL, finished_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz WHERE id = ${runId}`;
  void run;
  return { status: 'ok' };
}

/**
 * Profissional vinculado a um colaborador que foi desligado (ou saiu da base) deixa de aparecer na busca dos clientes.
 * A conta não é suspensa: a operação decide o que fazer, e pode exibi-lo de novo se for o caso.
 */
export async function hideLeavers(ctx: Ctx): Promise<number> {
  return inTransaction(ctx.sql, async (tx) => {
    const hidden = await tx`
      UPDATE professional_profiles p SET visible = false
      FROM collaborators c
      WHERE c.user_id = p.user_id AND p.visible AND (c.status = ANY(${LEFT_STATUSES}) OR c.missing_since IS NOT NULL)
      RETURNING p.user_id, c.id AS collaborator_id, c.name, c.status, c.missing_since`;
    for (const h of hidden) {
      await audit(tx, null, 'collaborator.auto_hidden', 'collaborators', h.collaborator_id as string, { visible: true },
        { visible: false, reason: h.missing_since ? 'Saiu da base do Protheus' : `Situação ${h.status} no Protheus`, name: h.name });
    }
    return hidden.length;
  });
}

// ------------------------------------------------------------------ agendamento
export type TickResult = 'idle' | 'not_configured' | 'waiting' | 'started' | 'continued' | 'ok' | 'partial' | 'error';

/**
 * Chamada a cada 5 minutos pela função agendada. Decide se há carga a fazer:
 *  - continua uma carga parcial ou atende um pedido manual;
 *  - senão, começa a carga do dia (depois das 03h de São Paulo) se ainda não houve uma bem-sucedida hoje,
 *    com no máximo 5 tentativas por dia e 15 minutos de espera depois de um erro.
 */
export async function collaboratorSyncTick(ctx: Ctx, opts: { budgetMs?: number; pageSize?: number } = {}): Promise<TickResult> {
  if (!ctx.easy365) return 'not_configured';
  const now = ctx.now();
  const today = spToday(ctx);
  const nowIso = now.toISOString();

  // Carga que travou (a função foi cortada no meio): vira erro, e a próxima tentativa recomeça.
  await ctx.sql`
    UPDATE sync_runs SET status = 'error', error = 'Interrompida: sem andamento por mais de 10 minutos', finished_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz
    WHERE source = ${SOURCE} AND status = 'running' AND updated_at < ${new Date(now.getTime() - STALE_MS).toISOString()}::timestamptz`;
  if ((await ctx.sql`SELECT 1 FROM sync_runs WHERE source = ${SOURCE} AND status = 'running'`)[0]) return 'waiting';

  let pending = (await ctx.sql`
    SELECT id, status FROM sync_runs WHERE source = ${SOURCE} AND status IN ('queued', 'partial') ORDER BY (status = 'queued') DESC, created_at LIMIT 1`)[0];
  let continued = Boolean(pending && pending.status === 'partial');

  if (!pending) {
    const hourSP = new Date(now.getTime() - 3 * 3_600_000).getUTCHours();
    if (hourSP < START_HOUR_SP) return 'idle';
    if ((await ctx.sql`SELECT 1 FROM sync_runs WHERE source = ${SOURCE} AND run_date = ${today}::date AND status = 'ok'`)[0]) return 'idle';
    const errors = await ctx.sql`
      SELECT finished_at FROM sync_runs WHERE source = ${SOURCE} AND run_date = ${today}::date AND status = 'error' ORDER BY finished_at DESC`;
    if (errors.length >= MAX_ATTEMPTS_PER_DAY) return 'idle';
    const lastErr = errors[0]?.finished_at as Date | undefined;
    if (lastErr && now.getTime() - lastErr.getTime() < RETRY_AFTER_ERROR_MS) return 'waiting';
    pending = (await ctx.sql`
      INSERT INTO sync_runs (source, trigger, status, run_date, created_at, updated_at)
      VALUES (${SOURCE}, 'schedule', 'queued', ${today}::date, ${nowIso}::timestamptz, ${nowIso}::timestamptz) RETURNING id, status`)[0];
    continued = false;
  }
  const out = await runSyncStep(ctx, ctx.easy365, pending!.id as string, opts);
  if (out.status === 'skipped') return 'waiting';
  if (out.status === 'ok') return 'ok';
  if (out.status === 'partial') return 'partial';
  return out.status === 'error' ? 'error' : continued ? 'continued' : 'started';
}

/** Pedido manual: entra na fila e é atendido na próxima rodada (até 5 minutos). */
export async function requestSync(ctx: Ctx, admin: AuthUser) {
  if (!ctx.easy365) throw unprocessable('not_configured', 'A integração com a Easy365 ainda não está configurada');
  return inTransaction(ctx.sql, async (tx) => {
    const active = (await tx`SELECT id, status FROM sync_runs WHERE source = ${SOURCE} AND status IN ('queued', 'running', 'partial') ORDER BY created_at DESC LIMIT 1`)[0];
    if (active) throw conflict('sync_in_progress', 'Já existe uma carga em andamento ou na fila', { id: active.id, status: active.status });
    const r = await tx`
      INSERT INTO sync_runs (source, trigger, status, run_date, requested_by, created_at, updated_at)
      VALUES (${SOURCE}, 'manual', 'queued', ${spToday(ctx)}::date, ${admin.id}, ${ctx.now().toISOString()}::timestamptz, ${ctx.now().toISOString()}::timestamptz) RETURNING id`;
    await audit(tx, admin.id, 'collaborators.sync_requested', 'sync_runs', r[0]!.id as string, null, null);
    return { id: r[0]!.id as string, status: 'queued' };
  });
}

export async function syncRuns(ctx: Ctx, limit = 10) {
  const rows = await ctx.sql`
    SELECT r.id, r.trigger, r.status, r.run_date::text AS run_date, r.attempt, r.pages, r.fetched, r.created, r.updated, r.unchanged, r.missing, r.pagination, r.error,
           r.created_at, r.started_at, r.finished_at, u.full_name AS requested_by_name
    FROM sync_runs r LEFT JOIN users u ON u.id = r.requested_by WHERE r.source = ${SOURCE} ORDER BY r.created_at DESC, r.id LIMIT ${limit}`;
  const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : ((d as string | null) ?? null));
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at), started_at: iso(r.started_at), finished_at: iso(r.finished_at) }));
}

// ------------------------------------------------------------------ consulta no painel
export interface CollaboratorFilter {
  q?: string;
  status?: string;
  contract?: string;
  view?: 'linked' | 'waiting' | 'unlinked' | 'missing';
}

const esc = (q: string) => q.replace(/[\\%_]/g, '\\$&');
const where = (sql: Sql, f: CollaboratorFilter) => sql`
  TRUE
  ${f.q ? sql`AND (c.name ILIKE ${'%' + esc(f.q) + '%'} OR c.register ILIKE ${'%' + esc(f.q) + '%'})` : sql``}
  ${f.status ? sql`AND c.status = ${f.status}` : sql``}
  ${f.contract ? sql`AND c.contract_id = ${f.contract}` : sql``}
  ${f.view === 'linked' ? sql`AND c.user_id IS NOT NULL` : f.view === 'waiting' ? sql`AND c.user_id IS NULL AND c.link_phone IS NOT NULL` : f.view === 'unlinked' ? sql`AND c.user_id IS NULL AND c.link_phone IS NULL` : f.view === 'missing' ? sql`AND c.missing_since IS NOT NULL` : sql``}`;

export async function adminCollaborators(ctx: Ctx, f: CollaboratorFilter, limit: number, offset: number) {
  const w = where(ctx.sql, f);
  const rows = await ctx.sql`
    SELECT c.id, c.external_id, c.register, c.name, c.status, c.contract_id, c.contract_name, c.contract_branch, c.role_title, c.position_title,
           c.work_shift_label, c.work_shift_notation_rule, c.degree, c.hired_at, c.hired_on::text AS hired_on, c.fired_on::text AS fired_on,
           c.missing_since, c.last_seen_at, c.user_id, c.link_phone, c.linked_at, u.full_name AS user_name
    FROM collaborators c LEFT JOIN users u ON u.id = c.user_id
    WHERE ${w} ORDER BY lower(c.name), c.id LIMIT ${limit} OFFSET ${offset}`;
  const total = (await ctx.sql`SELECT count(*)::int AS n FROM collaborators c WHERE ${w}`)[0]!.n as number;
  const s = (await ctx.sql`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'ACTIVE')::int AS active, count(*) FILTER (WHERE missing_since IS NOT NULL)::int AS missing,
           count(*) FILTER (WHERE user_id IS NOT NULL)::int AS linked, count(*) FILTER (WHERE user_id IS NULL AND link_phone IS NOT NULL)::int AS waiting
    FROM collaborators`)[0]!;
  const contracts = await ctx.sql`
    SELECT contract_id AS id, max(contract_name) AS name, count(*)::int AS count FROM collaborators WHERE contract_id IS NOT NULL GROUP BY contract_id ORDER BY count(*) DESC, contract_id LIMIT 100`;
  const statuses = await ctx.sql`SELECT status, count(*)::int AS count FROM collaborators GROUP BY status ORDER BY count(*) DESC`;
  const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : ((d as string | null) ?? null));
  const last = (await syncRuns(ctx, 1))[0] ?? null;
  return {
    total, summary: s, contracts, statuses,
    sync: { configured: Boolean(ctx.easy365), last },
    items: rows.map((r) => ({
      id: r.id, external_id: r.external_id, register: r.register, name: r.name, status: r.status,
      contract: { id: r.contract_id, name: r.contract_name, branch: r.contract_branch },
      role_title: r.role_title, position_title: r.position_title,
      work_shift: { label: r.work_shift_label, notation_rule: r.work_shift_notation_rule }, degree: r.degree,
      hired_at: r.hired_at, hired_on: r.hired_on, fired_on: r.fired_on,
      missing_since: iso(r.missing_since), last_seen_at: iso(r.last_seen_at),
      link: { state: r.user_id ? 'linked' : r.link_phone ? 'waiting' : 'none', phone: r.link_phone ?? null, user_id: r.user_id ?? null, user_name: r.user_name ?? null, linked_at: iso(r.linked_at) },
    })),
  };
}

// ------------------------------------------------------------------ vínculo com a conta do profissional
/**
 * A operação informa o celular da pessoa. Se já existe um profissional com esse celular, o vínculo é imediato;
 * senão fica aguardando: quando a pessoa se cadastrar como profissional com esse celular, o vínculo é feito sozinho.
 */
export async function linkCollaborator(ctx: Ctx, admin: AuthUser, id: string, rawPhone: string) {
  const phone = brPhone(rawPhone);
  if (!phone) throw unprocessable('phone_invalid', 'Informe um telefone válido, com DDD');
  return inTransaction(ctx.sql, async (tx) => {
    const c = (await tx`SELECT id, name, user_id, link_phone, status, missing_since FROM collaborators WHERE id = ${id} FOR UPDATE`)[0];
    if (!c) throw notFound('Colaborador');
    if (LEFT_STATUSES.includes(c.status as string) || c.missing_since) throw unprocessable('collaborator_left', 'Este colaborador foi desligado ou saiu da base do Protheus e não pode ser vinculado');
    if (c.user_id) throw conflict('already_linked', 'Este colaborador já está vinculado a uma conta. Desvincule antes de trocar.');
    const other = (await tx`SELECT name FROM collaborators WHERE link_phone = ${phone} AND id <> ${id}`)[0];
    if (other) throw conflict('phone_taken', `Este telefone já está reservado para ${other.name}`);
    const u = (await tx`SELECT id, role FROM users WHERE phone = ${phone}`)[0];
    if (u && u.role !== 'professional') throw conflict('phone_in_use', 'Este telefone pertence a uma conta que não é de profissional');
    if (u && (await tx`SELECT 1 FROM collaborators WHERE user_id = ${u.id}`)[0]) throw conflict('user_already_linked', 'Esta conta já está vinculada a outro colaborador');
    const nowIso = ctx.now().toISOString();
    await tx`
      UPDATE collaborators SET link_phone = ${u ? null : phone}, user_id = ${u ? u.id : null}, linked_at = ${u ? nowIso : null}::timestamptz WHERE id = ${id}`;
    await audit(tx, admin.id, 'collaborator.linked', 'collaborators', id, null, { name: c.name, phone: `…${phone.slice(-4)}`, state: u ? 'linked' : 'waiting' });
    return { id, state: u ? 'linked' : 'waiting', phone: u ? null : phone };
  });
}

export async function unlinkCollaborator(ctx: Ctx, admin: AuthUser, id: string) {
  await inTransaction(ctx.sql, async (tx) => {
    const c = (await tx`SELECT id, name, user_id, link_phone FROM collaborators WHERE id = ${id} FOR UPDATE`)[0];
    if (!c) throw notFound('Colaborador');
    if (!c.user_id && !c.link_phone) throw conflict('not_linked', 'Este colaborador não tem vínculo');
    await tx`UPDATE collaborators SET user_id = NULL, link_phone = NULL, linked_at = NULL WHERE id = ${id}`;
    await audit(tx, admin.id, 'collaborator.unlinked', 'collaborators', id, { name: c.name, state: c.user_id ? 'linked' : 'waiting' }, null);
  });
}


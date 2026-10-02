import type { Sql } from '../db';
import type { Ctx } from '../types';
import { esc, phoneDigits, proWhere, type ProFilter } from './manage';

/** Situações em que o colaborador não faz mais parte do quadro (não entra na base para convite). */
const LEFT = ['FIRED', 'INACTIVE'];
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : ((d as string | null) ?? null));
const num = (v: unknown) => Number(v ?? 0);

export interface PeopleFilter extends ProFilter {
  /** protheus = quem tem registro no Protheus; direct = cadastrou-se sozinho. */
  origin?: 'protheus' | 'direct';
  /** prereg = colaborador convidado que ainda não fez o 1º acesso; base = colaborador do Protheus ainda sem convite. */
  view?: 'prereg' | 'base';
}

/**
 * Lista única de profissionais. Mistura duas fontes numa só consulta (para paginar e contar certo):
 *  - contas de profissional (com ou sem registro no Protheus);
 *  - colaboradores do Protheus que ainda não têm conta: os convidados ("Aguardando 1º acesso") aparecem em "Todos";
 *    a base ainda sem convite só aparece no filtro `view = base`, para não afogar a lista (são centenas de pessoas).
 * Filtros que só fazem sentido para quem já tem conta (verificação, situação da conta, visibilidade, serviço) excluem os colaboradores.
 */
export async function adminPeople(ctx: Ctx, f: PeopleFilter, limit: number, offset: number) {
  const sql: Sql = ctx.sql;
  const accountFilter = Boolean(f.kyc || f.status || f.visible !== undefined || f.service);
  const withAccounts = f.view === undefined;
  const withCollaborators = !accountFilter && f.origin !== 'direct';
  const colCond = f.view === 'base'
    ? sql`c.link_phone IS NULL AND c.missing_since IS NULL AND NOT (c.status = ANY(${LEFT}))`
    : sql`c.link_phone IS NOT NULL`;
  const like = f.q ? '%' + esc(f.q) + '%' : null;
  const colSearch = like ? sql`AND (c.name ILIKE ${like} OR c.register ILIKE ${like} ${phoneDigits(f.q!) ? sql`OR c.link_phone LIKE ${'%' + phoneDigits(f.q!) + '%'}` : sql``})` : sql``;
  const origin = f.origin === 'protheus' ? sql`AND c.id IS NOT NULL` : f.origin === 'direct' ? sql`AND c.id IS NULL` : sql``;

  const people = sql`
    SELECT 'professional'::text AS kind, u.id::text AS id, u.full_name AS name, u.phone AS phone, u.status AS acct_status, u.created_at AS sort_at,
           p.user_id IS NOT NULL AS has_profile, p.kyc_status::text AS kyc_status, coalesce(p.visible, false) AS visible, p.radius_km AS radius_km, p.level::text AS level,
           coalesce(p.rating_avg, 0)::numeric AS rating_avg, coalesce(p.rating_count, 0)::int AS rating_count, coalesce(p.completed_count, 0)::int AS completed_count,
           coalesce(cardinality(p.weekly_days), 0)::int AS weekly_days,
           (SELECT coalesce(json_agg(json_build_object('category', cc.slug, 'rate_cents', o.daily_rate_cents) ORDER BY cc.name), '[]'::json)
              FROM service_offers o JOIN service_categories cc ON cc.id = o.category_id WHERE o.professional_id = u.id AND o.active) AS offers,
           (SELECT count(*)::int FROM strikes s WHERE s.user_id = u.id AND s.expires_at > now()) AS active_strikes,
           (SELECT count(*)::int FROM bookings b WHERE b.professional_id = u.id) AS bookings_total,
           c.id::text AS col_id, c.register AS col_register, c.contract_name AS col_contract, c.role_title AS col_role, c.position_title AS col_position,
           c.status AS col_status, c.hired_on::text AS col_hired_on, c.missing_since AS col_missing_since,
           CASE WHEN c.id IS NULL THEN 'none' ELSE 'linked' END AS link_state, NULL::text AS link_phone
    FROM users u LEFT JOIN professional_profiles p ON p.user_id = u.id LEFT JOIN collaborators c ON c.user_id = u.id
    WHERE ${withAccounts ? proWhere(sql, f) : sql`FALSE`} ${origin}
    UNION ALL
    SELECT 'collaborator', c.id::text, c.name, c.link_phone, 'active', c.first_seen_at,
           false, NULL::text, false, NULL::int, NULL::text, 0::numeric, 0, 0, 0, '[]'::json, 0, 0,
           c.id::text, c.register, c.contract_name, c.role_title, c.position_title, c.status, c.hired_on::text, c.missing_since,
           CASE WHEN c.link_phone IS NULL THEN 'none' ELSE 'waiting' END, c.link_phone
    FROM collaborators c
    WHERE c.user_id IS NULL AND ${withCollaborators ? colCond : sql`FALSE`} ${colSearch}`;

  const rows = await sql`SELECT * FROM (${people}) t ORDER BY sort_at DESC, id LIMIT ${limit} OFFSET ${offset}`;
  const total = (await sql`SELECT count(*)::int AS n FROM (${people}) t`)[0]!.n as number;

  const s = (await sql`
    SELECT count(*)::int AS pros,
           count(*) FILTER (WHERE p.user_id IS NULL AND u.status = 'active')::int AS incomplete,
           count(*) FILTER (WHERE p.kyc_status IN ('pending', 'in_review') AND u.status = 'active')::int AS pending,
           count(*) FILTER (WHERE p.kyc_status = 'approved' AND u.status = 'active')::int AS approved,
           count(*) FILTER (WHERE p.kyc_status = 'rejected' AND u.status = 'active')::int AS rejected,
           count(*) FILTER (WHERE u.status = 'suspended')::int AS suspended,
           count(*) FILTER (WHERE p.visible AND u.status = 'active')::int AS visible,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM collaborators c WHERE c.user_id = u.id))::int AS from_protheus
    FROM users u LEFT JOIN professional_profiles p ON p.user_id = u.id WHERE u.role = 'professional' AND u.status <> 'deleted'`)[0]!;
  const c = (await sql`
    SELECT count(*) FILTER (WHERE user_id IS NULL AND link_phone IS NOT NULL)::int AS prereg,
           count(*) FILTER (WHERE user_id IS NULL AND link_phone IS NULL AND missing_since IS NULL AND NOT (status = ANY(${LEFT})))::int AS base
    FROM collaborators`)[0]!;

  return {
    total,
    summary: {
      total: (s.pros as number) + (c.prereg as number), incomplete: s.incomplete, pending: s.pending, approved: s.approved, rejected: s.rejected,
      suspended: s.suspended, visible: s.visible, from_protheus: (s.from_protheus as number) + (c.prereg as number), prereg: c.prereg, base: c.base,
    },
    items: rows.map((r) => ({
      kind: r.kind as 'professional' | 'collaborator', id: r.id as string, full_name: r.name as string, phone: (r.phone as string | null) ?? null,
      status: r.acct_status as string, created_at: iso(r.sort_at),
      has_profile: r.has_profile as boolean, kyc_status: (r.kyc_status as string | null) ?? null, visible: r.visible as boolean, radius_km: (r.radius_km as number | null) ?? null,
      level: (r.level as string | null) ?? null, rating_avg: num(r.rating_avg), rating_count: num(r.rating_count), completed_count: num(r.completed_count),
      weekly_days: num(r.weekly_days), offers: r.offers as { category: string; rate_cents: number }[], active_strikes: r.active_strikes as number, bookings_total: r.bookings_total as number,
      is_collaborator: r.col_id !== null,
      collaborator: r.col_id === null ? null : {
        id: r.col_id as string, register: (r.col_register as string | null) ?? null, contract: (r.col_contract as string | null) ?? null, role: (r.col_role as string | null) ?? null,
        position: (r.col_position as string | null) ?? null, status: r.col_status as string, hired_on: (r.col_hired_on as string | null) ?? null,
        missing_since: iso(r.col_missing_since), link_state: r.link_state as 'none' | 'waiting' | 'linked', link_phone: (r.link_phone as string | null) ?? null,
      },
    })),
  };
}

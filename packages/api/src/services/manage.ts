import { DEFAULT_CONFIG } from '@diaria/core';
import { inTransaction, type Sql } from '../db';
import { ApiError, conflict, forbidden, notFound, unprocessable } from '../errors';
import type { AuthUser, Ctx } from '../types';
import { spToday } from './accounts';
import { SETTINGS, applySettings, invalidateConfig, loadConfig, settingByKey } from './settings';

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : ((d as string | null) ?? null));
const esc = (q: string) => q.replace(/[\\%_]/g, '\\$&');
const digits = (q: string) => q.replace(/\D/g, '');
const num = (v: unknown) => Number(v ?? 0);
/** Identificador fixo das mudanças de parâmetros no registro de auditoria. */
const CONFIG_ENTITY = '00000000-0000-0000-0000-000000000000';
const DONE = ['completed', 'approved', 'paid'];
const LOST = ['cancelled_by_client', 'cancelled_by_professional', 'no_show_professional', 'no_show_client', 'declined', 'expired'];

/** Mostra só o começo e o fim da chave Pix. */
export const maskPix = (k: string) => (k.length <= 4 ? '••••' : `${k.slice(0, 2)}•••${k.slice(-2)}`);
const maskDoc = (d: string | null) => (d ? `${d.slice(0, 2)}•••••••••${d.slice(-2)}` : null);

export async function audit(tx: Sql, actor: string | null, action: string, entity: string, id: string, before: unknown, after: unknown) {
  await tx`
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, before, after)
    VALUES (${actor}, ${action}, ${entity}, ${id}, ${before ? tx.json(before as never) : null}, ${after ? tx.json(after as never) : null})`;
}

// ------------------------------------------------------------------ profissionais
export interface ProFilter {
  q?: string;
  kyc?: 'incomplete' | 'pending' | 'approved' | 'rejected';
  status?: 'active' | 'suspended' | 'deleted';
  visible?: boolean;
  service?: string;
}

const proWhere = (sql: Sql, f: ProFilter) => sql`
  u.role = 'professional' AND u.status ${f.status ? sql`= ${f.status}` : sql`<> 'deleted'`}
  ${f.q ? sql`AND (u.full_name ILIKE ${'%' + esc(f.q) + '%'} OR (${digits(f.q)}::text <> '' AND u.phone LIKE ${'%' + digits(f.q) + '%'}))` : sql``}
  ${f.kyc === 'incomplete' ? sql`AND p.user_id IS NULL` : f.kyc === 'pending' ? sql`AND p.kyc_status IN ('pending', 'in_review')` : f.kyc ? sql`AND p.kyc_status = ${f.kyc}` : sql``}
  ${f.visible !== undefined ? sql`AND p.visible = ${f.visible}` : sql``}
  ${f.service ? sql`AND EXISTS (SELECT 1 FROM service_offers o JOIN service_categories c ON c.id = o.category_id WHERE o.professional_id = u.id AND o.active AND c.slug = ${f.service})` : sql``}`;

export async function adminProfessionals(ctx: Ctx, f: ProFilter, limit: number, offset: number) {
  const where = proWhere(ctx.sql, f);
  const rows = await ctx.sql`
    SELECT u.id, u.full_name, u.phone, u.status, u.created_at,
           p.user_id IS NOT NULL AS has_profile, p.kyc_status, p.visible, p.radius_km, p.level, p.rating_avg, p.rating_count, p.completed_count,
           cardinality(p.weekly_days) AS weekly_days,
           (SELECT coalesce(json_agg(json_build_object('category', c.slug, 'rate_cents', o.daily_rate_cents) ORDER BY c.name), '[]'::json)
              FROM service_offers o JOIN service_categories c ON c.id = o.category_id WHERE o.professional_id = u.id AND o.active) AS offers,
           (SELECT count(*)::int FROM strikes s WHERE s.user_id = u.id AND s.expires_at > now()) AS active_strikes,
           (SELECT count(*)::int FROM bookings b WHERE b.professional_id = u.id) AS bookings_total
    FROM users u LEFT JOIN professional_profiles p ON p.user_id = u.id
    WHERE ${where} ORDER BY u.created_at DESC, u.id LIMIT ${limit} OFFSET ${offset}`;
  const total = (await ctx.sql`SELECT count(*)::int AS n FROM users u LEFT JOIN professional_profiles p ON p.user_id = u.id WHERE ${where}`)[0]!.n as number;
  const s = (await ctx.sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE p.user_id IS NULL AND u.status = 'active')::int AS incomplete,
           count(*) FILTER (WHERE p.kyc_status IN ('pending', 'in_review') AND u.status = 'active')::int AS pending,
           count(*) FILTER (WHERE p.kyc_status = 'approved' AND u.status = 'active')::int AS approved,
           count(*) FILTER (WHERE p.kyc_status = 'rejected' AND u.status = 'active')::int AS rejected,
           count(*) FILTER (WHERE u.status = 'suspended')::int AS suspended,
           count(*) FILTER (WHERE p.visible AND u.status = 'active')::int AS visible
    FROM users u LEFT JOIN professional_profiles p ON p.user_id = u.id WHERE u.role = 'professional' AND u.status <> 'deleted'`)[0]!;
  return {
    total,
    summary: s,
    items: rows.map((r) => ({
      id: r.id, full_name: r.full_name, phone: r.phone, status: r.status, created_at: iso(r.created_at),
      has_profile: r.has_profile, kyc_status: r.kyc_status ?? null, visible: r.visible ?? false, radius_km: r.radius_km ?? null, level: r.level ?? null,
      rating_avg: num(r.rating_avg), rating_count: num(r.rating_count), completed_count: num(r.completed_count),
      weekly_days: num(r.weekly_days), offers: r.offers, active_strikes: r.active_strikes, bookings_total: r.bookings_total,
    })),
  };
}

export async function adminProfessionalDetail(ctx: Ctx, id: string) {
  const u = (await ctx.sql`SELECT id, full_name, phone, email, status, created_at, accepted_terms_version FROM users WHERE id = ${id} AND role = 'professional'`)[0];
  if (!u) throw notFound('Profissional');
  const p = (await ctx.sql`
    SELECT bio, radius_km, pix_key, ST_Y(base_location::geometry) AS lat, ST_X(base_location::geometry) AS lng, kyc_status, kyc_reason, visible, level,
           rating_avg, rating_count, completed_count, attendance_rate, acceptance_rate, weekly_days, weekly_start, weekly_end
    FROM professional_profiles WHERE user_id = ${id}`)[0];
  const offers = await ctx.sql`
    SELECT c.slug, c.name, o.daily_rate_cents FROM service_offers o JOIN service_categories c ON c.id = o.category_id
    WHERE o.professional_id = ${id} AND o.active ORDER BY c.name`;
  const strikes = await ctx.sql`
    SELECT s.kind, s.created_at, s.expires_at, b.code FROM strikes s LEFT JOIN bookings b ON b.id = s.booking_id
    WHERE s.user_id = ${id} ORDER BY s.created_at DESC LIMIT 20`;
  const bookings = await ctx.sql`
    SELECT b.id, b.code, b.status, c.slug AS category, b.starts_at, cu.full_name AS client_name, (b.daily_rate_cents + b.client_fee_cents) AS total_cents
    FROM bookings b JOIN service_categories c ON c.id = b.category_id JOIN users cu ON cu.id = b.client_id
    WHERE b.professional_id = ${id} ORDER BY b.starts_at DESC LIMIT 15`;
  const history = await adminAudit(ctx, { entityId: id, limit: 15 });
  return {
    user: { id: u.id, full_name: u.full_name, phone: u.phone, email: u.email, status: u.status, created_at: iso(u.created_at), terms_version: u.accepted_terms_version },
    profile: p ? {
      bio: p.bio, radius_km: p.radius_km, pix_key_masked: maskPix(String(p.pix_key)), lat: Number(p.lat), lng: Number(p.lng),
      kyc_status: p.kyc_status, kyc_reason: p.kyc_reason, visible: p.visible, level: p.level,
      rating_avg: num(p.rating_avg), rating_count: num(p.rating_count), completed_count: num(p.completed_count),
      attendance_rate: p.attendance_rate === null ? null : Number(p.attendance_rate), acceptance_rate: p.acceptance_rate === null ? null : Number(p.acceptance_rate),
    } : null,
    offers: offers.map((o) => ({ category: o.slug, name: o.name, daily_rate_cents: num(o.daily_rate_cents) })),
    weekly: { days: ((p?.weekly_days as number[] | undefined) ?? []).map(Number), start_time: p?.weekly_start ? String(p.weekly_start).slice(0, 5) : null, end_time: p?.weekly_end ? String(p.weekly_end).slice(0, 5) : null },
    strikes: strikes.map((s) => ({ kind: s.kind, created_at: iso(s.created_at), expires_at: iso(s.expires_at), active: new Date(s.expires_at as Date) > ctx.now(), booking_code: s.code ?? null })),
    bookings: bookings.map((b) => ({ id: b.id, code: b.code, status: b.status, category: b.category, starts_at: iso(b.starts_at), client_name: b.client_name, total_cents: num(b.total_cents) })),
    history,
  };
}

// ------------------------------------------------------------------ clientes
export interface ClientFilter {
  q?: string;
  status?: 'active' | 'suspended' | 'deleted';
}

const clientWhere = (sql: Sql, f: ClientFilter) => sql`
  u.role = 'client' AND u.status ${f.status ? sql`= ${f.status}` : sql`<> 'deleted'`}
  ${f.q ? sql`AND (u.full_name ILIKE ${'%' + esc(f.q) + '%'} OR (${digits(f.q)}::text <> '' AND u.phone LIKE ${'%' + digits(f.q) + '%'}) OR u.email ILIKE ${'%' + esc(f.q) + '%'})` : sql``}`;

export async function adminClients(ctx: Ctx, f: ClientFilter, limit: number, offset: number) {
  const where = clientWhere(ctx.sql, f);
  const rows = await ctx.sql`
    SELECT u.id, u.full_name, u.phone, u.email, u.status, u.created_at, cp.kind,
           (SELECT count(*)::int FROM addresses a WHERE a.client_id = u.id) AS addresses,
           (SELECT count(*)::int FROM bookings b WHERE b.client_id = u.id) AS bookings_total,
           (SELECT count(*)::int FROM bookings b WHERE b.client_id = u.id AND b.status = ANY(${DONE})) AS bookings_done,
           (SELECT count(*)::int FROM bookings b WHERE b.client_id = u.id AND b.status = ANY(${LOST})) AS bookings_lost,
           (SELECT coalesce(sum(b.daily_rate_cents + b.client_fee_cents), 0) FROM bookings b WHERE b.client_id = u.id AND b.status = ANY(${DONE})) AS spent_cents
    FROM users u LEFT JOIN client_profiles cp ON cp.user_id = u.id
    WHERE ${where} ORDER BY u.created_at DESC, u.id LIMIT ${limit} OFFSET ${offset}`;
  const total = (await ctx.sql`SELECT count(*)::int AS n FROM users u WHERE ${where}`)[0]!.n as number;
  const s = (await ctx.sql`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE u.status = 'active')::int AS active, count(*) FILTER (WHERE u.status = 'suspended')::int AS suspended,
           count(*) FILTER (WHERE cp.kind = 'company')::int AS companies
    FROM users u LEFT JOIN client_profiles cp ON cp.user_id = u.id WHERE u.role = 'client' AND u.status <> 'deleted'`)[0]!;
  return {
    total, summary: s,
    items: rows.map((r) => ({
      id: r.id, full_name: r.full_name, phone: r.phone, email: r.email, status: r.status, created_at: iso(r.created_at), kind: r.kind ?? null,
      addresses: r.addresses, bookings_total: r.bookings_total, bookings_done: r.bookings_done, bookings_lost: r.bookings_lost, spent_cents: num(r.spent_cents),
    })),
  };
}

export async function adminClientDetail(ctx: Ctx, id: string) {
  const u = (await ctx.sql`SELECT id, full_name, phone, email, status, created_at, accepted_terms_version FROM users WHERE id = ${id} AND role = 'client'`)[0];
  if (!u) throw notFound('Cliente');
  const cp = (await ctx.sql`SELECT kind, cnpj, legal_name FROM client_profiles WHERE user_id = ${id}`)[0];
  // Endereço completo não aparece aqui: só bairro e cidade.
  const addresses = await ctx.sql`SELECT label, district, city, state FROM addresses WHERE client_id = ${id} ORDER BY city, district`;
  const bookings = await ctx.sql`
    SELECT b.id, b.code, b.status, c.slug AS category, b.starts_at, pu.full_name AS professional_name, (b.daily_rate_cents + b.client_fee_cents) AS total_cents
    FROM bookings b JOIN service_categories c ON c.id = b.category_id JOIN users pu ON pu.id = b.professional_id
    WHERE b.client_id = ${id} ORDER BY b.starts_at DESC LIMIT 15`;
  const t = (await ctx.sql`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE status = ANY(${DONE}))::int AS done, count(*) FILTER (WHERE status = ANY(${LOST}))::int AS lost,
           coalesce(sum(daily_rate_cents + client_fee_cents) FILTER (WHERE status = ANY(${DONE})), 0) AS spent_cents
    FROM bookings WHERE client_id = ${id}`)[0]!;
  return {
    user: { id: u.id, full_name: u.full_name, phone: u.phone, email: u.email, status: u.status, created_at: iso(u.created_at), terms_version: u.accepted_terms_version },
    profile: cp ? { kind: cp.kind, cnpj_masked: maskDoc(cp.cnpj as string | null), legal_name: cp.legal_name } : null,
    addresses, totals: { bookings: t.total, done: t.done, lost: t.lost, spent_cents: num(t.spent_cents) },
    bookings: bookings.map((b) => ({ id: b.id, code: b.code, status: b.status, category: b.category, starts_at: iso(b.starts_at), professional_name: b.professional_name, total_cents: num(b.total_cents) })),
    history: await adminAudit(ctx, { entityId: id, limit: 15 }),
  };
}

// ------------------------------------------------------------------ ações sobre contas
/** Suspende ou reativa uma conta de cliente ou profissional. Fica registrado quem fez e por quê. */
export async function setUserStatus(ctx: Ctx, admin: AuthUser, targetId: string, action: 'suspend' | 'reactivate', reason?: string) {
  if (targetId === admin.id) throw forbidden('Você não pode alterar a sua própria conta');
  return inTransaction(ctx.sql, async (tx) => {
    const u = (await tx`SELECT id, role, status FROM users WHERE id = ${targetId} FOR UPDATE`)[0];
    if (!u) throw notFound('Usuário');
    if (u.role === 'admin') throw forbidden('Contas de administrador não são alteradas por aqui');
    const to = action === 'suspend' ? 'suspended' : 'active';
    if (action === 'suspend' && u.status !== 'active') throw conflict('invalid_state', 'Só é possível suspender uma conta ativa');
    if (action === 'reactivate' && u.status !== 'suspended') throw conflict('invalid_state', 'Só é possível reativar uma conta suspensa');
    await tx`UPDATE users SET status = ${to} WHERE id = ${targetId}`;
    // Suspenso some da busca. Na reativação ele continua oculto até o próprio profissional ficar disponível.
    if (action === 'suspend' && u.role === 'professional') await tx`UPDATE professional_profiles SET visible = false WHERE user_id = ${targetId}`;
    await audit(tx, admin.id, action === 'suspend' ? 'user.suspended' : 'user.reactivated', 'users', targetId, { status: u.status }, { status: to, reason: reason ?? null });
    return { id: targetId, status: to };
  });
}

/** Oculta ou volta a exibir um profissional aprovado na busca dos clientes. */
export async function setProfessionalVisible(ctx: Ctx, admin: AuthUser, id: string, visible: boolean, reason?: string) {
  return inTransaction(ctx.sql, async (tx) => {
    const p = (await tx`
      SELECT p.kyc_status, p.visible, u.status FROM professional_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ${id} FOR UPDATE OF p`)[0];
    if (!p) throw notFound('Profissional');
    if (p.status !== 'active') throw unprocessable('account_not_active', 'A conta não está ativa');
    if (visible && p.kyc_status !== 'approved') throw unprocessable('kyc_not_approved', 'Só é possível exibir profissionais aprovados');
    await tx`UPDATE professional_profiles SET visible = ${visible} WHERE user_id = ${id}`;
    await audit(tx, admin.id, visible ? 'professional.shown' : 'professional.hidden', 'professional_profiles', id, { visible: p.visible }, { visible, reason: reason ?? null });
    return { id, visible };
  });
}

// ------------------------------------------------------------------ plataforma: visão geral
export async function platformOverview(ctx: Ctx, days: number) {
  const today = spToday(ctx);
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const winStart = ctx.sql`(${from}::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'`;

  const users = (await ctx.sql`
    SELECT count(*) FILTER (WHERE role = 'client' AND status <> 'deleted')::int AS clients,
           count(*) FILTER (WHERE role = 'professional' AND status <> 'deleted')::int AS professionals,
           count(*) FILTER (WHERE role = 'admin')::int AS admins,
           count(*) FILTER (WHERE status = 'suspended')::int AS suspended
    FROM users`)[0]!;
  const pros = (await ctx.sql`
    SELECT count(*) FILTER (WHERE p.kyc_status = 'approved' AND u.status = 'active')::int AS approved,
           count(*) FILTER (WHERE p.kyc_status IN ('pending', 'in_review') AND u.status = 'active')::int AS pending,
           count(*) FILTER (WHERE p.visible AND u.status = 'active')::int AS visible
    FROM professional_profiles p JOIN users u ON u.id = p.user_id`)[0]!;
  const b = (await ctx.sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = ANY(${DONE}))::int AS done,
           count(*) FILTER (WHERE status = ANY(${LOST}))::int AS lost,
           coalesce(sum(daily_rate_cents + client_fee_cents) FILTER (WHERE status = ANY(${DONE})), 0) AS gmv_cents,
           coalesce(sum(client_fee_cents + commission_cents) FILTER (WHERE status = ANY(${DONE})), 0) AS revenue_cents
    FROM bookings WHERE created_at >= ${winStart}`)[0]!;
  const bookingSeries = await ctx.sql`
    SELECT d::date::text AS day, count(b.id)::int AS total, count(b.id) FILTER (WHERE b.status = ANY(${DONE}))::int AS done
    FROM generate_series(${from}::date, ${today}::date, interval '1 day') d
    LEFT JOIN bookings b ON (b.created_at AT TIME ZONE 'America/Sao_Paulo')::date = d::date
    GROUP BY d ORDER BY d`;
  const signupSeries = await ctx.sql`
    SELECT d::date::text AS day, count(u.id) FILTER (WHERE u.role = 'client')::int AS clients, count(u.id) FILTER (WHERE u.role = 'professional')::int AS professionals
    FROM generate_series(${from}::date, ${today}::date, interval '1 day') d
    LEFT JOIN users u ON (u.created_at AT TIME ZONE 'America/Sao_Paulo')::date = d::date AND u.role IN ('client', 'professional')
    GROUP BY d ORDER BY d`;
  const lateBefore = new Date(ctx.now().getTime() - ctx.config.lateAlertMinutes * 60_000).toISOString();
  const q = (await ctx.sql`
    SELECT (SELECT count(*)::int FROM professional_profiles WHERE kyc_status IN ('pending', 'in_review')) AS kyc_pending,
           (SELECT count(*)::int FROM disputes WHERE status IN ('open', 'awaiting_response', 'appealed')) AS disputes_open,
           (SELECT count(*)::int FROM refunds WHERE status = 'pending') AS refunds_pending,
           (SELECT count(*)::int FROM payouts WHERE status IN ('scheduled', 'processing')) AS payouts_open,
           (SELECT count(*)::int FROM bookings WHERE status IN ('accepted', 'en_route') AND starts_at < ${lateBefore}::timestamptz) AS late_without_checkin`)[0]!;
  return {
    days, from, to: today, users, professionals: pros,
    bookings: { total: b.total, done: b.done, lost: b.lost, gmv_cents: num(b.gmv_cents), revenue_cents: num(b.revenue_cents) },
    bookings_by_day: bookingSeries, signups_by_day: signupSeries, queues: q,
  };
}

// ------------------------------------------------------------------ plataforma: serviços
export async function adminCategories(ctx: Ctx) {
  const rows = await ctx.sql`
    SELECT c.slug, c.name, c.min_daily_rate_cents, c.max_daily_rate_cents, c.min_photos_checkout, c.active,
           (SELECT count(*)::int FROM service_offers o JOIN professional_profiles p ON p.user_id = o.professional_id WHERE o.category_id = c.id AND o.active) AS professionals
    FROM service_categories c ORDER BY c.active DESC, c.name`;
  return rows.map((r) => ({ slug: r.slug, name: r.name, min_daily_rate_cents: num(r.min_daily_rate_cents), max_daily_rate_cents: num(r.max_daily_rate_cents), min_photos_checkout: r.min_photos_checkout, active: r.active, professionals: r.professionals }));
}

export interface CategoryPatch {
  name?: string;
  min_daily_rate_cents?: number;
  max_daily_rate_cents?: number;
  min_photos_checkout?: number;
  active?: boolean;
}

export async function updateCategory(ctx: Ctx, admin: AuthUser, slug: string, patch: CategoryPatch) {
  return inTransaction(ctx.sql, async (tx) => {
    const c = (await tx`SELECT id, name, min_daily_rate_cents, max_daily_rate_cents, min_photos_checkout, active FROM service_categories WHERE slug = ${slug} FOR UPDATE`)[0];
    if (!c) throw notFound('Serviço');
    const next = {
      name: patch.name ?? (c.name as string),
      min: patch.min_daily_rate_cents ?? num(c.min_daily_rate_cents),
      max: patch.max_daily_rate_cents ?? num(c.max_daily_rate_cents),
      photos: patch.min_photos_checkout ?? (c.min_photos_checkout as number),
      active: patch.active ?? (c.active as boolean),
    };
    if (next.max < next.min) throw unprocessable('invalid_range', 'O valor máximo da diária não pode ser menor que o mínimo');
    await tx`
      UPDATE service_categories SET name = ${next.name}, min_daily_rate_cents = ${next.min}, max_daily_rate_cents = ${next.max},
             min_photos_checkout = ${next.photos}, active = ${next.active} WHERE id = ${c.id}`;
    await audit(tx, admin.id, 'category.updated', 'service_categories', c.id as string,
      { name: c.name, min_daily_rate_cents: num(c.min_daily_rate_cents), max_daily_rate_cents: num(c.max_daily_rate_cents), min_photos_checkout: c.min_photos_checkout, active: c.active },
      { name: next.name, min_daily_rate_cents: next.min, max_daily_rate_cents: next.max, min_photos_checkout: next.photos, active: next.active });
    return { slug, ...patch };
  });
}

export async function createCategory(ctx: Ctx, admin: AuthUser, input: { slug: string; name: string; min_daily_rate_cents: number; max_daily_rate_cents: number; min_photos_checkout: number }) {
  if (input.max_daily_rate_cents < input.min_daily_rate_cents) throw unprocessable('invalid_range', 'O valor máximo da diária não pode ser menor que o mínimo');
  return inTransaction(ctx.sql, async (tx) => {
    if ((await tx`SELECT 1 FROM service_categories WHERE slug = ${input.slug}`)[0]) throw conflict('slug_in_use', 'Já existe um serviço com este código');
    const r = await tx`
      INSERT INTO service_categories (slug, name, min_daily_rate_cents, max_daily_rate_cents, min_photos_checkout)
      VALUES (${input.slug}, ${input.name}, ${input.min_daily_rate_cents}, ${input.max_daily_rate_cents}, ${input.min_photos_checkout}) RETURNING id`;
    await audit(tx, admin.id, 'category.created', 'service_categories', r[0]!.id as string, null, input);
    return { slug: input.slug };
  });
}

// ------------------------------------------------------------------ plataforma: parâmetros
export async function adminConfig(ctx: Ctx) {
  const rows = await ctx.sql`
    SELECT s.key, s.value, s.updated_at, u.full_name AS updated_by_name
    FROM config_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.scope = 'global'`;
  const saved = new Map(rows.map((r) => [r.key as string, r]));
  const effective = await loadConfig(ctx.sql, DEFAULT_CONFIG);
  return SETTINGS.map((d) => {
    const row = saved.get(d.key);
    const inRange = row && Number.isInteger(Number(row.value)) && Number(row.value) >= d.min && Number(row.value) <= d.max;
    // "Alterado" só quando difere do padrão (a carga inicial já grava os padrões).
    const changed = Boolean(inRange) && Number(row!.value) !== (DEFAULT_CONFIG[d.field] as number);
    return {
      key: d.key, label: d.label, help: d.help, unit: d.unit, group: d.group, min: d.min, max: d.max,
      default: DEFAULT_CONFIG[d.field] as number, value: effective[d.field] as number, custom: changed,
      updated_at: iso(row?.updated_at), updated_by_name: (row?.updated_by_name as string | null) ?? null,
    };
  });
}

export async function setConfig(ctx: Ctx, admin: AuthUser, key: string, value: number) {
  const def = settingByKey(key);
  if (!def) throw notFound('Parâmetro');
  if (!Number.isInteger(value) || value < def.min || value > def.max) {
    throw unprocessable('out_of_range', `O valor deve ser um número inteiro entre ${def.min} e ${def.max}`, { min: def.min, max: def.max });
  }
  await inTransaction(ctx.sql, async (tx) => {
    const cur = await loadConfigFresh(tx);
    const next = { ...cur, [def.field]: value };
    if (next.acceptDeadlineShortMinutes > next.acceptDeadlineMinutes) {
      throw unprocessable('inconsistent', 'O prazo curto para aceitar não pode ser maior que o prazo normal');
    }
    const before = (await tx`SELECT value FROM config_settings WHERE key = ${key} AND scope = 'global'`)[0];
    await tx`
      INSERT INTO config_settings (key, scope, value, updated_by, updated_at) VALUES (${key}, 'global', ${tx.json(value as never)}, ${admin.id}, now())
      ON CONFLICT (key, scope) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    await audit(tx, admin.id, 'config.updated', 'config_settings', CONFIG_ENTITY, { key, value: before ? Number(before.value) : cur[def.field] }, { key, value });
  });
  invalidateConfig(ctx.sql);
  return { key, value };
}

export async function resetConfig(ctx: Ctx, admin: AuthUser, key: string) {
  const def = settingByKey(key);
  if (!def) throw notFound('Parâmetro');
  await inTransaction(ctx.sql, async (tx) => {
    const before = (await tx`DELETE FROM config_settings WHERE key = ${key} AND scope = 'global' RETURNING value`)[0];
    if (!before) return;
    await audit(tx, admin.id, 'config.reset', 'config_settings', CONFIG_ENTITY, { key, value: Number(before.value) }, { key, value: DEFAULT_CONFIG[def.field] });
  });
  invalidateConfig(ctx.sql);
  return { key, value: DEFAULT_CONFIG[def.field] as number };
}

async function loadConfigFresh(tx: Sql) {
  const rows = await tx`SELECT key, value FROM config_settings WHERE scope = 'global'`;
  return applySettings(DEFAULT_CONFIG, rows.map((r) => ({ key: r.key as string, value: r.value })));
}

// ------------------------------------------------------------------ auditoria
export async function adminAudit(ctx: Ctx, opts: { entityId?: string; limit: number }) {
  const rows = await ctx.sql`
    SELECT a.id, a.action, a.entity, a.entity_id, a.before, a.after, a.created_at, u.full_name AS actor_name
    FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
    ${opts.entityId ? ctx.sql`WHERE a.entity_id = ${opts.entityId}` : ctx.sql``}
    ORDER BY a.created_at DESC, a.id LIMIT ${opts.limit}`;
  return rows.map((r) => ({ id: r.id, action: r.action, entity: r.entity, entity_id: r.entity_id, before: r.before, after: r.after, created_at: iso(r.created_at), actor_name: (r.actor_name as string | null) ?? 'Sistema' }));
}

export { ApiError };

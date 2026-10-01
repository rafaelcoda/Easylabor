import type { Ctx } from '../types';

/** Janela de um dia no fuso de São Paulo (UTC-3, sem horário de verão). */
function dayWindow(date: string): { from: string; to: string } {
  const from = new Date(`${date}T00:00:00-03:00`);
  return { from: from.toISOString(), to: new Date(from.getTime() + 86_400_000).toISOString() };
}

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : (d as string | null));

export async function adminOverview(ctx: Ctx, date: string) {
  const { from, to } = dayWindow(date);
  const rows = await ctx.sql`
    SELECT status, count(*)::int AS n FROM bookings
    WHERE starts_at >= ${from}::timestamptz AND starts_at < ${to}::timestamptz GROUP BY status`;
  const by_status: Record<string, number> = {};
  for (const r of rows) by_status[r.status as string] = r.n as number;

  const lateBefore = new Date(ctx.now().getTime() - ctx.config.lateAlertMinutes * 60_000).toISOString();
  const late = (await ctx.sql`
    SELECT count(*)::int AS n FROM bookings WHERE status IN ('accepted', 'en_route') AND starts_at < ${lateBefore}::timestamptz`)[0]!.n as number;
  const kyc = (await ctx.sql`
    SELECT count(*)::int AS n FROM professional_profiles WHERE kyc_status IN ('pending', 'in_review')`)[0]!.n as number;
  const total = Object.values(by_status).reduce((a, b) => a + b, 0);
  return { date, total, by_status, late_without_checkin: late, kyc_pending: kyc };
}

export async function adminBookings(ctx: Ctx, opts: { date?: string; status?: string; limit: number }) {
  const w = opts.date ? dayWindow(opts.date) : null;
  const rows = await ctx.sql`
    SELECT b.id, b.code, b.status, c.slug AS category, b.starts_at, b.ends_at, b.attempt,
           (b.daily_rate_cents + b.client_fee_cents) AS total_cents,
           cu.full_name AS client_name, pu.full_name AS professional_name, b.professional_id
    FROM bookings b
    JOIN service_categories c ON c.id = b.category_id
    JOIN users cu ON cu.id = b.client_id
    JOIN users pu ON pu.id = b.professional_id
    WHERE true
      ${w ? ctx.sql`AND b.starts_at >= ${w.from}::timestamptz AND b.starts_at < ${w.to}::timestamptz` : ctx.sql``}
      ${opts.status ? ctx.sql`AND b.status = ${opts.status}` : ctx.sql``}
    ORDER BY b.starts_at DESC, b.code DESC LIMIT ${opts.limit}`;
  return rows.map((r) => ({
    id: r.id, code: r.code, status: r.status, category: r.category, attempt: r.attempt,
    starts_at: iso(r.starts_at), ends_at: iso(r.ends_at), total_cents: Number(r.total_cents),
    client_name: r.client_name, professional_name: r.professional_name, professional_id: r.professional_id,
  }));
}

/** Agenda do dia: pedidos já aceitos por profissional e ofertas ainda sem aceite. */
export async function adminSchedule(ctx: Ctx, date: string) {
  const { from, to } = dayWindow(date);
  const active = ['accepted', 'en_route', 'in_progress', 'completed', 'approved', 'paid', 'disputed'];

  const bookings = await ctx.sql`
    SELECT b.id, b.code, b.status, b.professional_id, b.starts_at, b.ends_at, c.slug AS category
    FROM bookings b JOIN service_categories c ON c.id = b.category_id
    WHERE b.starts_at >= ${from}::timestamptz AND b.starts_at < ${to}::timestamptz AND b.status = ANY(${active})
    ORDER BY b.starts_at`;

  const pros = await ctx.sql`
    SELECT u.id, u.full_name
    FROM professional_profiles p JOIN users u ON u.id = p.user_id
    WHERE p.kyc_status = 'approved' AND u.status = 'active'
      AND (EXISTS (SELECT 1 FROM availabilities a WHERE a.professional_id = p.user_id AND a.day = ${date}::date AND a.status = 'free')
           OR u.id = ANY(${bookings.map((b) => b.professional_id as string)}))
    ORDER BY u.full_name`;

  const pending = await ctx.sql`
    SELECT b.id, b.code, b.status, b.attempt, b.starts_at, b.ends_at, b.accept_deadline_at, c.slug AS category, pu.full_name AS professional_name
    FROM bookings b JOIN service_categories c ON c.id = b.category_id JOIN users pu ON pu.id = b.professional_id
    WHERE b.starts_at >= ${from}::timestamptz AND b.starts_at < ${to}::timestamptz AND b.status IN ('awaiting_payment', 'requested')
    ORDER BY b.starts_at`;

  const slot = (b: Record<string, unknown>) => ({ id: b.id, code: b.code, status: b.status, category: b.category, starts_at: iso(b.starts_at), ends_at: iso(b.ends_at) });
  return {
    date,
    professionals: pros.map((p) => ({
      id: p.id,
      name: p.full_name,
      bookings: bookings.filter((b) => b.professional_id === p.id).map(slot),
    })),
    pending: pending.map((b) => ({ ...slot(b), attempt: b.attempt, professional_name: b.professional_name, accept_deadline_at: iso(b.accept_deadline_at) })),
  };
}

import { inTransaction, type Sql } from '../db';
import { ApiError, conflict, forbidden, notFound, unprocessable } from '../errors';
import type { AuthUser, Ctx, Identity } from '../types';

/** Hoje, no fuso de São Paulo (UTC-3), como AAAA-MM-DD. */
export const spToday = (ctx: Ctx) => new Date(ctx.now().getTime() - 3 * 3_600_000).toISOString().slice(0, 10);

/** Telefone em E.164: o Supabase devolve só dígitos, sem o "+". */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

// ------------------------------------------------------------------ cadastro e perfil
export interface RegisterInput {
  role: 'client' | 'professional';
  fullName: string;
  email?: string;
  termsVersion: string;
  clientKind?: 'person' | 'company';
  cnpj?: string;
}

export async function register(ctx: Ctx, identity: Identity, input: RegisterInput) {
  const phone = normalizePhone(identity.phone);
  if (!phone) throw unprocessable('phone_missing', 'O login precisa de um telefone verificado');
  const kind = input.clientKind ?? 'person';
  if (input.role === 'client' && kind === 'company' && !/^\d{14}$/.test((input.cnpj ?? '').replace(/\D/g, ''))) {
    throw unprocessable('cnpj_invalid', 'Informe um CNPJ com 14 dígitos');
  }

  await inTransaction(ctx.sql, async (tx) => {
    if ((await tx`SELECT 1 FROM users WHERE id = ${identity.id}`)[0]) throw conflict('already_registered', 'Este usuário já está cadastrado');
    if ((await tx`SELECT 1 FROM users WHERE phone = ${phone}`)[0]) throw conflict('phone_in_use', 'Este telefone já pertence a outra conta');
    if (input.email && (await tx`SELECT 1 FROM users WHERE email = ${input.email}`)[0]) throw conflict('email_in_use', 'Este e-mail já está em uso');

    const now = ctx.now().toISOString();
    await tx`
      INSERT INTO users (id, role, full_name, phone, phone_verified_at, email, accepted_terms_version, accepted_terms_at)
      VALUES (${identity.id}, ${input.role}, ${input.fullName}, ${phone}, ${now}::timestamptz, ${input.email ?? null}, ${input.termsVersion}, ${now}::timestamptz)`;
    if (input.role === 'client') {
      const cnpj = kind === 'company' ? (input.cnpj ?? '').replace(/\D/g, '') : null;
      await tx`INSERT INTO client_profiles (user_id, kind, cnpj) VALUES (${identity.id}, ${kind}, ${cnpj})`;
    }
    if (input.role === 'professional') {
      // Se a operação reservou este celular para um colaborador (carga do Protheus), o vínculo é feito agora.
      const linked = await tx`
        UPDATE collaborators SET user_id = ${identity.id}, link_phone = NULL, linked_at = ${now}::timestamptz
        WHERE link_phone = ${phone} AND user_id IS NULL RETURNING id, name`;
      if (linked[0]) {
        await tx`
          INSERT INTO audit_logs (actor_id, action, entity, entity_id, after)
          VALUES (${identity.id}, 'collaborator.auto_linked', 'collaborators', ${linked[0].id as string}, ${tx.json({ name: linked[0].name } as never)})`;
      }
    }
  });
  return getMe(ctx, { id: identity.id, role: input.role });
}

export async function getMe(ctx: Ctx, user: AuthUser) {
  const u = (await ctx.sql`SELECT id, role, full_name, phone, email, status, admin_level FROM users WHERE id = ${user.id}`)[0];
  if (!u) throw notFound('Usuário');
  const base = { registered: true, id: u.id, role: u.role, full_name: u.full_name, phone: u.phone, email: u.email, status: u.status };

  if (u.role === 'client') {
    const c = (await ctx.sql`SELECT kind FROM client_profiles WHERE user_id = ${u.id}`)[0];
    const n = (await ctx.sql`SELECT count(*)::int AS n FROM addresses WHERE client_id = ${u.id}`)[0]!.n as number;
    return { ...base, client: { kind: c?.kind ?? null, addresses: n }, next_step: n === 0 ? 'add_address' : 'ready' };
  }
  if (u.role === 'professional') {
    const p = (await ctx.sql`
      SELECT kyc_status, visible, radius_km, level FROM professional_profiles WHERE user_id = ${u.id}`)[0];
    const offers = (await ctx.sql`SELECT count(*)::int AS n FROM service_offers WHERE professional_id = ${u.id} AND active`)[0]!.n as number;
    const free = (await ctx.sql`
      SELECT count(*)::int AS n FROM availabilities WHERE professional_id = ${u.id} AND status = 'free' AND day >= ${spToday(ctx)}::date`)[0]!.n as number;
    let next = 'complete_profile';
    if (p) next = p.kyc_status !== 'approved' ? 'await_kyc' : offers === 0 ? 'add_offer' : free === 0 ? 'add_availability' : 'ready';
    return {
      ...base,
      professional: p ? { profile_complete: true, kyc_status: p.kyc_status, visible: p.visible, radius_km: p.radius_km, level: p.level, offers } : { profile_complete: false },
      next_step: next,
    };
  }
  return { ...base, admin_level: (u.admin_level as string | null) ?? 'operator', next_step: 'ready' };
}

// ------------------------------------------------------------------ endereços do cliente
export interface AddressInput {
  label?: string;
  street: string;
  number?: string;
  complement?: string;
  district?: string;
  city: string;
  state: string;
  zip?: string;
  reference?: string;
  lat: number;
  lng: number;
}

export async function createAddress(ctx: Ctx, clientId: string, a: AddressInput) {
  const r = await ctx.sql`
    INSERT INTO addresses (client_id, label, street, number, complement, district, city, state, zip, reference, location)
    VALUES (${clientId}, ${a.label ?? null}, ${a.street}, ${a.number ?? null}, ${a.complement ?? null}, ${a.district ?? null},
            ${a.city}, ${a.state.toUpperCase()}, ${a.zip ?? null}, ${a.reference ?? null},
            ST_SetSRID(ST_MakePoint(${a.lng}, ${a.lat}), 4326)::geography)
    RETURNING id`;
  return { id: r[0]!.id as string };
}

export async function listAddresses(ctx: Ctx, clientId: string) {
  return ctx.sql`
    SELECT id, label, street, number, complement, district, city, state, zip, reference,
           ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
    FROM addresses WHERE client_id = ${clientId} ORDER BY label NULLS LAST, street`;
}

export async function deleteAddress(ctx: Ctx, clientId: string, id: string) {
  try {
    const r = await ctx.sql`DELETE FROM addresses WHERE id = ${id} AND client_id = ${clientId} RETURNING id`;
    if (!r[0]) throw notFound('Endereço');
  } catch (e) {
    if ((e as { code?: string }).code === '23503') throw conflict('address_in_use', 'Este endereço já foi usado em pedidos e não pode ser apagado');
    throw e;
  }
}

// ------------------------------------------------------------------ profissional
export interface ProfessionalProfileInput {
  bio?: string;
  lat: number;
  lng: number;
  radiusKm: number;
  pixKey: string;
}

export async function upsertProfessionalProfile(ctx: Ctx, userId: string, p: ProfessionalProfileInput) {
  await inTransaction(ctx.sql, async (tx) => {
    const prev = (await tx`SELECT pix_key FROM professional_profiles WHERE user_id = ${userId} FOR UPDATE`)[0];
    const pixChanged = prev && prev.pix_key !== p.pixKey;
    await tx`
      INSERT INTO professional_profiles (user_id, bio, base_location, radius_km, pix_key, pix_key_changed_at)
      VALUES (${userId}, ${p.bio ?? null}, ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography, ${p.radiusKm}, ${p.pixKey}, NULL)
      ON CONFLICT (user_id) DO UPDATE SET
        bio = EXCLUDED.bio, base_location = EXCLUDED.base_location, radius_km = EXCLUDED.radius_km, pix_key = EXCLUDED.pix_key,
        pix_key_changed_at = ${pixChanged ? ctx.now().toISOString() : null}::timestamptz`;
  });
  return getMe(ctx, { id: userId, role: 'professional' });
}

async function requireProfessionalProfile(sql: Sql, userId: string) {
  const p = (await sql`SELECT kyc_status FROM professional_profiles WHERE user_id = ${userId}`)[0];
  if (!p) throw unprocessable('profile_missing', 'Complete seu perfil de profissional primeiro');
  return p;
}

export async function upsertOffer(ctx: Ctx, userId: string, categorySlug: string, dailyRateCents: number, description?: string) {
  await requireProfessionalProfile(ctx.sql, userId);
  const cat = (await ctx.sql`
    SELECT id, min_daily_rate_cents, max_daily_rate_cents FROM service_categories WHERE slug = ${categorySlug} AND active`)[0];
  if (!cat) throw notFound('Categoria');
  const min = Number(cat.min_daily_rate_cents);
  const max = Number(cat.max_daily_rate_cents);
  if (dailyRateCents < min || dailyRateCents > max) {
    throw unprocessable('rate_out_of_range', 'O valor da diária está fora da faixa permitida para a categoria', { min_cents: min, max_cents: max });
  }
  await ctx.sql`
    INSERT INTO service_offers (professional_id, category_id, daily_rate_cents, description, active)
    VALUES (${userId}, ${cat.id}, ${dailyRateCents}, ${description ?? null}, true)
    ON CONFLICT (professional_id, category_id) DO UPDATE SET
      daily_rate_cents = EXCLUDED.daily_rate_cents, description = EXCLUDED.description, active = true`;
  return { category: categorySlug, daily_rate_cents: dailyRateCents };
}

export async function setAvailability(ctx: Ctx, userId: string, day: string, startTime: string, endTime: string) {
  await requireProfessionalProfile(ctx.sql, userId);
  if (endTime <= startTime) throw unprocessable('invalid_range', 'O horário final deve ser depois do inicial');
  await inTransaction(ctx.sql, async (tx) => {
    await tx`DELETE FROM availabilities WHERE professional_id = ${userId} AND day = ${day}::date AND status = 'free'`;
    await tx`
      INSERT INTO availabilities (professional_id, day, start_time, end_time, status)
      VALUES (${userId}, ${day}::date, ${startTime}::time, ${endTime}::time, 'free')
      ON CONFLICT (professional_id, day, start_time) DO UPDATE SET end_time = EXCLUDED.end_time, status = 'free'`;
  });
  return { day, start_time: startTime, end_time: endTime };
}

// ------------------------------------------------------------------ disponibilidade semanal e tela de cadastro
const HORIZON_DAYS = 28;
const hhmm = (t: unknown) => String(t).slice(0, 5);

/**
 * Cria as linhas de disponibilidade dos próximos 28 dias a partir do modelo semanal. Só preenche dias que ainda não
 * têm nenhuma linha: o que o profissional ajustou à mão num dia, e dias já reservados, nunca são tocados.
 * Devolve quantas linhas foram criadas. Sem `professionalId`, vale para todos (usado pela rotina diária).
 */
export async function materializeWeekly(sql: Sql, today: string, professionalId?: string): Promise<number> {
  const rows = await sql`
    INSERT INTO availabilities (professional_id, day, start_time, end_time, status, source)
    SELECT p.user_id, d.day::date, p.weekly_start, p.weekly_end, 'free', 'weekly'
    FROM professional_profiles p
    CROSS JOIN LATERAL generate_series(${today}::date, ${today}::date + ${HORIZON_DAYS - 1}::int, interval '1 day') AS d(day)
    WHERE cardinality(p.weekly_days) > 0 AND p.weekly_start IS NOT NULL AND p.weekly_end IS NOT NULL
      ${professionalId ? sql`AND p.user_id = ${professionalId}` : sql``}
      AND extract(isodow FROM d.day)::smallint = ANY(p.weekly_days)
      AND NOT EXISTS (SELECT 1 FROM availabilities a WHERE a.professional_id = p.user_id AND a.day = d.day::date)
    ON CONFLICT (professional_id, day, start_time) DO NOTHING
    RETURNING 1`;
  return rows.length;
}

/** Define os dias da semana (1 = segunda ... 7 = domingo) e o horário em que o profissional atende. Lista vazia desliga. */
export async function setWeekly(ctx: Ctx, userId: string, days: number[], startTime: string, endTime: string) {
  await requireProfessionalProfile(ctx.sql, userId);
  const unique = [...new Set(days)].sort((a, b) => a - b);
  if (unique.length > 0 && endTime <= startTime) throw unprocessable('invalid_range', 'O horário final deve ser depois do inicial');
  const today = spToday(ctx);
  await inTransaction(ctx.sql, async (tx) => {
    await tx`
      UPDATE professional_profiles
      SET weekly_days = ${unique}::smallint[], weekly_start = ${unique.length ? startTime : null}::time, weekly_end = ${unique.length ? endTime : null}::time
      WHERE user_id = ${userId}`;
    // Refaz só o que veio do modelo semanal e ainda está livre, daqui para a frente.
    await tx`DELETE FROM availabilities WHERE professional_id = ${userId} AND source = 'weekly' AND status = 'free' AND day >= ${today}::date`;
    await materializeWeekly(tx as unknown as Sql, today, userId);
  });
  return { days: unique, start_time: startTime, end_time: endTime };
}

/** Tudo o que a tela "Seu cadastro" precisa para abrir já preenchida. */
export async function getProfessionalSetup(ctx: Ctx, userId: string) {
  const p = (await ctx.sql`
    SELECT bio, radius_km, pix_key, ST_Y(base_location::geometry) AS lat, ST_X(base_location::geometry) AS lng,
           weekly_days, weekly_start, weekly_end
    FROM professional_profiles WHERE user_id = ${userId}`)[0];
  const offers = await ctx.sql`
    SELECT c.slug, o.daily_rate_cents FROM service_offers o JOIN service_categories c ON c.id = o.category_id
    WHERE o.professional_id = ${userId} AND o.active ORDER BY c.name`;
  return {
    profile: p ? { bio: p.bio as string | null, radius_km: p.radius_km as number, pix_key: p.pix_key as string, lat: Number(p.lat), lng: Number(p.lng) } : null,
    offers: offers.map((o) => ({ category: o.slug as string, daily_rate_cents: Number(o.daily_rate_cents) })),
    weekly: {
      days: ((p?.weekly_days as number[] | undefined) ?? []).map(Number),
      start_time: p?.weekly_start ? hhmm(p.weekly_start) : '06:00',
      end_time: p?.weekly_end ? hhmm(p.weekly_end) : '20:00',
    },
  };
}

/** Tira um serviço da lista do profissional (some da busca; o histórico fica). */
export async function removeOffer(ctx: Ctx, userId: string, categorySlug: string) {
  const r = await ctx.sql`
    UPDATE service_offers o SET active = false FROM service_categories c
    WHERE c.id = o.category_id AND c.slug = ${categorySlug} AND o.professional_id = ${userId} AND o.active RETURNING o.id`;
  if (!r[0]) throw notFound('Serviço');
}

export async function setVisibility(ctx: Ctx, userId: string, visible: boolean) {
  const p = await requireProfessionalProfile(ctx.sql, userId);
  if (p.kyc_status !== 'approved') throw forbidden('Seu cadastro ainda não foi aprovado pela operação');
  await ctx.sql`UPDATE professional_profiles SET visible = ${visible} WHERE user_id = ${userId}`;
  return { visible };
}

// ------------------------------------------------------------------ admin: verificação (KYC)
export async function kycQueue(ctx: Ctx) {
  return ctx.sql`
    SELECT u.id, u.full_name, u.phone, p.kyc_status, p.radius_km, u.created_at
    FROM professional_profiles p JOIN users u ON u.id = p.user_id
    WHERE p.kyc_status IN ('pending', 'in_review') ORDER BY u.created_at`;
}

export async function kycDecision(ctx: Ctx, admin: AuthUser, userId: string, decision: 'approve' | 'reject', reason?: string) {
  if (decision === 'reject' && !reason) throw new ApiError(400, 'validation_failed', 'Informe o motivo da reprovação');
  await inTransaction(ctx.sql, async (tx) => {
    const before = (await tx`SELECT kyc_status, kyc_reason FROM professional_profiles WHERE user_id = ${userId} FOR UPDATE`)[0];
    if (!before) throw notFound('Perfil de profissional');
    const status = decision === 'approve' ? 'approved' : 'rejected';
    await tx`
      UPDATE professional_profiles SET kyc_status = ${status}, kyc_reason = ${reason ?? null},
             visible = CASE WHEN ${status} = 'approved' THEN visible ELSE false END
      WHERE user_id = ${userId}`;
    await tx`
      INSERT INTO audit_logs (actor_id, action, entity, entity_id, before, after)
      VALUES (${admin.id}, 'kyc.decision', 'professional_profiles', ${userId},
              ${tx.json(before as never)}, ${tx.json({ kyc_status: status, kyc_reason: reason ?? null } as never)})`;
  });
  return { user_id: userId, kyc_status: decision === 'approve' ? 'approved' : 'rejected' };
}


// ------------------------------------------------------------------ exclusão da conta (exigida pelas lojas e pela LGPD)
/** Pedidos que ainda podem movimentar serviço ou dinheiro: enquanto houver algum, a conta não pode ser excluída. */
const OPEN_STATUSES = ['awaiting_payment', 'requested', 'accepted', 'en_route', 'in_progress', 'completed', 'disputed', 'approved'];

/**
 * Anonimiza a conta: some o nome, o telefone, o e-mail e o CPF, e a conta deixa de entrar. Os pedidos continuam
 * (precisam ser guardados por motivos fiscais e de disputa), mas sem identificar a pessoa. Endereços, documentos,
 * dispositivos e notificações são apagados.
 */
export async function deleteAccount(ctx: Ctx, user: AuthUser) {
  if (user.role === 'admin') throw forbidden('Contas de administrador são removidas pela operação');
  await inTransaction(ctx.sql, async (tx) => {
    const open = await tx`
      SELECT code FROM bookings
      WHERE (client_id = ${user.id} OR professional_id = ${user.id}) AND status = ANY(${OPEN_STATUSES}) LIMIT 5`;
    if (open.length > 0) {
      throw conflict('open_bookings', 'Você tem pedidos em andamento. Conclua ou cancele antes de excluir a conta.', { codes: open.map((r) => r.code) });
    }
    const pending = await tx`
      SELECT 1 FROM payouts WHERE professional_id = ${user.id} AND status IN ('scheduled', 'processing') LIMIT 1`;
    if (pending[0]) throw conflict('pending_payout', 'Você tem um repasse a receber. Aguarde o pagamento antes de excluir a conta.');

    const tag = user.id.replace(/-/g, '').slice(0, 12);
    await tx`
      UPDATE users SET full_name = 'Usuário removido', phone = ${'removido:' + tag}, email = NULL, cpf = NULL,
                       status = 'deleted', deleted_at = ${ctx.now().toISOString()}::timestamptz, phone_verified_at = NULL
      WHERE id = ${user.id}`;
    await tx`UPDATE professional_profiles SET visible = false, bio = NULL, photo_url = NULL, pix_key = 'removido' WHERE user_id = ${user.id}`;
    await tx`UPDATE client_profiles SET cnpj = NULL, legal_name = NULL WHERE user_id = ${user.id}`;
    await tx`DELETE FROM documents WHERE user_id = ${user.id}`;
    await tx`DELETE FROM device_tokens WHERE user_id = ${user.id}`;
    await tx`DELETE FROM notifications WHERE user_id = ${user.id}`;
    // Endereços usados em pedidos precisam ficar (chave estrangeira): perdem o texto que identifica o local.
    await tx`UPDATE addresses SET street = 'removido', number = NULL, complement = NULL, reference = NULL, label = NULL, zip = NULL WHERE client_id = ${user.id}`;
    await tx`
      INSERT INTO audit_logs (actor_id, action, entity, entity_id, before, after)
      VALUES (${user.id}, 'user.deleted', 'users', ${user.id}, NULL, ${tx.json({ status: 'deleted' } as never)})`;
  });
  return { deleted: true };
}

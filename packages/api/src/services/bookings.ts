import {
  InvalidTransitionError,
  acceptDeadline,
  afterUnaccepted,
  autoApproveAt,
  availableActions,
  clientCancellation,
  clientNoShow,
  ledger,
  payoutScheduledFor,
  pixExpiresAt,
  professionalCancellation,
  professionalNoShow,
  quote as makeQuote,
  shouldSuspend,
  transition,
  validateCheckIn,
  type Actor,
  type BookingAction,
  type BookingStatus,
  type Quote,
} from '@diaria/core';
import { inTransaction, type Sql } from '../db';
import { ApiError, conflict, forbidden, notFound, unprocessable } from '../errors';
import type { AuthUser, Ctx } from '../types';
import { newRef, writeLedger } from './ledgerWriter';
import { searchProfessionals } from './search';

// ------------------------------------------------------------------ tipos e leitura
interface BookingRow {
  id: string;
  code: string;
  client_id: string;
  professional_id: string;
  category_id: string;
  address_id: string;
  starts_at: Date;
  ends_at: Date;
  description: string;
  daily_rate_cents: number;
  client_fee_cents: number;
  commission_cents: number;
  status: BookingStatus;
  accept_deadline_at: Date | null;
  auto_approve_at: Date | null;
  attempt: number;
  version: number;
  created_at: Date;
  addr_lat: number;
  addr_lng: number;
  street: string;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string;
  state: string;
  reference: string | null;
  category_slug: string;
  min_photos_checkout: number;
}

const ADDRESS_VISIBLE_TO_PROFESSIONAL: readonly BookingStatus[] = [
  'accepted', 'en_route', 'in_progress', 'completed', 'approved', 'disputed', 'paid', 'no_show_client', 'no_show_professional',
];

async function loadBooking(tx: Sql, id: string, lock: boolean): Promise<BookingRow> {
  const rows = await tx`
    SELECT b.*, ST_Y(a.location::geometry) AS addr_lat, ST_X(a.location::geometry) AS addr_lng,
           a.street, a.number, a.complement, a.district, a.city, a.state, a.reference,
           c.slug AS category_slug, c.min_photos_checkout
    FROM bookings b
    JOIN addresses a ON a.id = b.address_id
    JOIN service_categories c ON c.id = b.category_id
    WHERE b.id = ${id}
    ${lock ? tx`FOR UPDATE OF b` : tx``}`;
  if (!rows[0]) throw notFound('Pedido');
  return rows[0] as unknown as BookingRow;
}

const quoteOf = (b: BookingRow): Quote => ({
  dailyRateCents: b.daily_rate_cents,
  clientFeeCents: b.client_fee_cents,
  totalCents: b.daily_rate_cents + b.client_fee_cents,
  commissionCents: b.commission_cents,
  professionalNetCents: b.daily_rate_cents - b.commission_cents,
  currency: 'BRL',
});

function viewerActor(b: BookingRow, user: AuthUser): Actor {
  if (user.role === 'admin') return 'admin';
  if (user.id === b.client_id) return 'client';
  if (user.id === b.professional_id) return 'professional';
  throw forbidden('Este pedido não pertence a você');
}

async function toView(tx: Sql, b: BookingRow, user: AuthUser) {
  const actor = viewerActor(b, user);
  const showAddress = actor !== 'professional' || ADDRESS_VISIBLE_TO_PROFESSIONAL.includes(b.status);
  const events = await tx`
    SELECT type, to_status, created_at FROM booking_events WHERE booking_id = ${b.id} AND type <> 'booking.offered' ORDER BY created_at, id`;
  let payment: Record<string, unknown> | null = null;
  if (actor !== 'professional') {
    const p = await tx`
      SELECT id, method, status, amount_cents, pix_qr_payload, pix_expires_at
      FROM payments WHERE booking_id = ${b.id} ORDER BY created_at DESC LIMIT 1`;
    payment = p[0] ?? null;
  }
  const photos = await tx`SELECT file_key, created_at FROM booking_attachments WHERE booking_id = ${b.id} AND kind = 'checkout_photo' ORDER BY created_at, file_key`;
  const q = quoteOf(b);
  return {
    id: b.id,
    code: b.code,
    status: b.status,
    category: b.category_slug,
    client_id: b.client_id,
    professional_id: b.professional_id,
    starts_at: b.starts_at.toISOString(),
    ends_at: b.ends_at.toISOString(),
    description: b.description,
    amounts: {
      daily_rate_cents: q.dailyRateCents,
      client_fee_cents: q.clientFeeCents,
      total_cents: q.totalCents,
      commission_cents: q.commissionCents,
      professional_net_cents: q.professionalNetCents,
    },
    district: b.district,
    address: showAddress
      ? { street: b.street, number: b.number, complement: b.complement, district: b.district, city: b.city, state: b.state, reference: b.reference, lat: b.addr_lat, lng: b.addr_lng }
      : null,
    accept_deadline_at: b.accept_deadline_at?.toISOString() ?? null,
    auto_approve_at: b.auto_approve_at?.toISOString() ?? null,
    payment,
    photos: photos.map((p) => ({ key: p.file_key as string, at: (p.created_at as Date).toISOString() })),
    available_actions: availableActions(b.status, actor),
    timeline: events.map((e) => ({ type: e.type, to_status: e.to_status, at: (e.created_at as Date).toISOString() })),
    version: b.version,
  };
}

export async function getBooking(ctx: Ctx, user: AuthUser, id: string) {
  const b = await loadBooking(ctx.sql, id, false);
  return toView(ctx.sql, b, user);
}

export async function listBookings(ctx: Ctx, user: AuthUser, opts: { status?: string; limit: number }) {
  const rows = await ctx.sql`
    SELECT id FROM bookings
    WHERE (client_id = ${user.id} OR professional_id = ${user.id})
    ${opts.status ? ctx.sql`AND status = ${opts.status}` : ctx.sql``}
    ORDER BY created_at DESC LIMIT ${opts.limit}`;
  const out = [];
  for (const r of rows) out.push(await toView(ctx.sql, await loadBooking(ctx.sql, r.id as string, false), user));
  return out;
}

// ------------------------------------------------------------------ criação
export interface CreateBookingInput {
  professionalId: string;
  category: string;
  addressId: string;
  date: string; // YYYY-MM-DD, no fuso de São Paulo
  startTime: string; // HH:MM
  durationMinutes: number;
  description: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export async function createBooking(ctx: Ctx, user: AuthUser, input: CreateBookingInput) {
  if (user.role !== 'client') throw forbidden('Somente clientes criam pedidos');

  // América/São Paulo não tem horário de verão desde 2019: UTC-3 fixo.
  const startsAt = new Date(`${input.date}T${input.startTime}:00-03:00`);
  if (Number.isNaN(startsAt.getTime())) throw new ApiError(400, 'validation_failed', 'Data ou horário inválido');
  if (startsAt.getTime() <= ctx.now().getTime()) throw unprocessable('start_in_past', 'O horário do serviço já passou');
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
  const [sh, sm] = input.startTime.split(':').map(Number) as [number, number];
  const endMinutes = sh * 60 + sm + input.durationMinutes;
  if (endMinutes >= 24 * 60) throw unprocessable('crosses_midnight', 'O serviço deve terminar no mesmo dia');
  const endLocal = `${pad(Math.floor(endMinutes / 60))}:${pad(endMinutes % 60)}`;

  const id = await inTransaction(ctx.sql, async (tx) => {
    const cp = await tx`SELECT 1 FROM client_profiles WHERE user_id = ${user.id}`;
    if (!cp[0]) throw unprocessable('client_profile_missing', 'Complete seu cadastro de cliente');

    const addr = await tx`SELECT 1 FROM addresses WHERE id = ${input.addressId} AND client_id = ${user.id}`;
    if (!addr[0]) throw notFound('Endereço');

    const offer = await tx`
      SELECT o.daily_rate_cents, c.id AS category_id, p.kyc_status, p.visible, u.status AS user_status
      FROM service_offers o
      JOIN service_categories c ON c.id = o.category_id AND c.slug = ${input.category} AND c.active
      JOIN professional_profiles p ON p.user_id = o.professional_id
      JOIN users u ON u.id = p.user_id
      WHERE o.professional_id = ${input.professionalId} AND o.active`;
    const o = offer[0];
    if (!o || o.kyc_status !== 'approved' || !o.visible || o.user_status !== 'active') {
      throw unprocessable('professional_unavailable', 'Este profissional não está disponível para este serviço');
    }

    const free = await tx`
      SELECT 1 FROM availabilities
      WHERE professional_id = ${input.professionalId} AND day = ${input.date}::date AND status = 'free'
        AND start_time <= ${input.startTime}::time AND end_time >= ${endLocal}::time LIMIT 1`;
    const clash = await tx`
      SELECT 1 FROM bookings
      WHERE professional_id = ${input.professionalId} AND status IN ('accepted','en_route','in_progress')
        AND tstzrange(starts_at, ends_at) && tstzrange(${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz) LIMIT 1`;
    if (!free[0] || clash[0]) throw conflict('slot_unavailable', 'O profissional não está livre nesse horário');

    const q = makeQuote(Number(o.daily_rate_cents), ctx.config);
    const code = (await tx`SELECT 'D-' || nextval('booking_code_seq') AS code`)[0]!.code as string;
    const bookingId = crypto.randomUUID();

    // Cobrança Pix criada no provedor antes de gravar; se a gravação falhar, a cobrança expira sem ser paga.
    let charge;
    try {
      charge = await ctx.provider.createPixCharge({
        externalReference: bookingId,
        amountCents: q.totalCents,
        expiresAt: pixExpiresAt(ctx.now(), ctx.config),
        description: `Diária ${code}`,
      });
    } catch {
      throw new ApiError(502, 'payment_provider_error', 'Não foi possível gerar a cobrança agora. Tente novamente.');
    }

    await tx`
      INSERT INTO bookings (id, code, client_id, requested_by, professional_id, category_id, address_id, starts_at, ends_at,
                            description, daily_rate_cents, client_fee_cents, commission_cents, status)
      VALUES (${bookingId}, ${code}, ${user.id}, ${user.id}, ${input.professionalId}, ${o.category_id}, ${input.addressId},
              ${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz, ${input.description},
              ${q.dailyRateCents}, ${q.clientFeeCents}, ${q.commissionCents}, 'awaiting_payment')`;

    await tx`
      INSERT INTO payments (booking_id, method, amount_cents, status, provider, provider_payment_id, pix_qr_payload, pix_expires_at)
      VALUES (${bookingId}, 'pix', ${q.totalCents}, 'pending', ${ctx.provider.name}, ${charge.providerPaymentId}, ${charge.qrPayload},
              ${charge.expiresAt.toISOString()}::timestamptz)`;
    await recordEvent(tx, bookingId, 'booking.created', null, 'awaiting_payment', user.id, 'client', {});
    await recordEvent(tx, bookingId, 'booking.offered', null, null, null, 'system', { professional_id: input.professionalId, attempt: 1 });
    return bookingId;
  });

  return getBooking(ctx, user, id);
}

// ------------------------------------------------------------------ ações
export type ActionBody = Record<string, unknown>;

export interface ActionRequest {
  bookingId: string;
  action: BookingAction;
  user: AuthUser | null; // null = sistema (webhook ou job)
  body?: ActionBody;
}

async function recordEvent(
  tx: Sql, bookingId: string, type: string, from: string | null, to: string | null,
  actorId: string | null, actorType: Actor, meta: Record<string, unknown>,
) {
  await tx`
    INSERT INTO booking_events (booking_id, type, from_status, to_status, actor_id, actor_type, metadata)
    VALUES (${bookingId}, ${type}, ${from}, ${to}, ${actorId}, ${actorType}, ${tx.json(meta as never)})`;
}

function resolveActor(b: BookingRow, req: ActionRequest): Actor {
  if (!req.user) return 'system';
  if (req.user.role === 'admin') return 'admin';
  if (req.user.id === b.client_id && req.user.id !== b.professional_id) return 'client';
  if (req.user.id === b.professional_id) return 'professional';
  throw forbidden('Este pedido não pertence a você');
}

export async function applyAction(ctx: Ctx, req: ActionRequest) {
  const viewer: AuthUser = req.user ?? { id: '00000000-0000-0000-0000-000000000000', role: 'admin' };
  const bookingId = await inTransaction(ctx.sql, async (tx) => {
    const b = await loadBooking(tx, req.bookingId, true);
    const actor = resolveActor(b, req);
    const body = req.body ?? {};
    const now = ctx.now();

    let to: BookingStatus;
    try {
      to = transition(b.status, req.action, actor);
    } catch (e) {
      if (e instanceof InvalidTransitionError) {
        const status = e.code === 'forbidden_actor' ? 403 : 409;
        throw new ApiError(status, e.code, e.message, { status: b.status, action: req.action });
      }
      throw e;
    }

    const patch: Record<string, unknown> = {};
    const meta: Record<string, unknown> = {};
    const q = quoteOf(b);
    const hoursUntilStart = (b.starts_at.getTime() - now.getTime()) / 3_600_000;

    switch (req.action) {
      case 'payment_confirmed': {
        const pay = (await tx`SELECT id, amount_cents, status FROM payments WHERE booking_id = ${b.id} ORDER BY created_at DESC LIMIT 1 FOR UPDATE`)[0];
        if (!pay || pay.status !== 'pending') throw conflict('payment_not_pending', 'Não há cobrança pendente');
        await tx`UPDATE payments SET status = 'paid', paid_at = ${now.toISOString()}::timestamptz, version = version + 1 WHERE id = ${pay.id}`;
        await writeLedger(tx, b.id, ledger.paymentConfirmed(newRef('payment', pay.id as string), Number(pay.amount_cents)));
        patch.accept_deadline_at = acceptDeadline(now, b.starts_at, ctx.config);
        break;
      }
      case 'payment_expired':
        await tx`UPDATE payments SET status = 'expired' WHERE booking_id = ${b.id} AND status = 'pending'`;
        break;
      case 'accept_deadline_expired':
        // Sem profissional que aceite (o reenvio já foi tentado): devolve tudo ao cliente.
        await refundPayment(tx, b, q.totalCents, 'cancellation');
        break;
      case 'accept':
        if (b.accept_deadline_at && now.getTime() > b.accept_deadline_at.getTime()) {
          throw conflict('accept_deadline_passed', 'O prazo para aceitar este pedido acabou');
        }
        break;
      case 'decline':
        // Recusa terminal (o reenvio a outro profissional é tentado antes, em redirectOffer): estorno integral.
        meta.reason = body.reason ?? null;
        await refundPayment(tx, b, q.totalCents, 'cancellation');
        break;
      case 'no_show_professional': {
        const outcome = professionalNoShow(q);
        meta.refund_cents = outcome.refundCents;
        await refundPayment(tx, b, outcome.refundCents, 'no_show');
        await registerStrike(tx, b.professional_id, b.id, now, ctx);
        break;
      }
      case 'no_show_client': {
        const earliest = b.starts_at.getTime() + ctx.config.lateAlertMinutes * 60_000;
        if (now.getTime() < earliest) {
          throw unprocessable('too_early', 'Aguarde 30 minutos após o horário combinado para registrar a ausência do cliente');
        }
        const outcome = clientNoShow(q, ctx.config);
        meta.refund_cents = outcome.refundCents;
        meta.compensation_cents = outcome.compensationCents;
        await payCompensation(tx, b, outcome.compensationCents, now, ctx);
        if (outcome.refundCents > 0) await refundPayment(tx, b, outcome.refundCents, 'no_show');
        break;
      }
      case 'check_in': {
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        const r = validateCheckIn({ position: { lat, lng }, address: { lat: b.addr_lat, lng: b.addr_lng }, now, startsAt: b.starts_at }, ctx.config);
        if (!r.ok) {
          const msg = r.code === 'checkin_too_far' ? 'Você está longe demais do endereço' : 'Ainda é cedo para o check-in';
          throw unprocessable(r.code, msg, { distance_m: r.distanceM });
        }
        await tx`
          INSERT INTO check_ins (booking_id, kind, location, accuracy_m, distance_to_address_m, validation)
          VALUES (${b.id}, 'arrival', ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
                  ${body.accuracy_m === undefined ? null : Number(body.accuracy_m)}, ${r.distanceM}, 'gps')`;
        meta.distance_m = r.distanceM;
        break;
      }
      case 'check_out': {
        const keys = [...new Set((body.photo_keys as string[] | undefined) ?? [])];
        // Cada foto precisa estar na pasta do profissional e deste pedido: <usuário>/<pedido>/<arquivo>
        const valid = new RegExp(`^${viewer.id}/${b.id}/[A-Za-z0-9._-]{1,120}$`, 'i');
        if (keys.some((k) => !valid.test(k))) throw unprocessable('invalid_photo_key', 'Uma das fotos não pertence a este serviço');
        if (keys.length < b.min_photos_checkout) {
          throw unprocessable('not_enough_photos', `Envie ao menos ${b.min_photos_checkout} foto(s) do resultado`, { required: b.min_photos_checkout });
        }
        if (ctx.verifyPhotoUploads) {
          const found = await tx`SELECT name FROM storage.objects WHERE bucket_id = 'booking-photos' AND name = ANY(${keys})`;
          if (found.length !== keys.length) throw unprocessable('photo_not_uploaded', 'Alguma foto não terminou de ser enviada. Tente de novo.');
        }
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        await tx`
          INSERT INTO check_ins (booking_id, kind, location, validation, note)
          VALUES (${b.id}, 'departure', ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, 'gps', ${(body.note as string | undefined) ?? null})`;
        for (const key of keys) {
          await tx`INSERT INTO booking_attachments (booking_id, kind, file_key, uploaded_by) VALUES (${b.id}, 'checkout_photo', ${key}, ${viewer.id})`;
        }
        patch.auto_approve_at = autoApproveAt(now, ctx.config);
        break;
      }
      case 'approve': {
        await tx`
          INSERT INTO payouts (professional_id, booking_id, type, gross_cents, commission_cents, advance_fee_cents, net_cents, status, scheduled_for)
          VALUES (${b.professional_id}, ${b.id}, 'standard', ${q.dailyRateCents}, ${q.commissionCents}, 0, ${q.professionalNetCents},
                  'scheduled', ${payoutScheduledFor(now, ctx.config).toISOString()}::timestamptz)`;
        await writeLedger(tx, b.id, ledger.bookingApproved(newRef('booking', b.id), q));
        await tx`UPDATE payments SET status = 'released', version = version + 1 WHERE booking_id = ${b.id} AND status = 'paid'`;
        await tx`UPDATE professional_profiles SET completed_count = completed_count + 1 WHERE user_id = ${b.professional_id}`;
        break;
      }
      case 'cancel_by_client':
      case 'cancel_by_professional': {
        if (b.status === 'awaiting_payment') {
          await tx`UPDATE payments SET status = 'expired' WHERE booking_id = ${b.id} AND status = 'pending'`;
          break;
        }
        const outcome =
          req.action === 'cancel_by_professional'
            ? professionalCancellation(hoursUntilStart, q, ctx.config)
            : clientCancellation({ status: b.status, hoursUntilStart, enRoute: b.status === 'en_route', quote: q }, ctx.config);
        meta.reason = body.reason ?? null;
        meta.refund_cents = outcome.refundCents;
        meta.compensation_cents = outcome.compensationCents;
        if (outcome.compensationCents > 0) await payCompensation(tx, b, outcome.compensationCents, now, ctx);
        if (outcome.refundCents > 0) await refundPayment(tx, b, outcome.refundCents, 'cancellation');
        if (outcome.strike) await registerStrike(tx, b.professional_id, b.id, now, ctx);
        break;
      }
      default:
        break;
    }

    try {
      await tx`UPDATE bookings SET ${tx({ status: to, version: b.version + 1, ...patch } as never)} WHERE id = ${b.id}`;
    } catch (e) {
      if ((e as { code?: string }).code === '23P01') throw conflict('slot_unavailable', 'Você já tem um serviço neste horário');
      throw e;
    }
    await recordEvent(tx, b.id, `booking.${req.action}`, b.status, to, req.user?.id ?? null, actor, meta);
    return b.id;
  });

  return getBooking(ctx, viewer, bookingId);
}

// ------------------------------------------------------------------ financeiro
async function refundPayment(tx: Sql, b: BookingRow, amountCents: number, reason: 'cancellation' | 'no_show' | 'dispute' | 'admin') {
  const pay = (await tx`SELECT id, amount_cents, status FROM payments WHERE booking_id = ${b.id} ORDER BY created_at DESC LIMIT 1 FOR UPDATE`)[0];
  if (!pay || !['paid', 'partially_refunded'].includes(pay.status as string)) return;
  const refund = await tx`
    INSERT INTO refunds (payment_id, amount_cents, reason, status) VALUES (${pay.id}, ${amountCents}, ${reason}, 'pending') RETURNING id`;
  await writeLedger(tx, b.id, ledger.refund(newRef('refund', refund[0]!.id as string), amountCents));
  const full = amountCents >= Number(pay.amount_cents);
  await tx`UPDATE payments SET status = ${full ? 'refunded' : 'partially_refunded'}, version = version + 1 WHERE id = ${pay.id}`;
}

async function payCompensation(tx: Sql, b: BookingRow, amountCents: number, now: Date, ctx: Ctx) {
  await writeLedger(tx, b.id, ledger.compensation(newRef('booking', b.id), amountCents));
  await tx`
    INSERT INTO payouts (professional_id, booking_id, type, gross_cents, commission_cents, advance_fee_cents, net_cents, status, scheduled_for)
    VALUES (${b.professional_id}, ${b.id}, 'standard', ${amountCents}, 0, 0, ${amountCents}, 'scheduled',
            ${payoutScheduledFor(now, ctx.config).toISOString()}::timestamptz)`;
}

async function registerStrike(tx: Sql, professionalId: string, bookingId: string, now: Date, ctx: Ctx) {
  const expires = new Date(now.getTime() + ctx.config.strikeWindowDays * 86_400_000);
  await tx`INSERT INTO strikes (user_id, booking_id, kind, expires_at) VALUES (${professionalId}, ${bookingId}, 'cancellation', ${expires.toISOString()}::timestamptz)`;
  const since = new Date(now.getTime() - ctx.config.strikeWindowDays * 86_400_000);
  const rows = await tx`SELECT created_at FROM strikes WHERE user_id = ${professionalId} AND created_at >= ${since.toISOString()}::timestamptz`;
  if (shouldSuspend(rows.map((r) => r.created_at as Date), new Date(Math.max(now.getTime(), Date.now())), ctx.config)) {
    const until = new Date(now.getTime() + 7 * 86_400_000);
    await tx`UPDATE users SET status = 'suspended', suspended_until = ${until.toISOString()}::timestamptz WHERE id = ${professionalId}`;
  }
}


// ------------------------------------------------------------------ reenvio ao próximo profissional
const tzDate = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10); // dia em São Paulo (UTC-3)

/**
 * Quando o profissional recusa ou deixa o prazo vencer, a oferta segue para o próximo do ranking
 * (até o máximo de tentativas), mantendo o valor já pago pelo cliente. Devolve `true` se reenviou;
 * `false` se não há candidato ou as tentativas acabaram (aí o chamador encerra e estorna).
 */
export async function redirectOffer(ctx: Ctx, bookingId: string, trigger: 'declined' | 'expired', actorId: string | null): Promise<boolean> {
  return inTransaction(ctx.sql, async (tx) => {
    const b = await loadBooking(tx, bookingId, true);
    if (b.status !== 'requested' || afterUnaccepted(b.attempt, ctx.config) !== 'resend') return false;

    const offered = await tx`
      SELECT metadata->>'professional_id' AS pid FROM booking_events WHERE booking_id = ${b.id} AND type = 'booking.offered'`;
    const already = new Set(offered.map((r) => r.pid as string));
    already.add(b.professional_id);

    const ranked = await searchProfessionals(
      tx,
      { category: b.category_slug, date: tzDate(b.starts_at), lat: b.addr_lat, lng: b.addr_lng, clientId: b.client_id, limit: 50 },
      ctx.config,
    );
    let next: string | null = null;
    for (const cand of ranked) {
      if (already.has(cand.professional_id) || cand.daily_rate_cents > b.daily_rate_cents) continue;
      const busy = await tx`
        SELECT 1 FROM bookings WHERE professional_id = ${cand.professional_id} AND status IN ('accepted','en_route','in_progress')
          AND tstzrange(starts_at, ends_at) && tstzrange(${b.starts_at.toISOString()}::timestamptz, ${b.ends_at.toISOString()}::timestamptz) LIMIT 1`;
      if (!busy[0]) {
        next = cand.professional_id;
        break;
      }
    }
    if (!next) return false;

    const attempt = b.attempt + 1;
    await tx`
      UPDATE bookings SET professional_id = ${next}, attempt = ${attempt}, version = version + 1,
             accept_deadline_at = ${acceptDeadline(ctx.now(), b.starts_at, ctx.config).toISOString()}::timestamptz
      WHERE id = ${b.id}`;
    await recordEvent(tx, b.id, 'booking.resent', 'requested', 'requested', actorId, actorId ? 'professional' : 'system',
      { trigger, from_professional_id: b.professional_id, to_professional_id: next, attempt });
    await recordEvent(tx, b.id, 'booking.offered', null, null, null, 'system', { professional_id: next, attempt });
    return true;
  });
}

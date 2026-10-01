import { DEFAULT_CONFIG, quote as makeQuote, type BookingAction } from '@diaria/core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { ApiError, conflict, forbidden, notFound } from './errors';
import {
  createAddress, deleteAccount, deleteAddress, getMe, getProfessionalSetup, removeOffer, setWeekly, kycDecision, kycQueue, listAddresses, register, setAvailability, setVisibility,
  upsertOffer, upsertProfessionalProfile,
} from './services/accounts';
import { createMockProvider } from './payments/provider';
import { applyAction, createBooking, getBooking, listBookings, redirectOffer } from './services/bookings';
import { adminBookings, adminOverview, adminSchedule } from './services/admin';
import {
  adminAudit, adminCategories, adminClientDetail, adminClients, adminConfig, adminProfessionalDetail, adminProfessionals, createCategory,
  platformOverview, resetConfig, setConfig, setProfessionalVisible, setUserStatus, updateCategory,
} from './services/manage';
import { loadConfig } from './services/settings';
import { acceptInvite, inviteMember, listTeam, revokeInvite, setMemberLevel, setMemberStatus } from './services/team';
import { handlePaymentEvent } from './services/payments';
import { searchProfessionals } from './services/search';
import type { AuthUser, Ctx, Deps, Identity, Role } from './types';

type Env = { Variables: { user?: AuthUser; identity?: Identity; requestId: string } };

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ApiError(400, 'validation_failed', 'Dados inválidos', {
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

async function jsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, 'validation_failed', 'Corpo da requisição deve ser JSON válido');
  }
}

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato AAAA-MM-DD');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use o formato HH:MM');
const coords = { lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) };

const quoteBody = z.object({ professional_id: uuid, category: z.string().min(1) });
const createBody = z.object({
  professional_id: uuid,
  category: z.string().min(1),
  address_id: uuid,
  date,
  start_time: time,
  duration_minutes: z.number().int().min(60).max(720),
  description: z.string().trim().min(5).max(1000),
});
// ---- gestão (painel)
const blankToUndefined = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== ''));
const pageQuery = {
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};
const proListQuery = z.object({
  ...pageQuery,
  kyc: z.enum(['incomplete', 'pending', 'approved', 'rejected']).optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  visible: z.enum(['true', 'false']).optional(),
  service: z.string().max(60).optional(),
});
const clientListQuery = z.object({ ...pageQuery, status: z.enum(['active', 'suspended', 'deleted']).optional() });
const suspendBody = z.object({ reason: z.string().trim().min(3, 'informe o motivo').max(300) });
const reactivateBody = z.object({ reason: z.string().trim().max(300).optional() });
const visibleBody = z.object({ visible: z.boolean(), reason: z.string().trim().max(300).optional() });
const categoryPatch = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  min_daily_rate_cents: z.number().int().min(0).max(10_000_000).optional(),
  max_daily_rate_cents: z.number().int().min(0).max(10_000_000).optional(),
  min_photos_checkout: z.number().int().min(0).max(10).optional(),
  active: z.boolean().optional(),
});
const categoryCreate = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use letras minúsculas, números e hífen').min(2).max(40),
  name: z.string().trim().min(2).max(60),
  min_daily_rate_cents: z.number().int().min(0).max(10_000_000),
  max_daily_rate_cents: z.number().int().min(0).max(10_000_000),
  min_photos_checkout: z.number().int().min(0).max(10).default(1),
});
const configBody = z.object({ value: z.number().int() });
const levelSchema = z.enum(['owner', 'operator']);
const inviteBody = z.object({ full_name: z.string().trim().min(3, 'informe o nome').max(120), phone: z.string().trim().min(8).max(30), level: levelSchema.default('operator') });
const levelBody = z.object({ level: levelSchema });

const searchQuery = z
  .object({
    category: z.string().min(1),
    date,
    address_id: uuid.optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((q) => q.address_id || (q.lat !== undefined && q.lng !== undefined), { message: 'informe address_id ou lat e lng' });

// Ações por rota, com o corpo esperado de cada uma.
const ACTIONS: Record<string, { action: BookingAction | 'cancel'; body: z.ZodTypeAny }> = {
  accept: { action: 'accept', body: z.object({}).passthrough() },
  decline: { action: 'decline', body: z.object({ reason: z.string().max(300).optional() }) },
  'en-route': { action: 'en_route', body: z.object({}).passthrough() },
  'check-in': { action: 'check_in', body: z.object({ ...coords, accuracy_m: z.number().int().min(0).optional() }) },
  'check-out': {
    action: 'check_out',
    body: z.object({ ...coords, photo_keys: z.array(z.string().min(1)).max(20), note: z.string().max(500).optional() }),
  },
  approve: { action: 'approve', body: z.object({}).passthrough() },
  'report-client-no-show': { action: 'no_show_client', body: z.object({}).passthrough() },
  cancel: { action: 'cancel', body: z.object({ reason: z.string().max(300).optional() }) },
};

const userOf = (c: { get(k: 'user'): AuthUser | undefined }): AuthUser => {
  const u = c.get('user');
  if (!u) throw new ApiError(401, 'unauthenticated', 'Faça login para continuar');
  return u;
};

/** Exige um dos papéis informados (a operação, admin, também pode agir como cliente ou profissional? não: cada rota decide). */
const needRole = (c: { get(k: 'user'): AuthUser | undefined }, ...roles: Role[]): AuthUser => {
  const u = userOf(c);
  if (!roles.includes(u.role)) throw forbidden('Seu tipo de conta não permite esta ação');
  return u;
};

/** Exige administrador (owner). Operadores fazem a rotina, mas não mexem em equipe, serviços nem parâmetros. */
const needOwner = (c: { get(k: 'user'): AuthUser | undefined }): AuthUser => {
  const u = needRole(c, 'admin');
  if (u.adminLevel !== 'owner') throw forbidden('Somente administradores podem fazer isso');
  return u;
};

const registerBody = z.object({
  role: z.enum(['client', 'professional']),
  full_name: z.string().trim().min(3).max(120),
  email: z.string().email().max(200).optional(),
  accepted_terms_version: z.string().min(1).max(40),
  client_kind: z.enum(['person', 'company']).optional(),
  cnpj: z.string().max(20).optional(),
});
const addressBody = z.object({
  label: z.string().max(60).optional(),
  street: z.string().trim().min(2).max(160),
  number: z.string().max(20).optional(),
  complement: z.string().max(80).optional(),
  district: z.string().max(80).optional(),
  city: z.string().trim().min(2).max(80),
  state: z.string().length(2),
  zip: z.string().max(12).optional(),
  reference: z.string().max(160).optional(),
  ...coords,
});
const professionalProfileBody = z.object({
  bio: z.string().max(500).optional(),
  ...coords,
  radius_km: z.number().int().min(1).max(50),
  pix_key: z.string().trim().min(5).max(140),
});
const offerBody = z.object({ daily_rate_cents: z.number().int().positive(), description: z.string().max(300).optional() });
const availabilityBody = z.object({ start_time: time, end_time: time });
const weeklyBody = z.object({ days: z.array(z.number().int().min(1).max(7)).max(7), start_time: time, end_time: time });
const visibilityBody = z.object({ visible: z.boolean() });
const kycBody = z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().max(300).optional() });

export function createApp(deps: Deps) {
  const ctx: Ctx = {
    sql: deps.sql,
    now: deps.now ?? (() => new Date()),
    config: deps.config ?? DEFAULT_CONFIG,
    provider: deps.paymentProvider ?? createMockProvider(),
    verifyPhotoUploads: deps.verifyPhotoUploads ?? false,
  };
  const app = new Hono<Env>();

  // Parâmetros alterados no painel (tabela config_settings) valem para as próximas requisições.
  const baseConfig = ctx.config;
  if (deps.dbConfig) {
    app.use('*', async (_c, next) => {
      ctx.config = await loadConfig(deps.sql, baseConfig);
      await next();
    });
  }

  app.use('*', async (c, next) => {
    c.set('requestId', `req_${crypto.randomUUID().slice(0, 12)}`);
    await next();
  });

  app.onError((err, c) => {
    const requestId = c.get('requestId');
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details ?? {}, request_id: requestId } }, err.status as 400);
    }
    console.error(requestId, err);
    return c.json({ error: { code: 'internal_error', message: 'Erro interno. Tente novamente.', details: {}, request_id: requestId } }, 500);
  });

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Rota não encontrada', details: {}, request_id: c.get('requestId') } }, 404));

  // ---- públicas
  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/v1/categories', async (c) => {
    const rows = await ctx.sql`
      SELECT slug, name, min_daily_rate_cents, max_daily_rate_cents, min_photos_checkout, checklist
      FROM service_categories WHERE active ORDER BY name`;
    return c.json({ items: rows });
  });

  // ---- autenticadas
  // CORS: só as origens autorizadas (o painel web). O app em Expo não usa navegador e não precisa.
  const allowed = deps.corsOrigins ?? [];
  if (allowed.length > 0) {
    app.use('/v1/*', cors({
      origin: (origin) => (allowed.includes(origin) ? origin : null),
      allowHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-app-version'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }));
  }

  // Rotas que aceitam quem tem login válido mas ainda não completou o cadastro.
  const IDENTITY_ONLY = new Set(['/v1/me', '/v1/me/register', '/v1/admin/accept-invite']);

  app.use('/v1/*', async (c, next) => {
    if (c.req.path === '/v1/categories') return next();
    const user = await deps.authenticate(c.req.raw);
    if (user) {
      c.set('user', user);
      return next();
    }
    if (IDENTITY_ONLY.has(c.req.path) && deps.identify) {
      const identity = await deps.identify(c.req.raw);
      if (identity) {
        c.set('identity', identity);
        return next();
      }
    }
    throw new ApiError(401, 'unauthenticated', 'Faça login para continuar');
  });

  app.get('/v1/me', async (c) => {
    const user = c.get('user');
    if (user) return c.json(await getMe(ctx, user));
    const identity = c.get('identity');
    return c.json({ registered: false, id: identity?.id, phone: identity?.phone ?? null, next_step: 'register' });
  });

  app.delete('/v1/me', async (c) => c.json(await deleteAccount(ctx, userOf(c))));

  app.post('/v1/me/register', async (c) => {
    if (c.get('user')) throw conflict('already_registered', 'Este usuário já está cadastrado');
    const identity = c.get('identity');
    if (!identity) throw new ApiError(401, 'unauthenticated', 'Faça login para continuar');
    const b = parse(registerBody, await jsonBody(c.req.raw));
    const me = await register(ctx, identity, {
      role: b.role, fullName: b.full_name, email: b.email, termsVersion: b.accepted_terms_version, clientKind: b.client_kind, cnpj: b.cnpj,
    });
    return c.json(me, 201);
  });

  // ---- cliente: endereços
  app.get('/v1/client/addresses', async (c) => c.json({ items: await listAddresses(ctx, needRole(c, 'client').id) }));
  app.post('/v1/client/addresses', async (c) => {
    const user = needRole(c, 'client');
    const b = parse(addressBody, await jsonBody(c.req.raw));
    return c.json(await createAddress(ctx, user.id, b), 201);
  });
  app.delete('/v1/client/addresses/:id', async (c) => {
    const user = needRole(c, 'client');
    await deleteAddress(ctx, user.id, parse(uuid, c.req.param('id')));
    return c.body(null, 204);
  });

  // ---- profissional: perfil, serviços, agenda e visibilidade
  app.put('/v1/professional/profile', async (c) => {
    const user = needRole(c, 'professional');
    const b = parse(professionalProfileBody, await jsonBody(c.req.raw));
    return c.json(await upsertProfessionalProfile(ctx, user.id, { bio: b.bio, lat: b.lat, lng: b.lng, radiusKm: b.radius_km, pixKey: b.pix_key }));
  });
  app.put('/v1/professional/offers/:category', async (c) => {
    const user = needRole(c, 'professional');
    const b = parse(offerBody, await jsonBody(c.req.raw));
    return c.json(await upsertOffer(ctx, user.id, c.req.param('category'), b.daily_rate_cents, b.description));
  });
  app.get('/v1/professional/setup', async (c) => c.json(await getProfessionalSetup(ctx, needRole(c, 'professional').id)));
  app.put('/v1/professional/availability/weekly', async (c) => {
    const user = needRole(c, 'professional');
    const b = parse(weeklyBody, await jsonBody(c.req.raw));
    return c.json(await setWeekly(ctx, user.id, b.days, b.start_time, b.end_time));
  });
  app.delete('/v1/professional/offers/:category', async (c) => {
    await removeOffer(ctx, needRole(c, 'professional').id, c.req.param('category'));
    return c.body(null, 204);
  });
  app.put('/v1/professional/availability/:day', async (c) => {
    const user = needRole(c, 'professional');
    const day = parse(date, c.req.param('day'));
    const b = parse(availabilityBody, await jsonBody(c.req.raw));
    return c.json(await setAvailability(ctx, user.id, day, b.start_time, b.end_time));
  });
  app.put('/v1/professional/status', async (c) => {
    const user = needRole(c, 'professional');
    const b = parse(visibilityBody, await jsonBody(c.req.raw));
    return c.json(await setVisibility(ctx, user.id, b.visible));
  });

  // ---- operação: verificação de profissionais
  app.get('/v1/admin/kyc/queue', async (c) => {
    needRole(c, 'admin');
    return c.json({ items: await kycQueue(ctx) });
  });
  const dayQuery = (v: string | undefined, fallback: Date) => (v ? parse(date, v) : new Date(fallback.getTime() - 3 * 3_600_000).toISOString().slice(0, 10));
  app.get('/v1/admin/overview', async (c) => {
    needRole(c, 'admin');
    return c.json(await adminOverview(ctx, dayQuery(c.req.query('date'), ctx.now())));
  });
  app.get('/v1/admin/bookings', async (c) => {
    needRole(c, 'admin');
    const day = c.req.query('date');
    const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
    return c.json({ items: await adminBookings(ctx, { date: day ? parse(date, day) : undefined, status: c.req.query('status') || undefined, limit }) });
  });
  app.get('/v1/admin/schedule', async (c) => {
    needRole(c, 'admin');
    return c.json(await adminSchedule(ctx, dayQuery(c.req.query('date'), ctx.now())));
  });
  const query = (c: { req: { url: string } }) => blankToUndefined(Object.fromEntries(new URL(c.req.url).searchParams));

  // ---- gestão de profissionais, clientes e plataforma (somente administrador)
  app.get('/v1/admin/professionals', async (c) => {
    needRole(c, 'admin');
    const q = parse(proListQuery, query(c));
    return c.json(await adminProfessionals(ctx, { q: q.q, kyc: q.kyc, status: q.status, visible: q.visible === undefined ? undefined : q.visible === 'true', service: q.service }, q.limit, q.offset));
  });
  app.get('/v1/admin/professionals/:id', async (c) => {
    needRole(c, 'admin');
    return c.json(await adminProfessionalDetail(ctx, parse(uuid, c.req.param('id'))));
  });
  app.put('/v1/admin/professionals/:id/visible', async (c) => {
    const admin = needRole(c, 'admin');
    const b = parse(visibleBody, await jsonBody(c.req.raw));
    return c.json(await setProfessionalVisible(ctx, admin, parse(uuid, c.req.param('id')), b.visible, b.reason));
  });
  app.get('/v1/admin/clients', async (c) => {
    needRole(c, 'admin');
    const q = parse(clientListQuery, query(c));
    return c.json(await adminClients(ctx, { q: q.q, status: q.status }, q.limit, q.offset));
  });
  app.get('/v1/admin/clients/:id', async (c) => {
    needRole(c, 'admin');
    return c.json(await adminClientDetail(ctx, parse(uuid, c.req.param('id'))));
  });
  app.post('/v1/admin/users/:id/suspend', async (c) => {
    const admin = needRole(c, 'admin');
    const b = parse(suspendBody, await jsonBody(c.req.raw));
    return c.json(await setUserStatus(ctx, admin, parse(uuid, c.req.param('id')), 'suspend', b.reason));
  });
  app.post('/v1/admin/users/:id/reactivate', async (c) => {
    const admin = needRole(c, 'admin');
    const b = parse(reactivateBody, await jsonBody(c.req.raw).catch(() => ({})));
    return c.json(await setUserStatus(ctx, admin, parse(uuid, c.req.param('id')), 'reactivate', b.reason));
  });
  app.get('/v1/admin/platform/overview', async (c) => {
    needRole(c, 'admin');
    const days = parse(z.coerce.number().int().min(7).max(90).default(30), query(c).days);
    return c.json(await platformOverview(ctx, days));
  });
  app.get('/v1/admin/categories', async (c) => {
    needRole(c, 'admin');
    return c.json({ items: await adminCategories(ctx) });
  });
  app.post('/v1/admin/categories', async (c) => {
    const admin = needOwner(c);
    return c.json(await createCategory(ctx, admin, parse(categoryCreate, await jsonBody(c.req.raw))), 201);
  });
  app.put('/v1/admin/categories/:slug', async (c) => {
    const admin = needOwner(c);
    return c.json(await updateCategory(ctx, admin, c.req.param('slug'), parse(categoryPatch, await jsonBody(c.req.raw))));
  });
  app.get('/v1/admin/config', async (c) => {
    needRole(c, 'admin');
    return c.json({ items: await adminConfig(ctx) });
  });
  app.put('/v1/admin/config/:key', async (c) => {
    const admin = needOwner(c);
    const b = parse(configBody, await jsonBody(c.req.raw));
    return c.json(await setConfig(ctx, admin, c.req.param('key'), b.value));
  });
  app.delete('/v1/admin/config/:key', async (c) => {
    const admin = needOwner(c);
    return c.json(await resetConfig(ctx, admin, c.req.param('key')));
  });
  // ---- equipe da operação
  app.get('/v1/admin/team', async (c) => c.json(await listTeam(ctx, needRole(c, 'admin'))));
  app.post('/v1/admin/team/invites', async (c) => {
    const owner = needOwner(c);
    const b = parse(inviteBody, await jsonBody(c.req.raw));
    return c.json(await inviteMember(ctx, owner, { fullName: b.full_name, phone: b.phone, level: b.level }), 201);
  });
  app.delete('/v1/admin/team/invites/:id', async (c) => {
    await revokeInvite(ctx, needOwner(c), parse(uuid, c.req.param('id')));
    return c.body(null, 204);
  });
  app.put('/v1/admin/team/members/:id', async (c) => {
    const owner = needOwner(c);
    const b = parse(levelBody, await jsonBody(c.req.raw));
    return c.json(await setMemberLevel(ctx, owner, parse(uuid, c.req.param('id')), b.level));
  });
  app.post('/v1/admin/team/members/:id/deactivate', async (c) => c.json(await setMemberStatus(ctx, needOwner(c), parse(uuid, c.req.param('id')), 'deactivate')));
  app.post('/v1/admin/team/members/:id/reactivate', async (c) => c.json(await setMemberStatus(ctx, needOwner(c), parse(uuid, c.req.param('id')), 'reactivate')));
  app.post('/v1/admin/accept-invite', async (c) => {
    if (c.get('user')) throw conflict('already_registered', 'Este usuário já está cadastrado');
    const identity = c.get('identity');
    if (!identity) throw new ApiError(401, 'unauthenticated', 'Faça login para continuar');
    return c.json(await acceptInvite(ctx, identity), 201);
  });

  app.get('/v1/admin/audit', async (c) => {
    needRole(c, 'admin');
    const limit = parse(z.coerce.number().int().min(1).max(200).default(50), query(c).limit);
    return c.json({ items: await adminAudit(ctx, { limit }) });
  });

  app.post('/v1/admin/kyc/:userId/decision', async (c) => {
    const admin = needRole(c, 'admin');
    const b = parse(kycBody, await jsonBody(c.req.raw));
    return c.json(await kycDecision(ctx, admin, parse(uuid, c.req.param('userId')), b.decision, b.reason));
  });

  app.post('/v1/bookings/quote', async (c) => {
    const body = parse(quoteBody, await jsonBody(c.req.raw));
    const rows = await ctx.sql`
      SELECT o.daily_rate_cents FROM service_offers o
      JOIN service_categories cat ON cat.id = o.category_id AND cat.slug = ${body.category}
      WHERE o.professional_id = ${body.professional_id} AND o.active`;
    if (!rows[0]) throw notFound('Oferta do profissional');
    return c.json(makeQuote(Number(rows[0].daily_rate_cents), ctx.config));
  });

  app.get('/v1/search/professionals', async (c) => {
    const user = needRole(c, 'client');
    const q = parse(searchQuery, Object.fromEntries(new URL(c.req.url).searchParams));
    const items = await searchProfessionals(
      ctx.sql,
      { category: q.category, date: q.date, lat: q.lat, lng: q.lng, addressId: q.address_id, clientId: user.id, limit: q.limit },
      ctx.config,
    );
    return c.json({ items });
  });

  app.post('/v1/bookings', async (c) => {
    const client = needRole(c, 'client');
    const body = parse(createBody, await jsonBody(c.req.raw));
    const view = await createBooking(ctx, client, {
      professionalId: body.professional_id,
      category: body.category,
      addressId: body.address_id,
      date: body.date,
      startTime: body.start_time,
      durationMinutes: body.duration_minutes,
      description: body.description,
    });
    return c.json(view, 201);
  });

  app.get('/v1/bookings', async (c) => {
    const params = new URL(c.req.url).searchParams;
    const limit = Math.min(Number(params.get('limit') ?? 20) || 20, 50);
    return c.json({ items: await listBookings(ctx, userOf(c), { status: params.get('status') ?? undefined, limit }) });
  });

  app.get('/v1/bookings/:id', async (c) => {
    const id = parse(uuid, c.req.param('id'));
    return c.json(await getBooking(ctx, userOf(c), id));
  });

  app.post('/v1/bookings/:id/:action', async (c) => {
    const user = userOf(c);
    const id = parse(uuid, c.req.param('id'));
    const route = ACTIONS[c.req.param('action')];
    if (!route) throw notFound('Ação');
    const raw = c.req.header('content-length') === '0' ? {} : await jsonBody(c.req.raw).catch(() => ({}));
    const body = parse(route.body, raw) as Record<string, unknown>;

    // Recusa: primeiro tenta passar a oferta ao próximo profissional; se não houver, encerra e estorna.
    if (route.action === 'decline') {
      const row = (await ctx.sql`SELECT professional_id, status FROM bookings WHERE id = ${id}`)[0];
      if (!row) throw notFound('Pedido');
      if (user.role === 'professional' && row.professional_id === user.id && row.status === 'requested') {
        if (await redirectOffer(ctx, id, 'declined', user.id)) return c.json({ id, status: 'declined', resent: true });
      }
    }

    let action: BookingAction;
    if (route.action === 'cancel') {
      const rows = await ctx.sql`SELECT client_id, professional_id FROM bookings WHERE id = ${id}`;
      if (!rows[0]) throw notFound('Pedido');
      action = user.id === rows[0].professional_id && user.role !== 'admin' ? 'cancel_by_professional' : 'cancel_by_client';
    } else {
      action = route.action;
    }
    return c.json(await applyAction(ctx, { bookingId: id, action, user, body }));
  });

  // ---- webhook do provedor de pagamentos (fora de /v1: a autenticidade vem da assinatura, não do login)
  app.post('/webhooks/payments', async (c) => {
    const raw = await c.req.text();
    const evt = await ctx.provider.verifyWebhook(raw, c.req.raw.headers);
    if (!evt) return c.json({ ok: true, ignored: true });
    return c.json({ ok: true, ...(await handlePaymentEvent(ctx, evt)) });
  });

  // ---- desenvolvimento: simula o webhook de pagamento confirmado do provedor
  if (deps.devRoutes) {
    app.post('/v1/dev/bookings/:id/confirm-payment', async (c) => {
      const id = parse(uuid, c.req.param('id'));
      await applyAction(ctx, { bookingId: id, action: 'payment_confirmed', user: null });
      return c.json(await getBooking(ctx, userOf(c), id));
    });
  }

  return app;
}

export type App = ReturnType<typeof createApp>;

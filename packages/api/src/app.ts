import { DEFAULT_CONFIG, quote as makeQuote, type BookingAction } from '@diaria/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { ApiError, forbidden, notFound } from './errors';
import { applyAction, createBooking, getBooking, listBookings } from './services/bookings';
import { searchProfessionals } from './services/search';
import type { AuthUser, Ctx, Deps } from './types';

type Env = { Variables: { user: AuthUser; requestId: string } };

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
  cancel: { action: 'cancel', body: z.object({ reason: z.string().max(300).optional() }) },
};

export function createApp(deps: Deps) {
  const ctx: Ctx = { sql: deps.sql, now: deps.now ?? (() => new Date()), config: deps.config ?? DEFAULT_CONFIG };
  const app = new Hono<Env>();

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
  app.use('/v1/*', async (c, next) => {
    if (c.req.path === '/v1/categories') return next();
    const user = await deps.authenticate(c.req.raw);
    if (!user) throw new ApiError(401, 'unauthenticated', 'Faça login para continuar');
    c.set('user', user);
    await next();
  });

  app.get('/v1/me', (c) => c.json(c.get('user')));

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
    const user = c.get('user');
    if (user.role !== 'client') throw forbidden('Somente clientes fazem buscas');
    const q = parse(searchQuery, Object.fromEntries(new URL(c.req.url).searchParams));
    const items = await searchProfessionals(
      ctx.sql,
      { category: q.category, date: q.date, lat: q.lat, lng: q.lng, addressId: q.address_id, clientId: user.id, limit: q.limit },
      ctx.config,
    );
    return c.json({ items });
  });

  app.post('/v1/bookings', async (c) => {
    const body = parse(createBody, await jsonBody(c.req.raw));
    const view = await createBooking(ctx, c.get('user'), {
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
    return c.json({ items: await listBookings(ctx, c.get('user'), { status: params.get('status') ?? undefined, limit }) });
  });

  app.get('/v1/bookings/:id', async (c) => {
    const id = parse(uuid, c.req.param('id'));
    return c.json(await getBooking(ctx, c.get('user'), id));
  });

  app.post('/v1/bookings/:id/:action', async (c) => {
    const user = c.get('user');
    const id = parse(uuid, c.req.param('id'));
    const route = ACTIONS[c.req.param('action')];
    if (!route) throw notFound('Ação');
    const raw = c.req.header('content-length') === '0' ? {} : await jsonBody(c.req.raw).catch(() => ({}));
    const body = parse(route.body, raw) as Record<string, unknown>;

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

  // ---- desenvolvimento: simula o webhook de pagamento confirmado do provedor
  if (deps.devRoutes) {
    app.post('/v1/dev/bookings/:id/confirm-payment', async (c) => {
      const id = parse(uuid, c.req.param('id'));
      await applyAction(ctx, { bookingId: id, action: 'payment_confirmed', user: null });
      return c.json(await getBooking(ctx, c.get('user'), id));
    });
  }

  return app;
}

export type App = ReturnType<typeof createApp>;

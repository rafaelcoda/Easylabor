import { DEFAULT_CONFIG } from '@diaria/core';
import { createApp } from '../src/app';
import { createMockProvider, type PaymentProvider } from '../src/payments/provider';
import { createSql, type Sql } from '../src/db';
import type { AuthUser } from '../src/types';
import { TEST_DB } from './globalSetup';

export const clock = { now: new Date('2026-10-19T12:00:00Z') };
export const DAY = '2026-10-20';
export const STARTS_AT = new Date('2026-10-20T11:00:00Z'); // 08:00 em São Paulo

export function makeSql(): Sql {
  return createSql(`postgres://${process.env.TEST_PG_USER ?? 'root'}@localhost/${TEST_DB}`, {
    host: process.env.TEST_PG_HOST ?? '/var/run/postgresql',
    max: 4,
    onnotice: () => {},
  });
}

export function makeApp(sql: Sql, devRoutes = true, paymentProvider?: PaymentProvider, extra: { verifyPhotoUploads?: boolean } = {}) {
  return createApp({
    sql,
    devRoutes,
    paymentProvider,
    ...extra,
    now: () => clock.now,
    // Simula o Supabase Auth: o cabeçalho x-test-auth-id (e x-test-phone) representa um token válido.
    identify: async (req) => {
      const id = req.headers.get('x-test-auth-id');
      return id ? { id, phone: req.headers.get('x-test-phone') } : null;
    },
    authenticate: async (req): Promise<AuthUser | null> => {
      const id = req.headers.get('x-test-user');
      if (!id) return null;
      const r = await sql`SELECT id, role FROM users WHERE id = ${id} AND status = 'active'`;
      return r[0] ? ({ id: r[0].id, role: r[0].role } as AuthUser) : null;
    },
  });
}

export interface World {
  client: string;
  otherClient: string;
  pro: string;
  pro2: string;
  admin: string;
  address: string;
}

const PRO_LOC = { lng: -40.28, lat: -20.275 };
export const ADDRESS_LOC = { lng: -40.2785, lat: -20.2731 };

export async function seedWorld(sql: Sql): Promise<World> {
  await sql`TRUNCATE users CASCADE`;
  const mk = async (role: string, name: string, phone: string) =>
    (await sql`
      INSERT INTO users (role, full_name, phone, accepted_terms_version, accepted_terms_at)
      VALUES (${role}, ${name}, ${phone}, 'v1', now()) RETURNING id`)[0]!.id as string;
  const client = await mk('client', 'Cliente Um', '+5527900000001');
  const otherClient = await mk('client', 'Cliente Dois', '+5527900000002');
  const pro = await mk('professional', 'Marcos S.', '+5527900000003');
  const pro2 = await mk('professional', 'Rafaela T.', '+5527900000004');
  const admin = await mk('admin', 'Operação', '+5527900000005');
  for (const c of [client, otherClient]) await sql`INSERT INTO client_profiles (user_id, kind) VALUES (${c}, 'person')`;
  const address = (await sql`
    INSERT INTO addresses (client_id, street, number, district, city, state, location)
    VALUES (${client}, 'Rua das Flores', '120', 'Jardim Camburi', 'Vitória', 'ES',
            ST_SetSRID(ST_MakePoint(${ADDRESS_LOC.lng}, ${ADDRESS_LOC.lat}), 4326)::geography) RETURNING id`)[0]!.id as string;
  for (const p of [pro, pro2]) {
    await sql`
      INSERT INTO professional_profiles (user_id, base_location, radius_km, kyc_status, pix_key, visible, rating_avg, rating_count, acceptance_rate, attendance_rate)
      VALUES (${p}, ST_SetSRID(ST_MakePoint(${PRO_LOC.lng}, ${PRO_LOC.lat}), 4326)::geography, 10, 'approved', '123', true, 4.8, 10, 0.9, 0.98)`;
    await sql`INSERT INTO service_offers (professional_id, category_id, daily_rate_cents)
              SELECT ${p}, id, 20000 FROM service_categories WHERE slug = 'pintor'`;
    await sql`INSERT INTO availabilities (professional_id, day, start_time, end_time) VALUES (${p}, ${DAY}::date, '06:00', '20:00')`;
  }
  return { client, otherClient, pro, pro2, admin, address };
}

export async function call(
  app: ReturnType<typeof makeApp>, method: string, path: string, userId: string | null, body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...extraHeaders };
  if (userId) headers['x-test-user'] = userId;
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

export const bookingBody = (w: World, over: Record<string, unknown> = {}) => ({
  professional_id: w.pro,
  category: 'pintor',
  address_id: w.address,
  date: DAY,
  start_time: '08:00',
  duration_minutes: 480,
  description: 'Pintar sala e corredor, 45 m².',
  ...over,
});

/** Cria o pedido e simula o pagamento confirmado. */
export async function paidBooking(app: ReturnType<typeof makeApp>, w: World, over: Record<string, unknown> = {}) {
  const created = await call(app, 'POST', '/v1/bookings', w.client, bookingBody(w, over));
  if (created.status !== 201) throw new Error(`falha ao criar: ${JSON.stringify(created.json)}`);
  const paid = await call(app, 'POST', `/v1/dev/bookings/${created.json.id}/confirm-payment`, w.client);
  if (paid.status !== 200) throw new Error(`falha ao pagar: ${JSON.stringify(paid.json)}`);
  return paid.json as { id: string; status: string };
}

export async function ledgerBalance(sql: Sql, bookingId: string, account: string): Promise<number> {
  const r = await sql`
    SELECT COALESCE(SUM(CASE direction WHEN 'debit' THEN amount_cents ELSE -amount_cents END), 0) AS b
    FROM ledger_entries WHERE booking_id = ${bookingId} AND account = ${account}`;
  return Number(r[0]!.b);
}

/** Login simulado de alguém ainda sem cadastro (token válido do Supabase Auth). */
export const asIdentity = (authId: string, phone: string | null) => ({ 'x-test-auth-id': authId, ...(phone ? { 'x-test-phone': phone } : {}) });

export async function seedAdminOnly(sql: Sql): Promise<string> {
  await sql`TRUNCATE users CASCADE`;
  const r = await sql`
    INSERT INTO users (role, full_name, phone, accepted_terms_version, accepted_terms_at)
    VALUES ('admin', 'Operação', '+5527900000099', 'v1', now()) RETURNING id`;
  return r[0]!.id as string;
}

export const WEBHOOK_SECRET = 'segredo-de-teste';
export const testProvider = () => createMockProvider({ webhookSecret: WEBHOOK_SECRET });

/** Contexto para chamar as rotinas e serviços diretamente, com o relógio de teste. */
export function makeCtx(sql: Sql, provider: PaymentProvider = testProvider()) {
  return { sql, now: () => clock.now, config: DEFAULT_CONFIG, provider, verifyPhotoUploads: false };
}

/** Chaves de foto no formato exigido: <usuário>/<pedido>/<arquivo>. */
export const photoKeys = (userId: string, bookingId: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${userId}/${bookingId}/foto-${i + 1}.jpg`);

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/db';
import { clock, makeSql, paidBooking, seedWorld, makeApp, call, ADDRESS_LOC, STARTS_AT, type World } from './helpers';

/**
 * Testa as regras de acesso às fotos (funções do schema "private") com um auth.uid() simulado,
 * já que o PostgreSQL de teste não tem o schema "auth" do Supabase. As políticas em storage.objects
 * são conferidas no próprio Supabase, ao aplicar a migração.
 */
let sql: Sql;
let w: World;
const app = () => makeApp(sql);

beforeAll(async () => {
  sql = makeSql();
  await sql.unsafe(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$ LANGUAGE sql STABLE;`);
});
afterAll(async () => {
  await sql.unsafe('DROP SCHEMA auth CASCADE');
  await sql.end();
});
beforeEach(async () => {
  clock.now = new Date('2026-10-19T12:00:00Z');
  w = await seedWorld(sql);
});

/** Executa uma consulta como se o usuário `uid` estivesse logado. */
async function as<T>(uid: string | null, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claim.sub', ${uid ?? ''}, true)`;
    return fn(tx as unknown as Sql);
  }) as Promise<T>;
}
const can = (uid: string | null, fnName: 'can_read_booking_photo' | 'can_upload_booking_photo', path: string) =>
  as(uid, async (tx) => (await tx.unsafe(`select private.${fnName}($1) as ok`, [path]))[0]!.ok as boolean);

async function inProgress() {
  const a = app();
  const b = await paidBooking(a, w);
  await call(a, 'POST', `/v1/bookings/${b.id}/accept`, w.pro);
  clock.now = new Date(STARTS_AT.getTime() - 10 * 60_000);
  await call(a, 'POST', `/v1/bookings/${b.id}/check-in`, w.pro, ADDRESS_LOC);
  return b.id;
}

describe('regras de acesso às fotos', () => {
  it('o caminho precisa ter o id do pedido; lixo vira nulo', async () => {
    const r = (await sql`select private.photo_booking_id('u/nao-e-uuid/a.jpg') as a, private.photo_booking_id('u') as b`)[0]!;
    expect(r).toMatchObject({ a: null, b: null });
  });

  it('só o profissional do pedido envia, na própria pasta e com o serviço em execução', async () => {
    const id = await inProgress();
    expect(await can(w.pro, 'can_upload_booking_photo', `${w.pro}/${id}/a.jpg`)).toBe(true);
    expect(await can(w.pro2, 'can_upload_booking_photo', `${w.pro2}/${id}/a.jpg`)).toBe(false); // outro profissional
    expect(await can(w.pro, 'can_upload_booking_photo', `${w.pro2}/${id}/a.jpg`)).toBe(false); // pasta de outro
    expect(await can(w.client, 'can_upload_booking_photo', `${w.client}/${id}/a.jpg`)).toBe(false); // cliente
    expect(await can(null, 'can_upload_booking_photo', `${w.pro}/${id}/a.jpg`)).toBe(false); // sem login
  });

  it('não envia fora da execução (antes do check-in ou depois do check-out)', async () => {
    const a = app();
    const b = await paidBooking(a, w);
    await call(a, 'POST', `/v1/bookings/${b.id}/accept`, w.pro);
    expect(await can(w.pro, 'can_upload_booking_photo', `${w.pro}/${b.id}/a.jpg`)).toBe(false); // aceito, sem check-in
    await sql`UPDATE bookings SET status = 'completed' WHERE id = ${b.id}`;
    expect(await can(w.pro, 'can_upload_booking_photo', `${w.pro}/${b.id}/a.jpg`)).toBe(false);
  });

  it('veem as fotos: cliente, profissional e admin; ninguém mais', async () => {
    const id = await inProgress();
    const path = `${w.pro}/${id}/a.jpg`;
    expect(await can(w.client, 'can_read_booking_photo', path)).toBe(true);
    expect(await can(w.pro, 'can_read_booking_photo', path)).toBe(true);
    expect(await can(w.admin, 'can_read_booking_photo', path)).toBe(true);
    expect(await can(w.otherClient, 'can_read_booking_photo', path)).toBe(false);
    expect(await can(w.pro2, 'can_read_booking_photo', path)).toBe(false);
    expect(await can(null, 'can_read_booking_photo', path)).toBe(false);
    await sql`UPDATE users SET status = 'suspended' WHERE id = ${w.admin}`;
    expect(await can(w.admin, 'can_read_booking_photo', path)).toBe(false); // admin suspenso
  });

  it('as funções ficam fora do schema público', async () => {
    const r = await sql`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like '%booking_photo%'`;
    expect(r[0]!.n).toBe(0);
  });
});

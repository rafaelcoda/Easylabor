import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/db';
import { ADDRESS_LOC, STARTS_AT, call, clock, makeApp, makeSql, paidBooking, photoKeys, seedWorld, type World } from './helpers';

let sql: Sql;
let w: World;
let app: ReturnType<typeof makeApp>;

beforeAll(async () => {
  sql = makeSql();
  app = makeApp(sql);
  // Armazenamento simulado: só o necessário para a conferência de envio.
  await sql.unsafe('CREATE SCHEMA IF NOT EXISTS storage; CREATE TABLE IF NOT EXISTS storage.objects (bucket_id text, name text)');
});
afterAll(async () => {
  await sql.unsafe('DROP SCHEMA storage CASCADE');
  await sql.end();
});
beforeEach(async () => {
  clock.now = new Date('2026-10-19T12:00:00Z');
  w = await seedWorld(sql);
  await sql`TRUNCATE storage.objects`;
});

async function inProgress(a = app) {
  const b = await paidBooking(a, w);
  await call(a, 'POST', `/v1/bookings/${b.id}/accept`, w.pro);
  clock.now = new Date(STARTS_AT.getTime() - 10 * 60_000);
  await call(a, 'POST', `/v1/bookings/${b.id}/check-in`, w.pro, ADDRESS_LOC);
  clock.now = new Date(STARTS_AT.getTime() + 8 * 3_600_000);
  return b.id;
}
const checkout = (id: string, keys: string[], a = app) => call(a, 'POST', `/v1/bookings/${id}/check-out`, w.pro, { ...ADDRESS_LOC, photo_keys: keys });

describe('fotos do check-out', () => {
  it('só aceita fotos da pasta do próprio profissional e deste pedido', async () => {
    const other = await paidBooking(app, w, { start_time: '09:00', duration_minutes: 60 });
    const id = await inProgress();
    const bad = [
      [`${w.pro2}/${id}/a.jpg`, `${w.pro2}/${id}/b.jpg`], // pasta de outro usuário
      [`${w.pro}/${other.id}/a.jpg`, `${w.pro}/${other.id}/b.jpg`], // outro pedido
      [`${w.pro}/${id}/../a.jpg`, `${w.pro}/${id}/b.jpg`], // tentativa de sair da pasta
      [`${w.pro}/${id}/a b.jpg`, `${w.pro}/${id}/b.jpg`], // caractere fora do permitido
      ['a', 'b'],
    ];
    for (const keys of bad) {
      const r = await checkout(id, keys);
      expect(r.status, JSON.stringify(keys)).toBe(422);
      expect(r.json.error.code).toBe('invalid_photo_key');
    }
  });

  it('fotos repetidas contam uma vez só', async () => {
    const id = await inProgress();
    const k = photoKeys(w.pro, id, 1)[0]!;
    const r = await checkout(id, [k, k, k]);
    expect(r.json.error).toMatchObject({ code: 'not_enough_photos', details: { required: 2 } });
  });

  it('as fotos aparecem no pedido para cliente, profissional e operação', async () => {
    const id = await inProgress();
    const keys = photoKeys(w.pro, id, 2);
    expect((await checkout(id, keys)).json.status).toBe('completed');
    for (const who of [w.client, w.pro, w.admin]) {
      const v = (await call(app, 'GET', `/v1/bookings/${id}`, who)).json;
      expect(v.photos.map((p: any) => p.key).sort()).toEqual([...keys].sort());
    }
  });

  it('com a conferência ligada, exige que os arquivos existam no armazenamento', async () => {
    const strict = makeApp(sql, true, undefined, { verifyPhotoUploads: true });
    const id = await inProgress(strict);
    const keys = photoKeys(w.pro, id, 2);

    await sql`INSERT INTO storage.objects (bucket_id, name) VALUES ('booking-photos', ${keys[0]!})`; // só uma enviada
    const partial = await checkout(id, keys, strict);
    expect(partial.status).toBe(422);
    expect(partial.json.error.code).toBe('photo_not_uploaded');

    await sql`INSERT INTO storage.objects (bucket_id, name) VALUES ('outro-bucket', ${keys[1]!})`; // bucket errado não vale
    expect((await checkout(id, keys, strict)).json.error.code).toBe('photo_not_uploaded');

    await sql`INSERT INTO storage.objects (bucket_id, name) VALUES ('booking-photos', ${keys[1]!})`;
    const ok = await checkout(id, keys, strict);
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('completed');
  });
});

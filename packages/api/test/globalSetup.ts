import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

export const TEST_DB = 'diaria_api_test';
const socket = process.env.TEST_PG_HOST ?? '/var/run/postgresql';
const user = process.env.TEST_PG_USER ?? 'root';

/** Cria um banco limpo, aplica todas as migrações e o seed. */
export default async function setup() {
  const admin = postgres({ host: socket, username: user, database: 'postgres', max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const db = postgres({ host: socket, username: user, database: TEST_DB, max: 1, onnotice: () => {} });
  const dir = join(__dirname, '../../../db');
  for (const f of readdirSync(join(dir, 'migrations')).sort()) {
    await db.unsafe(readFileSync(join(dir, 'migrations', f), 'utf8'));
  }
  await db.unsafe(readFileSync(join(dir, 'seed.sql'), 'utf8'));
  await db.end();
}

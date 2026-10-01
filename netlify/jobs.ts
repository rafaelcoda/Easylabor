import { DEFAULT_CONFIG } from '@diaria/core';
import { createSql } from '../packages/api/src/db';
import { runJobs, type JobSummary } from '../packages/api/src/jobs';
import { createMockProvider } from '../packages/api/src/payments/provider';

// Variável global fornecida pelo runtime da Netlify.
declare const Netlify: { env: { get(name: string): string | undefined } };

/**
 * Rotinas automáticas, a cada 5 minutos (função agendada). Repasses ficam DESLIGADOS: só rodam com um
 * provedor de pagamentos real configurado. Hoje o provedor é o simulado, que não movimenta dinheiro.
 */
export async function runScheduled(): Promise<JobSummary | { skipped: string }> {
  const databaseUrl = Netlify.env.get('DATABASE_URL');
  if (!databaseUrl) return { skipped: 'DATABASE_URL ausente' };
  const sql = createSql(databaseUrl, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 10, connection: {} });
  try {
    return await runJobs({ sql, now: () => new Date(), config: DEFAULT_CONFIG, provider: createMockProvider() }, { payouts: false });
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

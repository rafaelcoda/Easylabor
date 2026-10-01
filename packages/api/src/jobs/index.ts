import { ApiError } from '../errors';
import { applyAction, redirectOffer } from '../services/bookings';
import { materializeWeekly, spToday } from '../services/accounts';
import { collaboratorSyncTick } from '../services/collaborators';
import { runPayouts, sendRefunds } from '../services/payments';
import type { Ctx } from '../types';

export interface JobSummary {
  expired_payments: number;
  resent_offers: number;
  expired_offers: number;
  no_shows: number;
  auto_approved: number;
  weekly_extended: number;
  /** Resultado da rodada da carga de colaboradores (idle, started, ok, partial, error...). */
  collaborator_sync: string;
  refunds_sent: number;
  payouts_sent: number;
  skipped: number;
  errors: number;
}

export interface JobOptions {
  /** Repasses só rodam com provedor real, ou se explicitamente permitido (testes). */
  payouts: boolean;
}

/**
 * Rotinas automáticas (PRD, seção 7.1): cada item é tratado isoladamente, e cada passo relê o estado antes de agir,
 * então rodar duas vezes seguidas não duplica nada.
 */
export async function runJobs(ctx: Ctx, opts: JobOptions): Promise<JobSummary> {
  const s: JobSummary = { expired_payments: 0, resent_offers: 0, expired_offers: 0, no_shows: 0, auto_approved: 0, weekly_extended: 0, collaborator_sync: 'idle', refunds_sent: 0, payouts_sent: 0, skipped: 0, errors: 0 };
  const now = ctx.now();
  const iso = (d: Date) => d.toISOString();

  const each = async (ids: { id: unknown }[], fn: (id: string) => Promise<void>) => {
    for (const r of ids) {
      try {
        await fn(r.id as string);
      } catch (e) {
        if (e instanceof ApiError && e.status < 500) s.skipped++; // outro processo já tratou: normal
        else {
          s.errors++;
          console.error('job falhou', r.id, e);
        }
      }
    }
  };

  // 1. Pix não pago dentro do prazo
  await each(
    await ctx.sql`
      SELECT b.id FROM bookings b
      WHERE b.status = 'awaiting_payment'
        AND EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.status = 'pending' AND p.pix_expires_at < ${iso(now)}::timestamptz)`,
    async (id) => {
      await applyAction(ctx, { bookingId: id, action: 'payment_expired', user: null });
      s.expired_payments++;
    },
  );

  // 2. Prazo de aceite vencido: reenvia ao próximo profissional ou encerra e estorna
  await each(
    await ctx.sql`SELECT id FROM bookings WHERE status = 'requested' AND accept_deadline_at < ${iso(now)}::timestamptz`,
    async (id) => {
      if (await redirectOffer(ctx, id, 'expired', null)) {
        s.resent_offers++;
        return;
      }
      await applyAction(ctx, { bookingId: id, action: 'accept_deadline_expired', user: null });
      s.expired_offers++;
    },
  );

  // 3. No-show do profissional: sem check-in 60 min depois do horário
  const noShowBefore = new Date(now.getTime() - ctx.config.noShowMinutes * 60_000);
  await each(
    await ctx.sql`SELECT id FROM bookings WHERE status IN ('accepted', 'en_route') AND starts_at < ${iso(noShowBefore)}::timestamptz`,
    async (id) => {
      await applyAction(ctx, { bookingId: id, action: 'no_show_professional', user: null });
      s.no_shows++;
    },
  );

  // 4. Aprovação automática, 24 h depois do check-out e sem contestação
  await each(
    await ctx.sql`SELECT id FROM bookings WHERE status = 'completed' AND auto_approve_at <= ${iso(now)}::timestamptz`,
    async (id) => {
      await applyAction(ctx, { bookingId: id, action: 'approve', user: null });
      s.auto_approved++;
    },
  );

  // 5. Disponibilidade semanal: mantém sempre os próximos 28 dias preenchidos
  s.weekly_extended = await materializeWeekly(ctx.sql, spToday(ctx));

  // 6. Carga diária de colaboradores (Easy365/Protheus). Uma falha aqui não atrapalha as outras rotinas.
  s.collaborator_sync = await collaboratorSyncTick(ctx).catch((e) => { console.error('collaborator_sync', e); return 'error'; });

  // 7. Estornos pendentes e 8. repasses vencidos
  s.refunds_sent = await sendRefunds(ctx);
  if (opts.payouts) s.payouts_sent = await runPayouts(ctx);
  return s;
}

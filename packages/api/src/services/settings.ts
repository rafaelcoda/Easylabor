import type { Config } from '@diaria/core';
import type { Sql } from '../db';

/** Um parâmetro que a operação pode ajustar pelo painel. `field` é o campo correspondente em Config. */
export interface SettingDef {
  key: string;
  field: keyof Pick<Config,
    'clientFeeBps' | 'commissionBps' | 'advanceFeeBps' | 'acceptDeadlineMinutes' | 'acceptDeadlineShortMinutes' | 'maxResendAttempts' |
    'pixExpiryMinutes' | 'lateAlertMinutes' | 'noShowMinutes' | 'checkInRadiusMeters' | 'autoApproveHours' | 'payoutDelayHours'>;
  label: string;
  help: string;
  unit: 'bps' | 'minutos' | 'horas' | 'metros' | 'tentativas';
  min: number;
  max: number;
  group: 'Taxas' | 'Prazos' | 'Regras';
}

/** Lista fechada: só estes parâmetros podem ser alterados, e sempre dentro destes limites. */
export const SETTINGS: SettingDef[] = [
  { key: 'client_fee_bps', field: 'clientFeeBps', label: 'Taxa de serviço do cliente', help: 'Somada à diária. Vale só para pedidos novos.', unit: 'bps', min: 0, max: 3000, group: 'Taxas' },
  { key: 'commission_bps', field: 'commissionBps', label: 'Comissão da plataforma', help: 'Descontada do profissional. Vale só para pedidos novos.', unit: 'bps', min: 0, max: 5000, group: 'Taxas' },
  { key: 'advance_fee_bps', field: 'advanceFeeBps', label: 'Taxa de antecipação', help: 'Cobrada do profissional que antecipa o repasse.', unit: 'bps', min: 0, max: 2000, group: 'Taxas' },
  { key: 'accept_deadline_minutes', field: 'acceptDeadlineMinutes', label: 'Prazo para aceitar', help: 'Tempo que o profissional tem para aceitar um pedido.', unit: 'minutos', min: 1, max: 120, group: 'Prazos' },
  { key: 'accept_deadline_short_minutes', field: 'acceptDeadlineShortMinutes', label: 'Prazo para aceitar (serviço em breve)', help: 'Usado quando o serviço começa em menos de 2 horas. Não pode passar do prazo normal.', unit: 'minutos', min: 1, max: 60, group: 'Prazos' },
  { key: 'pix_expiry_minutes', field: 'pixExpiryMinutes', label: 'Validade do Pix', help: 'Tempo para o cliente pagar antes do pedido expirar.', unit: 'minutos', min: 5, max: 240, group: 'Prazos' },
  { key: 'late_alert_minutes', field: 'lateAlertMinutes', label: 'Alerta de atraso', help: 'Minutos sem check-in até a operação ser avisada; também libera "cliente ausente".', unit: 'minutos', min: 5, max: 240, group: 'Prazos' },
  { key: 'no_show_minutes', field: 'noShowMinutes', label: 'Profissional ausente após', help: 'Minutos sem check-in para marcar a falta do profissional (estorno e advertência).', unit: 'minutos', min: 15, max: 240, group: 'Prazos' },
  { key: 'auto_approve_hours', field: 'autoApproveHours', label: 'Aprovação automática após', help: 'Horas após o check-out sem contestação do cliente.', unit: 'horas', min: 1, max: 168, group: 'Prazos' },
  { key: 'payout_delay_hours', field: 'payoutDelayHours', label: 'Repasse em até', help: 'Horas entre a aprovação e o repasse ao profissional.', unit: 'horas', min: 0, max: 240, group: 'Prazos' },
  { key: 'max_resend_attempts', field: 'maxResendAttempts', label: 'Tentativas de reenvio', help: 'Quantos profissionais recebem a oferta antes de estornar o cliente.', unit: 'tentativas', min: 1, max: 10, group: 'Regras' },
  { key: 'check_in_radius_meters', field: 'checkInRadiusMeters', label: 'Raio do check-in', help: 'Distância máxima do endereço para o profissional confirmar a chegada.', unit: 'metros', min: 50, max: 2000, group: 'Regras' },
];

export const settingByKey = (key: string) => SETTINGS.find((s) => s.key === key);

export interface SettingRow {
  key: string;
  value: unknown;
}

/** Aplica as alterações salvas por cima da configuração padrão. Valores fora dos limites são ignorados. */
export function applySettings(base: Config, rows: SettingRow[]): Config {
  const out: Config = { ...base };
  for (const r of rows) {
    const def = settingByKey(r.key);
    const n = Number(r.value);
    if (!def || !Number.isInteger(n) || n < def.min || n > def.max) continue;
    out[def.field] = n;
  }
  // Coerência: o prazo curto nunca passa do normal.
  if (out.acceptDeadlineShortMinutes > out.acceptDeadlineMinutes) out.acceptDeadlineShortMinutes = out.acceptDeadlineMinutes;
  return out;
}

const TTL_MS = 20_000;
const cache = new WeakMap<Sql, { at: number; cfg: Config }>();

/** Lê a configuração efetiva (padrão + alterações do painel), com um pequeno cache em memória. */
export async function loadConfig(sql: Sql, base: Config): Promise<Config> {
  const hit = cache.get(sql);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.cfg;
  const rows = await sql`SELECT key, value FROM config_settings WHERE scope = 'global'`;
  const cfg = applySettings(base, rows.map((r) => ({ key: r.key as string, value: r.value })));
  cache.set(sql, { at: Date.now(), cfg });
  return cfg;
}

export const invalidateConfig = (sql: Sql) => cache.delete(sql);

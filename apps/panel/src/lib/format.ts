import type { BookingStatus } from '../../../../packages/client/src';

/** Dia de hoje no fuso de São Paulo (UTC-3), no formato AAAA-MM-DD. */
export const today = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

export const shiftDay = (day: string, delta: number) =>
  new Date(Date.parse(`${day}T00:00:00-03:00`) + delta * 86_400_000 - 3 * 3_600_000).toISOString().slice(0, 10);

export const timeSP = (iso: string) =>
  new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(11, 16);

/** Horas decimais desde 00:00 do dia (fuso de São Paulo). */
export const hoursInDay = (iso: string, day: string) => (Date.parse(iso) - Date.parse(`${day}T00:00:00-03:00`)) / 3_600_000;

export const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00-03:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

const TONE: Partial<Record<BookingStatus, 'ok' | 'wait' | 'bad' | 'done'>> = {
  accepted: 'ok', en_route: 'ok', in_progress: 'ok', completed: 'done', approved: 'done', paid: 'done',
  awaiting_payment: 'wait', requested: 'wait',
  disputed: 'bad', no_show_professional: 'bad', no_show_client: 'bad', declined: 'bad', expired: 'bad',
  cancelled_by_client: 'bad', cancelled_by_professional: 'bad', refunded: 'bad',
};
export const toneOf = (s: BookingStatus) => TONE[s] ?? 'wait';

export const dateBR = (iso: string) => new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(0, 10).split('-').reverse().join('/');
export const dateTimeBR = (iso: string) => `${dateBR(iso)} ${timeSP(iso)}`;
/** "(27) 99999-0001" a partir de "+5527999990001". */
export function phoneBR(p: string): string {
  const d = p.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  return p;
}
export const dayShort = (day: string) => day.split('-').reverse().slice(0, 2).join('/');

/** "2022-03-14" -> "14/03/2022" (data sem hora). */
export const dateOnlyBR = (d: string) => d.slice(0, 10).split('-').reverse().join('/');

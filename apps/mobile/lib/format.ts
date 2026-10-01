/** Hoje, no fuso de São Paulo (UTC-3), como AAAA-MM-DD. */
export const todaySP = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00-03:00`) + n * 86_400_000).toISOString().slice(0, 10);

export const timeSP = (iso: string) => new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(11, 16);
export const dateBR = (iso: string) => new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(0, 10).split('-').reverse().join('/');
export const km = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

/** "200" ou "200,50" para centavos; null se inválido. */
export function reaisToCents(text: string): number | null {
  const t = text.trim().replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
/** "qui, 02/10" a partir de AAAA-MM-DD, sem depender de Intl. */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const [, m, dd] = day.split('-');
  return `${DIAS[d.getUTCDay()]}, ${dd}/${m}`;
}
/** "Amanhã", "Hoje" ou "qui, 02/10". */
export function dayName(day: string, today: string): string {
  if (day === today) return 'Hoje';
  if (day === addDays(today, 1)) return 'Amanhã';
  return dayLabel(day);
}
/** Minúsculas e sem acentos, para comparar o que a pessoa digitou. */
export const plain = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

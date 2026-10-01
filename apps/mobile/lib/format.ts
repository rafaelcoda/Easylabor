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

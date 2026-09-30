/** Dinheiro sempre em centavos inteiros (nunca ponto flutuante). */
export type Cents = number;

export function assertCents(value: number, label = 'valor'): asserts value is Cents {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} deve ser um inteiro de centavos não negativo, recebido ${value}`);
  }
}

/** Aplica uma taxa em pontos-base, arredondando meio para cima. */
export function applyBps(cents: Cents, bps: number): Cents {
  assertCents(cents);
  if (!Number.isInteger(bps) || bps < 0) throw new RangeError(`bps inválido: ${bps}`);
  return Math.round((cents * bps) / 10_000);
}

export function formatBRL(cents: Cents): string {
  const reais = Math.floor(cents / 100);
  const c = String(cents % 100).padStart(2, '0');
  return `R$ ${reais.toLocaleString('pt-BR')},${c}`;
}

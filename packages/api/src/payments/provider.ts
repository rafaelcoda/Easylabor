import { ApiError } from '../errors';

/** Cobrança Pix criada no provedor. */
export interface PixCharge {
  providerPaymentId: string;
  /** Código "copia e cola" do Pix (é o mesmo conteúdo do QR Code). */
  qrPayload: string;
  expiresAt: Date;
}

/** Evento já verificado e normalizado, vindo do webhook do provedor. */
export type ProviderEvent =
  | { id: string; type: 'payment.confirmed'; providerPaymentId: string; paidAt?: Date }
  | { id: string; type: 'payment.failed' | 'payment.expired'; providerPaymentId: string }
  | { id: string; type: 'refund.done' | 'refund.failed'; providerRefundId: string }
  | { id: string; type: 'transfer.paid' | 'transfer.failed'; providerTransferId: string };

/**
 * Contrato que cada provedor (Asaas, Pagar.me, Mercado Pago...) precisa cumprir.
 * O restante do sistema só conhece esta interface.
 */
export interface PaymentProvider {
  readonly name: string;
  /** false para o provedor simulado: impede repasses reais sem dinheiro real. */
  readonly isReal: boolean;
  createPixCharge(i: { externalReference: string; amountCents: number; expiresAt: Date; description: string }): Promise<PixCharge>;
  refund(i: { providerPaymentId: string; amountCents: number; idempotencyKey: string }): Promise<{ providerRefundId: string }>;
  transfer(i: { pixKey: string; amountCents: number; idempotencyKey: string; description: string }): Promise<{ providerTransferId: string; status: 'paid' | 'processing' }>;
  /** Confere a assinatura do webhook. Lança 401 se inválida e devolve null para eventos que não interessam. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<ProviderEvent | null>;
}

const enc = new TextEncoder();
const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Comparação em tempo constante, para não vazar a assinatura por diferença de tempo. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Provedor simulado, para desenvolvimento e testes. Não movimenta dinheiro.
 * O webhook só é aceito se MOCK_WEBHOOK_SECRET estiver definido: sem ele, ninguém consegue forjar confirmações.
 */
export function createMockProvider(opts: { webhookSecret?: string } = {}): PaymentProvider {
  return {
    name: 'mock',
    isReal: false,
    async createPixCharge(i) {
      return { providerPaymentId: `mock-pay-${i.externalReference}`, qrPayload: `MOCK-PIX-${i.externalReference}`, expiresAt: i.expiresAt };
    },
    async refund(i) {
      return { providerRefundId: `mock-refund-${i.idempotencyKey}` };
    },
    async transfer(i) {
      return { providerTransferId: `mock-transfer-${i.idempotencyKey}`, status: 'paid' };
    },
    async verifyWebhook(rawBody, headers) {
      if (!opts.webhookSecret) throw new ApiError(503, 'webhook_not_configured', 'Webhook de pagamentos não configurado');
      const given = headers.get('x-mock-signature') ?? '';
      const expected = await hmacHex(opts.webhookSecret, rawBody);
      if (!safeEqual(given, expected)) throw new ApiError(401, 'invalid_signature', 'Assinatura inválida');
      let evt: unknown;
      try {
        evt = JSON.parse(rawBody);
      } catch {
        throw new ApiError(400, 'validation_failed', 'Corpo do webhook inválido');
      }
      const e = evt as { id?: string; type?: string };
      if (!e.id || !e.type) return null;
      return evt as ProviderEvent;
    },
  };
}

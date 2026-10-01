/**
 * Cliente tipado da API EasyLabor, compartilhado pelo app (Expo) e pelo painel web (Next.js).
 * Sem dependências: usa `fetch`. Os apps importam este arquivo diretamente.
 */

// ------------------------------------------------------------------ tipos
export type Role = 'client' | 'professional' | 'admin';
export type BookingStatus =
  | 'awaiting_payment' | 'requested' | 'accepted' | 'declined' | 'expired' | 'en_route' | 'in_progress'
  | 'completed' | 'approved' | 'disputed' | 'paid' | 'refunded'
  | 'cancelled_by_client' | 'cancelled_by_professional' | 'no_show_professional' | 'no_show_client';

export interface Me {
  registered: boolean;
  id: string;
  role?: Role;
  full_name?: string;
  phone: string | null;
  next_step: string;
  client?: { kind: string | null; addresses: number };
  professional?: { profile_complete: boolean; kyc_status?: string; visible?: boolean; radius_km?: number; level?: string; offers?: number };
}

export interface Category {
  slug: string;
  name: string;
  min_daily_rate_cents: number;
  max_daily_rate_cents: number;
  min_photos_checkout: number;
  checklist: string[];
}

export interface Address {
  id: string;
  label: string | null;
  street: string;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string;
  state: string;
  zip: string | null;
  reference: string | null;
  lat: number;
  lng: number;
}

export type NewAddress = Omit<Address, 'id' | 'label' | 'number' | 'complement' | 'district' | 'zip' | 'reference'> &
  Partial<Pick<Address, 'label' | 'number' | 'complement' | 'district' | 'zip' | 'reference'>>;

export interface ProfessionalResult {
  professional_id: string;
  name: string;
  photo_url: string | null;
  category: string;
  daily_rate_cents: number;
  rating_avg: number;
  rating_count: number;
  completed_count: number;
  attendance_rate: number;
  distance_m: number;
  score: number;
}

export interface Quote {
  dailyRateCents: number;
  clientFeeCents: number;
  totalCents: number;
  commissionCents: number;
  professionalNetCents: number;
  currency: 'BRL';
}

export interface Booking {
  id: string;
  code: string;
  status: BookingStatus;
  category: string;
  client_id: string;
  professional_id: string;
  starts_at: string;
  ends_at: string;
  description: string;
  amounts: { daily_rate_cents: number; client_fee_cents: number; total_cents: number; commission_cents: number; professional_net_cents: number };
  district: string | null;
  address: (Omit<Address, 'id' | 'label' | 'zip'>) | null;
  accept_deadline_at: string | null;
  auto_approve_at: string | null;
  payment: { id: string; method: string; status: string; amount_cents: number; pix_qr_payload: string | null; pix_expires_at: string | null } | null;
  photos: { key: string; at: string }[];
  available_actions: string[];
  timeline: { type: string; to_status: string | null; at: string }[];
  version: number;
}

export interface NewBooking {
  professional_id: string;
  category: string;
  address_id: string;
  date: string; // AAAA-MM-DD
  start_time: string; // HH:MM
  duration_minutes: number;
  description: string;
}

export interface AdminOverview {
  date: string;
  total: number;
  by_status: Partial<Record<BookingStatus, number>>;
  late_without_checkin: number;
  kyc_pending: number;
}

export interface AdminBooking {
  id: string;
  code: string;
  status: BookingStatus;
  category: string;
  attempt: number;
  starts_at: string;
  ends_at: string;
  total_cents: number;
  client_name: string;
  professional_name: string;
  professional_id: string;
}

export interface ScheduleSlot { id: string; code: string; status: BookingStatus; category: string; starts_at: string; ends_at: string }
export interface AdminSchedule {
  date: string;
  professionals: { id: string; name: string; bookings: ScheduleSlot[] }[];
  pending: (ScheduleSlot & { attempt: number; professional_name: string; accept_deadline_at: string | null })[];
}

export interface KycItem { id: string; full_name: string; phone: string; kyc_status: string; radius_km: number; created_at: string }

// ------------------------------------------------------------------ fotos
/** Bucket privado do Supabase Storage onde ficam as fotos do serviço. */
export const PHOTO_BUCKET = 'booking-photos';

/** Caminho de uma foto: <usuário que enviou>/<pedido>/<arquivo>. A API e o banco exigem exatamente este formato. */
export const photoPath = (userId: string, bookingId: string, fileName: string) => `${userId}/${bookingId}/${fileName.replace(/[^A-Za-z0-9._-]/g, '-')}`;

// ------------------------------------------------------------------ cliente HTTP
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}, requestId: string | null = null) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export interface ClientOptions {
  baseUrl: string;
  /** Token de acesso do Supabase Auth (ou null se não logado). */
  getToken: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
}

export type ActionName = 'accept' | 'decline' | 'en-route' | 'check-in' | 'check-out' | 'approve' | 'cancel' | 'report-client-no-show';

export function createClient(opts: ClientOptions) {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const token = await opts.getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await doFetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiClientError(0, 'network_error', 'Sem conexão com o servidor. Verifique sua internet.');
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* resposta não JSON */ }
    if (!res.ok) {
      const e = (data as { error?: { code?: string; message?: string; details?: Record<string, unknown>; request_id?: string } } | null)?.error;
      throw new ApiClientError(res.status, e?.code ?? 'http_error', e?.message ?? `Erro ${res.status}`, e?.details ?? {}, e?.request_id ?? null);
    }
    return data as T;
  }

  const qs = (params: Record<string, string | number | undefined>) => {
    const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return p.length ? `?${p.join('&')}` : '';
  };

  return {
    // conta
    me: () => call<Me>('GET', '/v1/me'),
    register: (b: { role: 'client' | 'professional'; full_name: string; accepted_terms_version: string; email?: string; client_kind?: 'person' | 'company'; cnpj?: string }) =>
      call<Me>('POST', '/v1/me/register', b),
    categories: () => call<{ items: Category[] }>('GET', '/v1/categories').then((r) => r.items),
    /** Exclui a conta (anonimiza os dados). Bloqueado com pedido em andamento. */
    deleteAccount: () => call<{ deleted: boolean }>('DELETE', '/v1/me'),

    // cliente
    addresses: () => call<{ items: Address[] }>('GET', '/v1/client/addresses').then((r) => r.items),
    addAddress: (a: NewAddress) => call<{ id: string }>('POST', '/v1/client/addresses', a),
    deleteAddress: (id: string) => call<void>('DELETE', `/v1/client/addresses/${id}`),
    search: (p: { category: string; date: string; address_id?: string; lat?: number; lng?: number; limit?: number }) =>
      call<{ items: ProfessionalResult[] }>('GET', `/v1/search/professionals${qs(p)}`).then((r) => r.items),
    quote: (professional_id: string, category: string) => call<Quote>('POST', '/v1/bookings/quote', { professional_id, category }),
    createBooking: (b: NewBooking) => call<Booking>('POST', '/v1/bookings', b),
    bookings: (status?: BookingStatus) => call<{ items: Booking[] }>('GET', `/v1/bookings${qs({ status })}`).then((r) => r.items),
    booking: (id: string) => call<Booking>('GET', `/v1/bookings/${id}`),
    action: (id: string, name: ActionName, body: Record<string, unknown> = {}) => call<Booking | { id: string; status: string; resent?: boolean }>('POST', `/v1/bookings/${id}/${name}`, body),

    // profissional
    saveProfile: (p: { bio?: string; lat: number; lng: number; radius_km: number; pix_key: string }) => call<Me>('PUT', '/v1/professional/profile', p),
    saveOffer: (category: string, daily_rate_cents: number, description?: string) =>
      call<{ category: string; daily_rate_cents: number }>('PUT', `/v1/professional/offers/${category}`, { daily_rate_cents, description }),
    saveAvailability: (day: string, start_time: string, end_time: string) =>
      call<{ day: string; start_time: string; end_time: string }>('PUT', `/v1/professional/availability/${day}`, { start_time, end_time }),
    setVisible: (visible: boolean) => call<{ visible: boolean }>('PUT', '/v1/professional/status', { visible }),

    // operação
    adminOverview: (date?: string) => call<AdminOverview>('GET', `/v1/admin/overview${qs({ date })}`),
    adminBookings: (p: { date?: string; status?: BookingStatus; limit?: number } = {}) =>
      call<{ items: AdminBooking[] }>('GET', `/v1/admin/bookings${qs(p)}`).then((r) => r.items),
    adminSchedule: (date?: string) => call<AdminSchedule>('GET', `/v1/admin/schedule${qs({ date })}`),
    kycQueue: () => call<{ items: KycItem[] }>('GET', '/v1/admin/kyc/queue').then((r) => r.items),
    kycDecision: (userId: string, decision: 'approve' | 'reject', reason?: string) =>
      call<{ user_id: string; kyc_status: string }>('POST', `/v1/admin/kyc/${userId}/decision`, { decision, reason }),
  };
}

export type ApiClient = ReturnType<typeof createClient>;

// ------------------------------------------------------------------ utilidades de exibição
export const formatBRL = (cents: number) =>
  `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const STATUS_LABEL: Record<BookingStatus, string> = {
  awaiting_payment: 'Aguardando pagamento',
  requested: 'Aguardando aceite',
  accepted: 'Aceito',
  declined: 'Recusado',
  expired: 'Expirado',
  en_route: 'A caminho',
  in_progress: 'Em execução',
  completed: 'Concluído',
  approved: 'Aprovado',
  disputed: 'Contestado',
  paid: 'Pago',
  refunded: 'Reembolsado',
  cancelled_by_client: 'Cancelado pelo cliente',
  cancelled_by_professional: 'Cancelado pelo profissional',
  no_show_professional: 'Profissional ausente',
  no_show_client: 'Cliente ausente',
};

/** Mensagem pronta para mostrar ao usuário a partir de qualquer erro. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Algo deu errado. Tente novamente.';
}

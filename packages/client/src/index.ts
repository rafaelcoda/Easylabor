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

export type AdminLevel = 'owner' | 'operator';

export interface Me {
  registered: boolean;
  id: string;
  role?: Role;
  full_name?: string;
  phone: string | null;
  next_step: string;
  /** Só para administradores. */
  admin_level?: AdminLevel;
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

/** O que a tela "Seu cadastro" precisa para abrir já preenchida. */
export interface ProfessionalSetup {
  profile: { bio: string | null; radius_km: number; pix_key: string; lat: number; lng: number } | null;
  offers: { category: string; daily_rate_cents: number }[];
  /** days: 1 = segunda ... 7 = domingo */
  weekly: { days: number[]; start_time: string; end_time: string };
}

/** Dias da semana na ordem de exibição; `iso` é o número que a API usa (1 = segunda ... 7 = domingo). */
export const WEEKDAYS = [
  { iso: 1, label: 'Segunda-feira', short: 'Seg' },
  { iso: 2, label: 'Terça-feira', short: 'Ter' },
  { iso: 3, label: 'Quarta-feira', short: 'Qua' },
  { iso: 4, label: 'Quinta-feira', short: 'Qui' },
  { iso: 5, label: 'Sexta-feira', short: 'Sex' },
  { iso: 6, label: 'Sábado', short: 'Sáb' },
  { iso: 7, label: 'Domingo', short: 'Dom' },
] as const;

export interface KycItem { id: string; full_name: string; phone: string; kyc_status: string; radius_km: number; created_at: string }

// ------------------------------------------------------------------ fotos
/** Bucket privado do Supabase Storage onde ficam as fotos do serviço. */
export const PHOTO_BUCKET = 'booking-photos';

/** Caminho de uma foto: <usuário que enviou>/<pedido>/<arquivo>. A API e o banco exigem exatamente este formato. */
export const photoPath = (userId: string, bookingId: string, fileName: string) => `${userId}/${bookingId}/${fileName.replace(/[^A-Za-z0-9._-]/g, '-')}`;

// ------------------------------------------------------------------ gestão (painel da operação)
export type KycFilter = 'incomplete' | 'pending' | 'approved' | 'rejected';
export type AccountStatus = 'active' | 'suspended' | 'deleted';

export interface AdminProfessionalRow {
  id: string; full_name: string; phone: string; status: AccountStatus; created_at: string;
  has_profile: boolean; kyc_status: string | null; visible: boolean; radius_km: number | null; level: string | null;
  rating_avg: number; rating_count: number; completed_count: number; weekly_days: number;
  offers: { category: string; rate_cents: number }[]; active_strikes: number; bookings_total: number; is_collaborator: boolean;
}
export interface AdminProfessionalList {
  total: number;
  summary: { total: number; incomplete: number; pending: number; approved: number; rejected: number; suspended: number; visible: number };
  items: AdminProfessionalRow[];
}
export interface AuditItem {
  id: string; action: string; entity: string; entity_id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null;
  created_at: string; actor_name: string;
}
export interface AdminProfessionalDetail {
  /** Dados vindos do Protheus, quando o profissional está vinculado a um colaborador. */
  collaborator: {
    register: string | null; status: string; contract: string | null; branch: string | null; role: string | null; position: string | null;
    work_shift: string | null; notation_rule: string | null; hired_on: string | null; missing_since: string | null;
  } | null;
  user: { id: string; full_name: string; phone: string; email: string | null; status: AccountStatus; created_at: string; terms_version: string | null };
  profile: {
    bio: string | null; radius_km: number; pix_key_masked: string; lat: number; lng: number; kyc_status: string; kyc_reason: string | null; visible: boolean; level: string;
    rating_avg: number; rating_count: number; completed_count: number; attendance_rate: number | null; acceptance_rate: number | null;
  } | null;
  offers: { category: string; name: string; daily_rate_cents: number }[];
  weekly: { days: number[]; start_time: string | null; end_time: string | null };
  strikes: { kind: string; created_at: string; expires_at: string; active: boolean; booking_code: string | null }[];
  bookings: { id: string; code: string; status: BookingStatus; category: string; starts_at: string; client_name: string; total_cents: number }[];
  history: AuditItem[];
}
export interface AdminClientRow {
  id: string; full_name: string; phone: string; email: string | null; status: AccountStatus; created_at: string; kind: string | null;
  addresses: number; bookings_total: number; bookings_done: number; bookings_lost: number; spent_cents: number;
}
export interface AdminClientList { total: number; summary: { total: number; active: number; suspended: number; companies: number }; items: AdminClientRow[] }
export interface AdminClientDetail {
  user: AdminProfessionalDetail['user'];
  profile: { kind: string; cnpj_masked: string | null; legal_name: string | null } | null;
  addresses: { label: string | null; district: string | null; city: string; state: string }[];
  totals: { bookings: number; done: number; lost: number; spent_cents: number };
  bookings: { id: string; code: string; status: BookingStatus; category: string; starts_at: string; professional_name: string; total_cents: number }[];
  history: AuditItem[];
}
export interface PlatformOverview {
  days: number; from: string; to: string;
  users: { clients: number; professionals: number; admins: number; suspended: number };
  professionals: { approved: number; pending: number; visible: number };
  bookings: { total: number; done: number; lost: number; gmv_cents: number; revenue_cents: number };
  bookings_by_day: { day: string; total: number; done: number }[];
  signups_by_day: { day: string; clients: number; professionals: number }[];
  queues: { kyc_pending: number; disputes_open: number; refunds_pending: number; payouts_open: number; late_without_checkin: number };
}
export interface AdminCategory {
  slug: string; name: string; min_daily_rate_cents: number; max_daily_rate_cents: number; min_photos_checkout: number; active: boolean; professionals: number;
}
export interface AdminSetting {
  key: string; label: string; help: string; unit: 'bps' | 'minutos' | 'horas' | 'metros' | 'tentativas'; group: 'Taxas' | 'Prazos' | 'Regras';
  min: number; max: number; default: number; value: number; custom: boolean; updated_at: string | null; updated_by_name: string | null;
}

export interface TeamMember {
  id: string; full_name: string; phone: string; status: AccountStatus; level: AdminLevel; created_at: string; actions_30d: number; last_action: string | null;
}
export interface TeamInvite {
  id: string; phone: string; full_name: string; level: AdminLevel; created_at: string; expires_at: string; expired: boolean; invited_by_name: string;
}
export interface TeamOverview { me: { id: string; level: AdminLevel }; members: TeamMember[]; invites: TeamInvite[] }

export const LEVEL_NAME: Record<AdminLevel, string> = { owner: 'Administrador', operator: 'Operador' };
export const LEVEL_HELP: Record<AdminLevel, string> = {
  owner: 'Tudo: equipe, serviços, parâmetros e a rotina da operação.',
  operator: 'Rotina: verificar cadastros, suspender contas, ocultar da busca e consultar. Não altera equipe, serviços nem parâmetros.',
};

// ------------------------------------------------------------------ colaboradores (carga do Protheus)
export type LinkState = 'none' | 'waiting' | 'linked';
export interface CollaboratorRow {
  id: string; external_id: string; register: string | null; name: string; status: string;
  contract: { id: string | null; name: string | null; branch: string | null };
  role_title: string | null; position_title: string | null; work_shift: { label: string | null; notation_rule: string | null }; degree: string | null;
  hired_at: string | null; hired_on: string | null; fired_on: string | null; missing_since: string | null; last_seen_at: string | null;
  link: { state: LinkState; phone: string | null; user_id: string | null; user_name: string | null; linked_at: string | null };
}
export type SyncStatus = 'queued' | 'running' | 'partial' | 'ok' | 'error';
export interface SyncRun {
  id: string; trigger: 'schedule' | 'manual'; status: SyncStatus; run_date: string; attempt: number; pages: number; fetched: number; created: number;
  updated: number; unchanged: number; missing: number; pagination: string | null; error: string | null; requested_by_name: string | null;
  created_at: string; started_at: string | null; finished_at: string | null;
}
export interface CollaboratorList {
  total: number;
  summary: { total: number; active: number; missing: number; linked: number; waiting: number };
  contracts: { id: string; name: string | null; count: number }[];
  statuses: { status: string; count: number }[];
  sync: { configured: boolean; last: SyncRun | null };
  items: CollaboratorRow[];
}
export type CollaboratorView = 'linked' | 'waiting' | 'unlinked' | 'missing';

export const COLLABORATOR_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Ativo', FIRED: 'Desligado', AWAY: 'Afastado', VACATION: 'Férias', TRANSFERRED: 'Transferido', INACTIVE: 'Inativo', UNKNOWN: 'Sem situação',
};
export const SYNC_STATUS_LABEL: Record<SyncStatus, string> = { queued: 'Na fila', running: 'Em andamento', partial: 'Em andamento (continua na próxima rodada)', ok: 'Concluída', error: 'Com erro' };

export const KYC_LABEL: Record<string, string> = { pending: 'Aguardando verificação', in_review: 'Em análise', approved: 'Aprovado', rejected: 'Reprovado', incomplete: 'Cadastro incompleto' };
export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = { active: 'Ativa', suspended: 'Suspensa', deleted: 'Excluída' };
export const STRIKE_KIND_LABEL: Record<string, string> = { cancellation: 'Cancelamento', no_show: 'Ausência', conduct: 'Conduta' };
export const LEVEL_LABEL: Record<string, string> = { bronze: 'Bronze', silver: 'Prata', gold: 'Ouro' };
export const AUDIT_LABEL: Record<string, string> = {
  'user.suspended': 'Conta suspensa', 'user.reactivated': 'Conta reativada', 'user.deleted': 'Conta excluída pelo próprio usuário', 'user.promoted_to_admin': 'Promovido a administrador',
  'professional.hidden': 'Ocultado da busca', 'professional.shown': 'Exibido na busca', 'kyc.decision': 'Decisão de verificação',
  'team.invited': 'Convite enviado', 'team.invite_revoked': 'Convite cancelado', 'team.invite_accepted': 'Convite aceito', 'team.level_changed': 'Nível de acesso alterado',
  'team.deactivated': 'Acesso desativado', 'team.reactivated': 'Acesso reativado',
  'collaborator.linked': 'Colaborador vinculado a um celular', 'collaborator.unlinked': 'Vínculo de colaborador removido',
  'collaborator.auto_linked': 'Vínculo automático no cadastro do profissional', 'collaborator.auto_hidden': 'Ocultado da busca: colaborador desligado ou fora da base', 'collaborators.sync_requested': 'Carga de colaboradores solicitada',
  'category.created': 'Serviço criado', 'category.updated': 'Serviço alterado', 'config.updated': 'Parâmetro alterado', 'config.reset': 'Parâmetro restaurado ao padrão',
};
export const auditLabel = (action: string) => AUDIT_LABEL[action] ?? action;

/** Valor de um parâmetro para exibição, com a unidade ("5%", "15 minutos"). */
export function formatSetting(value: number, unit: AdminSetting['unit']): string {
  if (unit === 'bps') return `${(value / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  const one = value === 1;
  const word = unit === 'minutos' ? (one ? 'minuto' : 'minutos') : unit === 'horas' ? (one ? 'hora' : 'horas') : unit === 'metros' ? (one ? 'metro' : 'metros') : one ? 'tentativa' : 'tentativas';
  return `${value} ${word}`;
}

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
    professionalSetup: () => call<ProfessionalSetup>('GET', '/v1/professional/setup'),
    removeOffer: (category: string) => call<void>('DELETE', `/v1/professional/offers/${category}`),
    /** Dias da semana em que atende (1 = segunda ... 7 = domingo) e o horário. Lista vazia desliga. */
    saveWeekly: (days: number[], start_time: string, end_time: string) =>
      call<{ days: number[]; start_time: string; end_time: string }>('PUT', '/v1/professional/availability/weekly', { days, start_time, end_time }),
    setVisible: (visible: boolean) => call<{ visible: boolean }>('PUT', '/v1/professional/status', { visible }),

    // operação
    adminOverview: (date?: string) => call<AdminOverview>('GET', `/v1/admin/overview${qs({ date })}`),
    adminBookings: (p: { date?: string; status?: BookingStatus; limit?: number } = {}) =>
      call<{ items: AdminBooking[] }>('GET', `/v1/admin/bookings${qs(p)}`).then((r) => r.items),
    adminSchedule: (date?: string) => call<AdminSchedule>('GET', `/v1/admin/schedule${qs({ date })}`),
    // gestão
    adminProfessionals: (p: { q?: string; kyc?: KycFilter; status?: AccountStatus; visible?: boolean; service?: string; limit?: number; offset?: number } = {}) =>
      call<AdminProfessionalList>('GET', `/v1/admin/professionals${qs({ ...p, visible: p.visible === undefined ? undefined : String(p.visible) })}`),
    adminProfessional: (id: string) => call<AdminProfessionalDetail>('GET', `/v1/admin/professionals/${id}`),
    setProfessionalVisible: (id: string, visible: boolean, reason?: string) => call<{ id: string; visible: boolean }>('PUT', `/v1/admin/professionals/${id}/visible`, { visible, reason }),
    adminClients: (p: { q?: string; status?: AccountStatus; limit?: number; offset?: number } = {}) => call<AdminClientList>('GET', `/v1/admin/clients${qs(p)}`),
    adminClient: (id: string) => call<AdminClientDetail>('GET', `/v1/admin/clients/${id}`),
    suspendUser: (id: string, reason: string) => call<{ id: string; status: AccountStatus }>('POST', `/v1/admin/users/${id}/suspend`, { reason }),
    reactivateUser: (id: string, reason?: string) => call<{ id: string; status: AccountStatus }>('POST', `/v1/admin/users/${id}/reactivate`, { reason }),
    platformOverview: (days = 30) => call<PlatformOverview>('GET', `/v1/admin/platform/overview${qs({ days })}`),
    adminCategories: () => call<{ items: AdminCategory[] }>('GET', '/v1/admin/categories').then((r) => r.items),
    updateCategory: (slug: string, patch: Partial<Pick<AdminCategory, 'name' | 'min_daily_rate_cents' | 'max_daily_rate_cents' | 'min_photos_checkout' | 'active'>>) =>
      call<{ slug: string }>('PUT', `/v1/admin/categories/${slug}`, patch),
    createCategory: (c: { slug: string; name: string; min_daily_rate_cents: number; max_daily_rate_cents: number; min_photos_checkout: number }) => call<{ slug: string }>('POST', '/v1/admin/categories', c),
    adminConfig: () => call<{ items: AdminSetting[] }>('GET', '/v1/admin/config').then((r) => r.items),
    setConfigValue: (key: string, value: number) => call<{ key: string; value: number }>('PUT', `/v1/admin/config/${key}`, { value }),
    resetConfigValue: (key: string) => call<{ key: string; value: number }>('DELETE', `/v1/admin/config/${key}`),
    adminAudit: (limit = 50) => call<{ items: AuditItem[] }>('GET', `/v1/admin/audit${qs({ limit })}`).then((r) => r.items),

    adminCollaborators: (p: { q?: string; status?: string; contract?: string; view?: CollaboratorView; limit?: number; offset?: number } = {}) =>
      call<CollaboratorList>('GET', `/v1/admin/collaborators${qs(p)}`),
    collaboratorSyncRuns: () => call<{ items: SyncRun[] }>('GET', '/v1/admin/collaborators/sync-runs').then((r) => r.items),
    requestCollaboratorSync: () => call<{ id: string; status: 'queued' }>('POST', '/v1/admin/collaborators/sync', {}),
    linkCollaborator: (id: string, phone: string) => call<{ id: string; state: LinkState; phone: string | null }>('PUT', `/v1/admin/collaborators/${id}/link`, { phone }),
    unlinkCollaborator: (id: string) => call<void>('DELETE', `/v1/admin/collaborators/${id}/link`),
    adminTeam: () => call<TeamOverview>('GET', '/v1/admin/team'),
    inviteMember: (b: { full_name: string; phone: string; level: AdminLevel }) => call<{ id: string; phone: string; level: AdminLevel; expires_at: string }>('POST', '/v1/admin/team/invites', b),
    revokeInvite: (id: string) => call<void>('DELETE', `/v1/admin/team/invites/${id}`),
    setMemberLevel: (id: string, level: AdminLevel) => call<{ id: string; level: AdminLevel }>('PUT', `/v1/admin/team/members/${id}`, { level }),
    deactivateMember: (id: string) => call<{ id: string; status: AccountStatus }>('POST', `/v1/admin/team/members/${id}/deactivate`, {}),
    reactivateMember: (id: string) => call<{ id: string; status: AccountStatus }>('POST', `/v1/admin/team/members/${id}/reactivate`, {}),
    /** Chamado no primeiro login de quem foi convidado para a equipe. */
    acceptInvite: () => call<{ id: string; role: 'admin'; level: AdminLevel }>('POST', '/v1/admin/accept-invite', {}),
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

/** Nome do serviço para exibição: "ajudante-geral" vira "Ajudante geral". */
export const categoryName = (slug: string) => {
  const t = slug.replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'aguardando pagamento',
  paid: 'pago',
  released: 'liberado ao profissional',
  refunded: 'reembolsado',
  partially_refunded: 'reembolsado em parte',
  failed: 'falhou',
  expired: 'expirou',
};

/** Texto do histórico do pedido, a partir do tipo do evento (ex.: "booking.check_in"). */
export const EVENT_LABEL: Record<string, string> = {
  created: 'Pedido criado',
  payment_confirmed: 'Pagamento confirmado',
  payment_expired: 'Pagamento não realizado',
  accept: 'Aceito pelo profissional',
  decline: 'Recusado pelo profissional',
  accept_deadline_expired: 'Prazo de aceite encerrado',
  resent: 'Enviado a outro profissional',
  en_route: 'Profissional a caminho',
  check_in: 'Chegada confirmada',
  check_out: 'Serviço concluído',
  approve: 'Serviço aprovado',
  dispute: 'Serviço contestado',
  cancel_by_client: 'Cancelado pelo cliente',
  cancel_by_professional: 'Cancelado pelo profissional',
  no_show_professional: 'Profissional não compareceu',
  no_show_client: 'Cliente ausente',
  payout_paid: 'Repasse realizado',
};
export const eventLabel = (type: string) => EVENT_LABEL[type.replace(/^booking\./, '')] ?? type.replace(/^booking\./, '').replace(/_/g, ' ');

/** Mensagem pronta para mostrar ao usuário a partir de qualquer erro. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Algo deu errado. Tente novamente.';
}

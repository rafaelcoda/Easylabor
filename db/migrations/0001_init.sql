-- 0001_init.sql — esquema inicial (especificação técnica, seção 3).
-- Requer PostgreSQL 15+ com PostGIS.
-- Desvios da especificação, a refletir no documento:
--   * bookings usa starts_at/ends_at (timestamptz) no lugar de service_date/start_time/duration,
--     para permitir a restrição de exclusão de horários sobrepostos (especificação 4.3).
--   * payments.status e bookings.status seguem a máquina de estados do pacote @diaria/core.

-- No Supabase as extensões ficam no schema "extensions" (fora da API pública).
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
SET search_path TO public, extensions;

-- ---------------------------------------------------------------- funções utilitárias
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A tabela % é somente de inserção (% não permitido)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql SET search_path = public, extensions;

-- ---------------------------------------------------------------- identidade e perfis
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL CHECK (role IN ('client','professional','admin')),
  full_name text NOT NULL,
  cpf text UNIQUE,                       -- criptografado pela aplicação
  phone text NOT NULL UNIQUE,            -- E.164
  phone_verified_at timestamptz,
  email text UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','blocked','deleted')),
  suspended_until timestamptz,
  accepted_terms_version text NOT NULL,
  accepted_terms_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE professional_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  photo_url text,
  bio text,
  base_location geography(Point,4326) NOT NULL,
  radius_km int NOT NULL CHECK (radius_km BETWEEN 1 AND 50),
  kyc_status text NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending','in_review','approved','rejected')),
  kyc_reason text,
  level text NOT NULL DEFAULT 'bronze' CHECK (level IN ('bronze','silver','gold')),
  rating_avg numeric(3,2) NOT NULL DEFAULT 0,
  rating_count int NOT NULL DEFAULT 0,
  completed_count int NOT NULL DEFAULT 0,
  acceptance_rate numeric(4,3),
  attendance_rate numeric(4,3),
  pix_key text NOT NULL,                 -- o titular deve ter o mesmo CPF
  pix_key_changed_at timestamptz,
  provider_account_id text,              -- subconta no provedor de pagamentos
  visible boolean NOT NULL DEFAULT false
);
CREATE INDEX professional_profiles_location_idx ON professional_profiles USING gist (base_location);

CREATE TABLE client_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('person','company')),
  cnpj text UNIQUE,
  legal_name text,
  credit_limit_cents bigint NOT NULL DEFAULT 0 CHECK (credit_limit_cents >= 0),
  billing_mode text NOT NULL DEFAULT 'prepaid' CHECK (billing_mode IN ('prepaid','invoiced')),
  rating_avg numeric(3,2) NOT NULL DEFAULT 0,
  rating_count int NOT NULL DEFAULT 0
);

CREATE TABLE company_members (
  company_user_id uuid REFERENCES client_profiles(user_id),
  member_user_id uuid REFERENCES users(id),
  member_role text NOT NULL CHECK (member_role IN ('owner','manager','requester')),
  cost_center text,
  PRIMARY KEY (company_user_id, member_user_id)
);

CREATE TABLE addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES client_profiles(user_id),
  label text, street text NOT NULL, number text, complement text,
  district text, city text NOT NULL, state char(2) NOT NULL, zip text,
  location geography(Point,4326) NOT NULL,
  reference text
);
CREATE INDEX addresses_client_idx ON addresses (client_id);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('id_front','id_back','selfie','certificate','background_check')),
  file_key text NOT NULL,                -- objeto criptografado
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_user_idx ON documents (user_id);

-- ---------------------------------------------------------------- catálogo e disponibilidade
CREATE TABLE service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  min_daily_rate_cents bigint NOT NULL CHECK (min_daily_rate_cents >= 0),
  max_daily_rate_cents bigint NOT NULL,
  required_documents text[] NOT NULL DEFAULT '{}',
  checklist jsonb NOT NULL DEFAULT '[]',
  min_photos_checkout int NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  CHECK (max_daily_rate_cents >= min_daily_rate_cents)
);

CREATE TABLE service_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES professional_profiles(user_id),
  category_id uuid NOT NULL REFERENCES service_categories(id),
  daily_rate_cents bigint NOT NULL CHECK (daily_rate_cents > 0),
  description text,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (professional_id, category_id)
);

CREATE TABLE availabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES professional_profiles(user_id),
  day date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  status text NOT NULL DEFAULT 'free' CHECK (status IN ('free','blocked','reserved')),
  rate_override_cents bigint,
  booking_id uuid,                       -- FK adicionada depois de bookings
  UNIQUE (professional_id, day, start_time),
  CHECK (end_time > start_time)
);
CREATE INDEX availabilities_day_status_idx ON availabilities (day, status);

-- ---------------------------------------------------------------- pedidos e execução
CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,             -- código legível, ex.: D-48213
  client_id uuid NOT NULL REFERENCES client_profiles(user_id),
  requested_by uuid NOT NULL REFERENCES users(id),
  professional_id uuid NOT NULL REFERENCES professional_profiles(user_id),
  category_id uuid NOT NULL REFERENCES service_categories(id),
  address_id uuid NOT NULL REFERENCES addresses(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  description text NOT NULL,
  daily_rate_cents bigint NOT NULL CHECK (daily_rate_cents > 0),
  client_fee_cents bigint NOT NULL CHECK (client_fee_cents >= 0),
  commission_cents bigint NOT NULL CHECK (commission_cents >= 0),
  status text NOT NULL CHECK (status IN ('awaiting_payment','requested','accepted','declined','expired',
    'en_route','in_progress','completed','approved','disputed','paid','refunded',
    'cancelled_by_client','cancelled_by_professional','no_show_professional','no_show_client')),
  accept_deadline_at timestamptz,
  auto_approve_at timestamptz,
  attempt int NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at - starts_at BETWEEN interval '1 hour' AND interval '12 hours'),
  -- Um profissional não pode ter dois pedidos ativos com horários sobrepostos (especificação 4.3).
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    professional_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('accepted','en_route','in_progress'))
);
CREATE INDEX bookings_professional_idx ON bookings (professional_id, starts_at, status);
CREATE INDEX bookings_client_idx ON bookings (client_id, created_at DESC);
CREATE INDEX bookings_accept_deadline_idx ON bookings (status, accept_deadline_at) WHERE status = 'requested';
CREATE INDEX bookings_auto_approve_idx ON bookings (status, auto_approve_at) WHERE status = 'completed';
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE availabilities ADD CONSTRAINT availabilities_booking_fk FOREIGN KEY (booking_id) REFERENCES bookings(id);

CREATE TABLE booking_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  kind text NOT NULL CHECK (kind IN ('request_photo','checkin_photo','checkout_photo','dispute_evidence')),
  file_key text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_attachments_booking_idx ON booking_attachments (booking_id);

CREATE TABLE booking_events (              -- somente inserção
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  type text NOT NULL,
  from_status text, to_status text,
  actor_id uuid REFERENCES users(id),
  actor_type text NOT NULL CHECK (actor_type IN ('client','professional','admin','system')),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_events_booking_idx ON booking_events (booking_id, created_at);
CREATE TRIGGER booking_events_immutable BEFORE UPDATE OR DELETE ON booking_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  kind text NOT NULL CHECK (kind IN ('arrival','departure')),
  location geography(Point,4326),
  accuracy_m int,
  distance_to_address_m int,
  validation text NOT NULL CHECK (validation IN ('gps','client_confirmed','admin_override')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, kind)
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  sender_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL,
  flagged_contact boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_booking_idx ON messages (booking_id, created_at);

CREATE TABLE ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  author_id uuid NOT NULL REFERENCES users(id),
  subject_id uuid NOT NULL REFERENCES users(id),
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment text,
  published_at timestamptz,
  UNIQUE (booking_id, author_id)
);

CREATE TABLE disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id),
  opened_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','awaiting_response','decided','appealed')),
  professional_response text,
  decision text CHECK (decision IN ('release_full','split','refund_full')),
  professional_share_cents bigint CHECK (professional_share_cents >= 0),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  respond_by timestamptz,
  CHECK (decision IS NULL OR decided_at IS NOT NULL)
);

-- ---------------------------------------------------------------- financeiro
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  method text NOT NULL CHECK (method IN ('pix','card','invoice')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL CHECK (status IN ('pending','authorized','paid','held','released','refunded','partially_refunded','failed','expired')),
  provider text NOT NULL,
  provider_payment_id text UNIQUE,
  pix_qr_payload text,
  pix_expires_at timestamptz,
  paid_at timestamptz,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_booking_idx ON payments (booking_id);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL CHECK (reason IN ('cancellation','no_show','dispute','admin')),
  provider_refund_id text UNIQUE,
  status text NOT NULL CHECK (status IN ('pending','done','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES professional_profiles(user_id),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  type text NOT NULL CHECK (type IN ('standard','advance')),
  gross_cents bigint NOT NULL CHECK (gross_cents >= 0),
  commission_cents bigint NOT NULL CHECK (commission_cents >= 0),
  advance_fee_cents bigint NOT NULL DEFAULT 0 CHECK (advance_fee_cents >= 0),
  net_cents bigint NOT NULL CHECK (net_cents >= 0),
  status text NOT NULL CHECK (status IN ('scheduled','processing','paid','failed')),
  scheduled_for timestamptz NOT NULL,
  paid_at timestamptz,
  provider_transfer_id text UNIQUE,
  version int NOT NULL DEFAULT 1,
  UNIQUE (booking_id, type),
  -- O repasse líquido é sempre diária − comissão − taxa de antecipação.
  CHECK (net_cents = gross_cents - commission_cents - advance_fee_cents)
);
CREATE INDEX payouts_due_idx ON payouts (status, scheduled_for);

CREATE TABLE ledger_entries (              -- somente inserção, partidas dobradas
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL,          -- agrupa débito e crédito
  account text NOT NULL CHECK (account IN ('bank','escrow','professional','platform_revenue','provider_fees','insurance')),
  direction text NOT NULL CHECK (direction IN ('debit','credit')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  booking_id uuid REFERENCES bookings(id),
  reference_type text NOT NULL,
  reference_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_tx_idx ON ledger_entries (transaction_id);
CREATE INDEX ledger_entries_booking_idx ON ledger_entries (booking_id);
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- A soma de débitos e créditos de cada transaction_id deve ser zero ao final da transação.
CREATE OR REPLACE FUNCTION check_ledger_balanced() RETURNS trigger AS $$
DECLARE
  diff bigint;
BEGIN
  SELECT COALESCE(SUM(CASE direction WHEN 'debit' THEN amount_cents ELSE -amount_cents END), 0)
    INTO diff FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF diff <> 0 THEN
    RAISE EXCEPTION 'Transação do ledger % desbalanceada em % centavos', NEW.transaction_id, diff
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public, extensions;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_ledger_balanced();

CREATE TABLE invoices (                    -- fase 2
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES client_profiles(user_id),
  period_start date NOT NULL, period_end date NOT NULL,
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  due_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('open','paid','overdue','cancelled')),
  CHECK (period_end >= period_start)
);

-- ---------------------------------------------------------------- suporte e operação
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  channel text NOT NULL CHECK (channel IN ('push','sms','email','whatsapp','in_app')),
  type text NOT NULL,
  payload jsonb NOT NULL,
  sent_at timestamptz, read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  platform text NOT NULL CHECK (platform IN ('ios','android')),
  token text NOT NULL UNIQUE,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE strikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  booking_id uuid REFERENCES bookings(id),
  kind text NOT NULL CHECK (kind IN ('cancellation','no_show','conduct')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX strikes_user_idx ON strikes (user_id, created_at DESC);

CREATE TABLE config_settings (
  key text NOT NULL,                     -- ex.: commission_bps, accept_deadline_minutes
  scope text NOT NULL DEFAULT 'global',  -- global, city:<slug> ou category:<slug>
  value jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, scope)
);

CREATE TABLE audit_logs (                  -- somente inserção
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity text NOT NULL, entity_id uuid NOT NULL,
  before jsonb, after jsonb,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity, entity_id, created_at);
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE webhook_events (              -- idempotência de webhooks do provedor
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

-- 0007_collaborators.sql — colaboradores vindos do Protheus (via API Easy365) e execuções da carga diária.
--
-- `collaborators` guarda o que a API devolve, um registro por colaborador (chave: o id da Easy365).
-- Dados sensíveis (salário e ficha médica) ficam à parte em `collaborator_private`, sem nenhuma rota que os exponha.
-- O vínculo com a conta do profissional é feito pela operação, informando o celular da pessoa (`link_phone`);
-- quando ela se cadastra como profissional com esse celular, `user_id` é preenchido.

CREATE TABLE sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'easy365_collaborators',
  trigger text NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'partial', 'ok', 'error')),
  run_date date NOT NULL,                        -- dia (São Paulo) a que a execução pertence
  attempt int NOT NULL DEFAULT 0,
  cursor text,                                   -- de onde continuar, quando parcial
  pages int NOT NULL DEFAULT 0,
  fetched int NOT NULL DEFAULT 0,
  created int NOT NULL DEFAULT 0,
  updated int NOT NULL DEFAULT 0,
  unchanged int NOT NULL DEFAULT 0,
  missing int NOT NULL DEFAULT 0,                -- colaboradores que deixaram de vir na API
  pagination text,                               -- como o cursor da próxima página foi identificado
  error text,
  requested_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_runs_source_date_idx ON sync_runs (source, run_date, created_at DESC);

CREATE TABLE collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,              -- id na Easy365/Protheus
  register text,                                 -- matrícula
  name text NOT NULL,
  status text NOT NULL,                          -- ACTIVE, FIRED, AWAY, VACATION, TRANSFERRED, INACTIVE (ou o que vier)
  contract_id text, contract_name text, contract_branch text, contract_company_id text,
  managed_contracts jsonb NOT NULL DEFAULT '[]',
  role_id text, role_title text,                 -- cargo
  position_id text, position_title text,         -- posição no organograma
  work_shift_id text, work_shift_label text, work_shift_notation_rule text, work_shift_sequence text,
  degree text,
  hired_at text, hired_type text, fired_at text, fired_type text,   -- como vieram (o formato não é especificado pela API)
  hired_on date, fired_on date,                  -- interpretadas quando o formato é reconhecido
  parent_external_id text,                       -- superior no organograma
  nexti_person_ids int[] NOT NULL DEFAULT '{}',
  medical_record_updated_at timestamptz,
  source_created_at timestamptz, source_updated_at timestamptz,
  extra jsonb NOT NULL DEFAULT '{}',             -- campos novos que a API passar a devolver e ainda não mapeamos
  payload_hash text NOT NULL,                    -- identifica mudança sem comparar campo a campo
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_run uuid REFERENCES sync_runs(id),
  missing_since timestamptz,                     -- preenchido quando a API deixa de devolver o colaborador
  synced_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid UNIQUE REFERENCES users(id),      -- conta de profissional vinculada
  link_phone text UNIQUE,                        -- celular liberado pela operação (E.164)
  linked_at timestamptz
);
CREATE INDEX collaborators_status_idx ON collaborators (status);
CREATE INDEX collaborators_contract_idx ON collaborators (contract_id);
CREATE INDEX collaborators_name_idx ON collaborators (lower(name));
CREATE INDEX collaborators_register_idx ON collaborators (register);

CREATE TABLE collaborator_private (
  collaborator_id uuid PRIMARY KEY REFERENCES collaborators(id) ON DELETE CASCADE,
  wage_cents bigint,
  medical_record text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaborator_private ENABLE ROW LEVEL SECURITY;

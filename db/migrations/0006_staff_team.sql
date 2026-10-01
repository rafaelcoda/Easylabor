-- 0006_staff_team.sql — equipe da operação: níveis de acesso e convites.
--
-- Dois níveis para quem tem role = 'admin':
--   owner    = Administrador: tudo, inclusive equipe, serviços e parâmetros de negócio;
--   operator = Operador: rotina (verificar cadastros, suspender contas, ocultar da busca, consultar).
-- Quem já era admin vira owner. Admin sem nível (NULL) é tratado como operator (menor privilégio).
-- Novos membros entram por convite: a pessoa entra com o telefone convidado e o acesso é criado na hora.

ALTER TABLE users
  ADD COLUMN admin_level text CHECK (admin_level IN ('owner', 'operator')),
  ADD CONSTRAINT admin_level_only_for_admins CHECK (admin_level IS NULL OR role = 'admin');

UPDATE users SET admin_level = 'owner' WHERE role = 'admin';

CREATE TABLE admin_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,                      -- E.164, como em users.phone
  full_name text NOT NULL,
  level text NOT NULL DEFAULT 'operator' CHECK (level IN ('owner', 'operator')),
  invited_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_user_id uuid REFERENCES users(id),
  revoked_at timestamptz
);
-- Só um convite em aberto por telefone.
CREATE UNIQUE INDEX admin_invites_open_phone ON admin_invites (phone) WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE admin_invites ENABLE ROW LEVEL SECURITY;

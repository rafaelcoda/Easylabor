import type { Config } from '@diaria/core';
import type { Sql } from './db';
import type { PaymentProvider } from './payments/provider';

export type Role = 'client' | 'professional' | 'admin';

/** Usuário já cadastrado em public.users. */
export type AdminLevel = 'owner' | 'operator';

export interface AuthUser {
  id: string;
  role: Role;
  /** Só para administradores. Sem nível definido vale o menor privilégio (operator). */
  adminLevel?: AdminLevel;
}

/** Identidade vinda do login (Supabase Auth): token válido, ainda sem cadastro no produto. */
export interface Identity {
  id: string;
  phone: string | null;
}

export type Authenticate = (req: Request) => Promise<AuthUser | null>;
export type Identify = (req: Request) => Promise<Identity | null>;

export interface Deps {
  sql: Sql;
  /** Usuário cadastrado e ativo. */
  authenticate: Authenticate;
  /** Token válido, mesmo sem cadastro (usado em /v1/me e /v1/me/register). */
  identify?: Identify;
  now?: () => Date;
  config?: Config;
  /** Provedor de pagamentos. Sem ele, usa o simulado (que não movimenta dinheiro). */
  paymentProvider?: PaymentProvider;
  /** Origens de navegador autorizadas a chamar a API (painel web). Vazio = nenhuma. */
  corsOrigins?: string[];
  /** Lê os parâmetros alterados no painel (tabela config_settings) a cada requisição. Ligado em produção. */
  dbConfig?: boolean;
  /** Confere no armazenamento do Supabase se as fotos do check-out foram mesmo enviadas. Ligado em produção. */
  verifyPhotoUploads?: boolean;
  /** Rotas de desenvolvimento (simulam webhooks do provedor de pagamentos). Nunca em produção. */
  devRoutes?: boolean;
}

export interface Ctx {
  sql: Sql;
  now: () => Date;
  config: Config;
  provider: PaymentProvider;
  verifyPhotoUploads: boolean;
}

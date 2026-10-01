import type { Config } from '@diaria/core';
import type { Sql } from './db';
import type { PaymentProvider } from './payments/provider';

export type Role = 'client' | 'professional' | 'admin';

/** Usuário já cadastrado em public.users. */
export interface AuthUser {
  id: string;
  role: Role;
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
  /** Rotas de desenvolvimento (simulam webhooks do provedor de pagamentos). Nunca em produção. */
  devRoutes?: boolean;
}

export interface Ctx {
  sql: Sql;
  now: () => Date;
  config: Config;
  provider: PaymentProvider;
}

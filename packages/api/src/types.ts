import type { Config } from '@diaria/core';
import type { Sql } from './db';

export type Role = 'client' | 'professional' | 'admin';

export interface AuthUser {
  id: string;
  role: Role;
}

export type Authenticate = (req: Request) => Promise<AuthUser | null>;

export interface Deps {
  sql: Sql;
  authenticate: Authenticate;
  now?: () => Date;
  config?: Config;
  /** Rotas de desenvolvimento (simulam webhooks do provedor de pagamentos). Nunca em produção. */
  devRoutes?: boolean;
}

export interface Ctx {
  sql: Sql;
  now: () => Date;
  config: Config;
}

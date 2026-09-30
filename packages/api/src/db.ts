import postgres from 'postgres';

/** Conexão com bigint como number (valores em centavos cabem com folga em 2^53). */
export type Sql = postgres.Sql<any>;

export function createSql(url: string, options: postgres.Options<any> = {}): Sql {
  return postgres(url, {
    // PostGIS vive no schema "extensions" no Supabase.
    connection: { search_path: 'public, extensions' },
    types: {
      bigint: { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: number) => String(x) },
    },
    ...options,
  }) as Sql;
}

/** Executa `fn` em uma transação; a transação tem a mesma interface de `Sql`. */
export function inTransaction<T>(sql: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin((tx) => fn(tx as unknown as Sql)) as Promise<T>;
}

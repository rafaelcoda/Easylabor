#!/usr/bin/env bash
# Aplica migrações + seed + testes em um banco VAZIO (PostgreSQL 15+ com PostGIS).
# Uso: DATABASE_URL=postgres://usuario@host/banco_de_teste bash db/test.sh
set -euo pipefail
cd "$(dirname "$0")"
: "${DATABASE_URL:?defina DATABASE_URL apontando para um banco de teste vazio}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)
for f in migrations/*.sql; do
  echo "aplicando $f"
  "${PSQL[@]}" -f "$f"
done
"${PSQL[@]}" -f seed.sql
"${PSQL[@]}" -f tests.sql

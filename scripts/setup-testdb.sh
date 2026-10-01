#!/usr/bin/env bash
# Prepara um PostgreSQL local com PostGIS para os testes da API (Debian/Ubuntu). Pode rodar mais de uma vez.
# Uso: bash scripts/setup-testdb.sh
set -euo pipefail

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi
ME="${TEST_PG_USER:-$(id -un)}"

# Executa um comando como o usuário "postgres" do sistema.
as_postgres() {
  if [ "$(id -u)" -eq 0 ]; then runuser -u postgres -- "$@"; else sudo -u postgres "$@"; fi
}

if ! command -v psql >/dev/null 2>&1 || ! ls /usr/lib/postgresql >/dev/null 2>&1; then
  echo "Instalando o PostgreSQL..."
  $SUDO apt-get update -qq || true
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
fi
VER="$(ls /usr/lib/postgresql | sort -V | tail -1)"
if [ ! -f "/usr/share/postgresql/$VER/extension/postgis.control" ]; then
  echo "Instalando o PostGIS para o PostgreSQL $VER..."
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "postgresql-$VER-postgis-3"
fi

echo "Iniciando o PostgreSQL $VER..."
$SUDO pg_ctlcluster "$VER" main start 2>/dev/null || $SUDO service postgresql start || true
for _ in $(seq 1 20); do as_postgres psql -qtc "select 1" >/dev/null 2>&1 && break; sleep 1; done

# Papel de superusuário com o nome do usuário atual (os testes conectam por esse papel).
if ! as_postgres psql -tAc "select 1 from pg_roles where rolname = '$ME'" | grep -q 1; then
  as_postgres psql -qc "create role \"$ME\" superuser login password 'root'"
fi

echo
echo "Banco de teste pronto. Rode os testes com:"
if [ "$ME" != "root" ]; then echo "  export TEST_PG_USER=$ME"; fi
echo "  npm test"

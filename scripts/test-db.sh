#!/usr/bin/env bash
# 在本機臨時的 PostgreSQL 測試 supabase/migrations 的 SQL（不會連到 Supabase）。
# 需要已安裝 PostgreSQL（initdb、pg_ctl、psql）。用法：npm run test:db
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PGBIN:$PATH"
DIR="$(mktemp -d)"
PORT="${PGPORT_TEST:-55432}"
cleanup() { pg_ctl -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
RUN=""
if [ "$(id -u)" = "0" ]; then chown -R postgres "$DIR"; RUN="runuser -u postgres --"; fi
$RUN initdb -D "$DIR/data" -U postgres -A trust >/dev/null
$RUN pg_ctl -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f supabase/tests/supabase_shim.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f supabase/tests/rls_test.sql

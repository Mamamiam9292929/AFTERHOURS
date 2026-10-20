#!/usr/bin/env bash
# pgTAP-Tests ohne Docker und ohne Supabase-CLI (Fallback für Sitzungen, in denen die CI nicht läuft).
# Startet ein frisches Postgres 16 in einem temporären Ordner, bildet die Teile von Supabase nach,
# die Migrationen und Tests brauchen (Rollen, auth.users, auth.uid(), Schema extensions), spielt alle
# Migrationen ein und führt jede Testdatei aus. Maßgeblich bleibt die CI (`supabase test db`).
#
# Voraussetzungen: Postgres 16 (initdb/pg_ctl) und pgTAP als Extension installiert.
# Aufruf: scripts/db-test-local.sh [testdatei …]   (ohne Argument: alle in supabase/tests/database)
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DIR="$(mktemp -d)"
PORT="${PGPORT_LOCAL:-55432}"
cleanup() { "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT

RUNAS=()
if [ "$(id -u)" = 0 ]; then
  id postgres >/dev/null 2>&1 || useradd -r postgres
  chown -R postgres "$DIR"
  RUNAS=(runuser -u postgres --)
fi
"${RUNAS[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" <<'SQL'
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key, instance_id uuid, aud text, role text, email text,
  raw_user_meta_data jsonb, raw_app_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz, last_sign_in_at timestamptz, email_confirmed_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         current_setting('request.jwt.claims', true)::jsonb ->> 'sub'), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;
-- Wie Supabase: neue Objekte in public sind standardmäßig für die API-Rollen freigegeben;
-- die Migrationen entziehen die Rechte selbst.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create extension pgcrypto with schema extensions;
SQL

for f in supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$f" >/dev/null 2>"$DIR/err" || { echo "Migration fehlgeschlagen: $f"; cat "$DIR/err"; exit 1; }
done
# Wie `supabase db start`: Seed nach den Migrationen.
[ -f supabase/seed.sql ] && "${PSQL[@]}" -f supabase/seed.sql >/dev/null
echo "Migrationen: $(ls supabase/migrations/*.sql | wc -l) eingespielt, Seed geladen"

FILES=("$@")
[ ${#FILES[@]} -eq 0 ] && FILES=(supabase/tests/database/*.test.sql)
FAIL=0
for t in "${FILES[@]}"; do
  OUT="$("${PSQL[@]}" -v ON_ERROR_STOP=0 -t -A -f "$t" 2>&1 || true)"
  if grep -qE '^not ok|ERROR|Looks like' <<<"$OUT"; then
    echo "FEHLER $t"; grep -E '^not ok|ERROR|#' <<<"$OUT" | head -40; FAIL=1
  else
    echo "ok     $t ($(grep -c '^ok' <<<"$OUT") Tests)"
  fi
done
exit $FAIL

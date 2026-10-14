#!/usr/bin/env bash
# Browser-Journey in GitHub Actions (Roadmap F1): lokale Supabase-Umgebung, Edge Function "places"
# gegen den OSM-Stellvertreter, Produktionsbuild über `vite preview`, dann tests/e2e/journey.mjs.
#
#   .github/scripts/e2e.sh setup   # Stellvertreter, Supabase, Edge Functions, Build, Vorschau
#   .github/scripts/e2e.sh logs    # Protokolle als Annotation (nach einem Fehler)
#
# Protokolle landen in $E2E_LOGS (Standard: e2e-logs/).
set -euo pipefail
LOGS=${E2E_LOGS:-e2e-logs}
mkdir -p "$LOGS"

wait_for() { # <Beschreibung> <Sekunden> <Befehl…>
  local what=$1 seconds=$2
  shift 2
  for _ in $(seq 1 "$seconds"); do
    if "$@" >/dev/null 2>&1; then echo "✓ $what"; return 0; fi
    sleep 1
  done
  echo "::error title=$what::nicht erreichbar nach ${seconds}s"
  return 1
}

setup() {
  # 1. OSM-Stellvertreter auf dem Host (für die Edge Function im Docker-Netz erreichbar).
  nohup node tests/e2e/osm-stub.mjs >"$LOGS/osm-stub.log" 2>&1 &
  wait_for "OSM-Stellvertreter" 15 curl -sf http://127.0.0.1:8089/health

  # 2. Supabase ohne Dienste, die die Journey nicht braucht.
  supabase start -x studio,imgproxy,storage-api,logflare,vector,supavisor,postgres-meta
  status_env=$(mktemp)  # enthält Schlüssel – nicht ins Artefakt
  supabase status -o env >"$status_env"
  anon=$(grep -E '^ANON_KEY=' "$status_env" | cut -d= -f2- | tr -d '"')
  [ -n "$anon" ] || { echo "::error title=Supabase::kein ANON_KEY in supabase status"; exit 1; }
  echo "SUPABASE_ANON_KEY=$anon" >>"$GITHUB_ENV"

  # 3. Edge Functions mit Umgebung für den Stellvertreter. Erreichbar ist der Host über das
  #    Gateway des Supabase-Docker-Netzes.
  network=$(docker network ls --format '{{.Name}}' | grep -E '^supabase_network_' | head -n1)
  gateway=$(docker network inspect "$network" -f '{{(index .IPAM.Config 0).Gateway}}')
  echo "Docker-Netz $network, Gateway $gateway"
  cat >"$LOGS/functions.env" <<EOF
NOMINATIM_URL=http://$gateway:8089
OVERPASS_URL=http://$gateway:8089/api/interpreter
OSM_CONTACT=ci@afterhours.invalid
EOF
  nohup supabase functions serve --env-file "$LOGS/functions.env" >"$LOGS/functions.log" 2>&1 &
  # Ohne Anmeldung antwortet die Function mit 401 – dann läuft sie.
  wait_for "Edge Function places" 90 bash -c \
    "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:54321/functions/v1/places -H 'Content-Type: application/json' -d '{}')\" = 401 ]"

  # 4. Produktionsbuild gegen die lokale Umgebung, ausgeliefert auf Port 5173 (= site_url in config.toml).
  # VITE_SITE_URL = dieselbe Adresse: prüft, dass der Build og:image absolut macht (W6).
  VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY="$anon" VITE_SITE_URL=http://127.0.0.1:5173 npm run build
  nohup npx vite preview --host 127.0.0.1 --port 5173 --strictPort >"$LOGS/preview.log" 2>&1 &
  wait_for "App (vite preview)" 30 curl -sf http://127.0.0.1:5173/
}

logs() {
  for file in functions.log osm-stub.log preview.log; do
    [ -f "$LOGS/$file" ] || continue
    msg=$(tail -n 40 "$LOGS/$file" | sed 's/\x1b\[[0-9;]*m//g' | sed 's/%/%25/g' | awk '{printf "%s%%0A", $0}')
    echo "::error title=Protokoll $file::$msg"
  done
}

"$@"

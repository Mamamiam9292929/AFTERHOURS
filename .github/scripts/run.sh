#!/usr/bin/env bash
# Führt einen Befehl aus und meldet bei Fehlern die letzten Ausgabezeilen als Annotation.
# So sind Fehler auch über die Checks-API lesbar (gh api …/check-runs/<id>/annotations),
# ohne die Log-Archive herunterzuladen.
set -o pipefail
out=$(mktemp)
"$@" 2>&1 | tee "$out"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  msg=$(tail -n 60 "$out" | sed 's/\x1b\[[0-9;]*m//g' | sed 's/%/%25/g' | awk '{printf "%s%%0A", $0}')
  echo "::error title=$1 fehlgeschlagen::$msg"
fi
exit "$status"

#!/usr/bin/env bash
# Führt einen Befehl aus und meldet bei Fehlern die letzten Ausgabezeilen als Annotation.
# So sind Fehler auch über die Checks-API lesbar (gh api …/check-runs/<id>/annotations),
# ohne die Log-Archive herunterzuladen.
set -o pipefail
out=$(mktemp)
"$@" 2>&1 | tee "$out"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  # Annotationen sind auf ~4 KB begrenzt: Hinweise von psql und bestandene Testdateien weglassen,
  # damit der eigentliche Fehler nicht abgeschnitten wird.
  msg=$(grep -v -e 'NOTICE:' -e '\.\. ok$' "$out" | tail -n 60 | sed 's/\x1b\[[0-9;]*m//g' | sed 's/%/%25/g' | awk '{printf "%s%%0A", $0}')
  echo "::error title=$1 fehlgeschlagen::$msg"
fi
exit "$status"

# AFTERHOURS – Anweisungen für Claude

Social-Planning-App für Freundesgruppen. React 19 + Vite + TypeScript + Tailwind 4 als SPA, Backend vollständig in Supabase (Auth, PostgREST, RLS, RPC, Edge Functions). Oberfläche Deutsch, Zeitzone Europe/Berlin, Beträge in Cent/EUR. Eigentümer: Benito. Er antwortet auf Deutsch, will direkte, technisch präzise Antworten ohne Füllwörter.

Vor jeder Arbeit `README.md` (Stand, Architektur, Sicherheit) und `ROADMAP.md` lesen.

## Arbeitsweise

- Eine Aufgabe = ein Branch (`claude/<roadmap-id>-<kurzname>`) = ein Pull Request gegen `main`.
- Nie direkt auf `main` pushen, nie selbst mergen, nie deployen, keine Secrets anlegen. Benito prüft und mergt.
- Gebaut wird nur, was in `ROADMAP.md` den Status **Freigegeben** hat. Eigene Ideen kommen als Zeile mit Status **Vorschlag** in die Roadmap (Nutzen, Aufwand S/M/L, Abhängigkeiten, Akzeptanzkriterien) – nicht als Code.
- Produktentscheidungen (Preise, Partner, Recht, Kosten, externe Dienste mit Schlüssel) nicht raten: im PR unter „Offene Fragen" aufführen.
- Commits und PRs auf Deutsch. Commit-Nachrichten enden mit den Attributionszeilen, die die Sitzung vorgibt.

## Testen

Die Cloud-Sitzung hat in der Regel keinen Zugriff auf die npm-Registry und kein Docker. Maßgeblich ist deshalb GitHub Actions (`.github/workflows/ci.yml`): TypeScript, Produktionsbuild, pgTAP gegen Supabase, Deno-Tests der Edge Functions.

1. Branch pushen, PR als Entwurf öffnen (`gh pr create --draft`).
2. `gh pr checks --watch`. Bei Fehlern: Die Log-Archive sind aus der Sitzung oft nicht abrufbar. Die Ausgabe fehlgeschlagener Schritte steht deshalb als Annotation bereit: `gh api repos/{owner}/{repo}/check-runs/<job-id>/annotations` (Job-IDs: `gh run view <run-id> --json jobs`). Beheben, erneut pushen.
3. Erst wenn alles grün ist: PR auf „bereit" setzen (`gh pr ready`).
4. Ist ein Fehler nach drei Versuchen nicht lösbar: PR als Entwurf lassen, Ursache und Stand in die Beschreibung schreiben.

Lokal möglich, wenn vorhanden: `deno test supabase/functions/places/osm_test.ts`, `deno check …`.

## Architekturregeln (nicht verhandelbar)

- Frontend ist nicht vertrauenswürdig. Lesen über RLS-Policies, Schreiben über RPC-Funktionen in `supabase/migrations/`, die `auth.uid()` nutzen, Mitgliedschaft/Rolle prüfen, Eingaben bereinigen und `app_private.rate_limit` anwenden.
- Jede SECURITY-DEFINER-Funktion: `set search_path = ''`. Neue Tabellen und Funktionen: Rechte von `public, anon, authenticated` explizit entziehen, dann minimal vergeben. Der Strukturtest in `01_access_basics.test.sql` prüft das.
- Fehler aus RPCs: `raise exception '<schluessel>' using errcode = 'P0001'`; Text dazu in `src/i18n/de/common.ts` unter `errors.codes`.
- Neue Migration = neue Datei mit Zeitstempel. Bestehende Migrationen nie ändern (sie sind bei Benito schon eingespielt).
- Alle sichtbaren Texte in `src/i18n/de/*`, Zugriff über `t`.
- API-Schlüssel nur als Supabase-Secret in Edge Functions, nie mit `VITE_`-Präfix.
- Design-Tokens aus `src/styles/index.css`, Icons nur über `src/components/icons.ts`, Bausteine aus `src/components/ui`.

## Ehrlichkeitsregeln

- Nichts erfinden: keine Preise, Bewertungen, Öffnungszeiten, Verfügbarkeiten, Standorte. Unbekanntes als unbekannt anzeigen.
- Demo-Daten immer sichtbar kennzeichnen, nie unbemerkt mit echten Daten mischen.
- Keine Buchung, Zahlung oder Nachricht nach außen ohne ausdrückliche Bestätigung. Nie behaupten, etwas sei gebucht oder angerufen, wenn es technisch nicht passiert ist.
- Standortfreigabe bleibt standardmäßig aus. Keine Prämien mit Geldwert ohne bestätigten Partner.
- Keine Funktion durch ein statisches Mockup ersetzen. Was nicht fertig oder nicht getestet ist, steht so im PR und im README.

## Definition of Done

1. pgTAP-Test für jede neue RPC/Policy, inklusive Angriff aus Sicht eines Außenstehenden.
2. CI grün (TypeScript, Build, pgTAP, Deno).
3. Neuer Nutzerablauf: Schritt in `tests/e2e/journey.mjs`; Lade-, Leer- und Fehlerzustand vorhanden; Smartphone (390 px), Tablet, Desktop bedacht.
4. README aktualisiert (Stand, Datenmodell, Tests, was nicht geprüft ist), Roadmap-Status gesetzt.
5. PR-Beschreibung: Was, Warum, Wie getestet, Was offen ist, Offene Fragen.

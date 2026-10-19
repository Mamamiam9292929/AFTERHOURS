# AFTERHOURS – Anweisungen für Claude

Social-Planning-App für Freundesgruppen. React 19 + Vite + TypeScript + Tailwind 4 als SPA, Backend vollständig in Supabase (Auth, PostgREST, RLS, RPC, Edge Functions). Oberfläche Deutsch, Zeitzone Europe/Berlin, Beträge in Cent/EUR. Eigentümer: Benito. Er antwortet auf Deutsch, will direkte, technisch präzise Antworten ohne Füllwörter.

Vor jeder Arbeit `README.md` (Stand, Architektur, Sicherheit) und `ROADMAP.md` lesen.

## Arbeitsweise (Stand 12.10.2026: volle Eigenverantwortung)

Benito hat Claude die Weiterentwicklung vollständig übertragen: Claude entscheidet selbst über Prioritäten, neue Funktionen, Design und Ideen, und merged eigene PRs, sobald die CI grün ist.

- Eine Aufgabe = ein Branch (`claude/<roadmap-id>-<kurzname>`) = ein Pull Request gegen `main`. Nie direkt auf `main` pushen; gemergt wird per PR (Squash), erst wenn alle Checks grün sind.
- Priorität: 1. Fehler und Sicherheitslücken, 2. Fundament (Tests/CI), 2b. AFTERHOURS 2.0: S1–S7 (Benitos ausdrücklicher Wunsch vom 19.10.), 3. was am meisten dazu beiträgt, dass Gruppen die App nutzen, weiterempfehlen und wiederkommen, 4. Design-Feinschliff.
- `ROADMAP.md` ist die Arbeitsliste. Neue Ideen trägt Claude selbst ein (Nutzen, Aufwand, Akzeptanzkriterien) und darf sie direkt umsetzen.
- Design-Richtung: `docs/design/DESIGN.md` mit Konzept-Screens. Neue Screens folgen dieser Richtung.
- **Design-Stopp seit 19.10.2026:** Benito lässt ein komplett neues Design entwerfen (ROADMAP „AFTERHOURS 2.0“, V2). Bis er die Entwürfe freigibt, wird am Aussehen der App nichts geändert – keine Design-Aufgaben (D1–D5), neue Funktionen nur mit schlichter Oberfläche aus den vorhandenen Bausteinen. Danach gilt die neue Richtung aus `docs/design/DESIGN.md`.
- Keine generische KI-Optik, keine Platzhalter. Jede Design-Änderung mit Vorher/Nachher-Screenshots im PR.
- Commits und PRs auf Deutsch. Commit-Nachrichten enden mit den Attributionszeilen, die die Sitzung vorgibt.

### Was Claude trotz Eigenverantwortung nicht tut

- Nicht deployen, keine Domains, keine Secrets anlegen, nichts, was Geld kostet oder ein Konto bei einem Drittanbieter erfordert. Solche Schritte als „Für Benito" in `ROADMAP.md` notieren und im Bericht nennen.
- Keine Wachstumstricks auf Kosten der Nutzer: kein Auslesen von Adressbüchern, keine Nachrichten in fremdem Namen, kein Spam, keine erfundenen Nutzerzahlen oder Bewertungen, keine Dark Patterns (versteckte Abmeldung, künstliche Verknappung, Schuldgefühle).
- Keine Belohnungen mit Geldwert, keine Gewinnspiele, nichts Rechtliches entscheiden (Impressum, AGB, Altersgrenzen) – vorbereiten und als offene Frage markieren.
- Bestehende Migrationen nie ändern; Datenverlust ausschließen (keine `drop` auf Tabellen mit Nutzerdaten ohne Migration der Daten).

## Benitos Wunderliste (GitHub-Issue #3)

Benitos Übersicht auf GitHub: Issue „📋 Benitos Wunderliste" (#3). Nach jeder Änderung an der Roadmap (neue Idee, Start, Fertigstellung) den Text des Issues aktualisieren (`gh api -X PATCH repos/{owner}/{repo}/issues/3 -F body=@datei.md`):

- Abschnitte: Schon fertig · Fundament · Wachstum · Design · Neue Funktionen · Braucht dich.
- Je Eintrag: `- [x]` fertig bzw. `- [ ]` offen, bei laufender Arbeit `🔧` und Link zum PR, fett `**ID · Titel**`, darunter `Wofür:` in einem Satz in Alltagssprache (kein Fachjargon).
- Fertige Einträge wandern nach „Schon fertig", mit Link zum gemergten PR.

## Testen

Die Cloud-Sitzung hat in der Regel keinen Zugriff auf die npm-Registry und kein Docker. Maßgeblich ist deshalb GitHub Actions (`.github/workflows/ci.yml`): TypeScript, Produktionsbuild, pgTAP gegen Supabase, Deno-Tests der Edge Functions.

1. Branch pushen, PR als Entwurf öffnen. GraphQL ist in der Sitzung gesperrt, also REST: `gh api repos/{owner}/{repo}/pulls -f title=… -f head=<branch> -f base=main -F draft=true -F body=@datei.md`.
2. Checks abwarten: `gh api "repos/{owner}/{repo}/actions/runs?branch=<branch>&per_page=1"`, dann `…/actions/runs/<id>/jobs`. Bei Fehlern: Die Log-Archive sind aus der Sitzung oft nicht abrufbar. Die Ausgabe fehlgeschlagener Schritte steht deshalb als Annotation bereit: `gh api repos/{owner}/{repo}/check-runs/<job-id>/annotations` (Job-IDs aus `…/actions/runs/<id>/jobs`). Beheben, erneut pushen.
   Screenshots der Journey: Branch `screenshots/pr-<n>` (PR) bzw. `screenshots/main` (vorher) – `git fetch origin screenshots/pr-<n>`, im PR verlinken als `../blob/screenshots/pr-<n>/<datei>.png`.
3. Erst wenn alles grün ist: PR auf „bereit" setzen (`gh api -X POST repos/{owner}/{repo}/pulls/<n>/ccr/ready_for_review`) und mergen (`gh api -X PUT repos/{owner}/{repo}/pulls/<n>/merge -f merge_method=squash`). Danach Branch löschen.
4. Ist ein Fehler nach drei Versuchen nicht lösbar: PR als Entwurf lassen, Ursache und Stand in die Beschreibung schreiben, nicht mergen.

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

# AFTERHOURS

**Weniger planen. Mehr erleben.** Social-Planning-App für Freundesgruppen: Crew gründen, Freunde per Link einladen, Orte entdecken, abstimmen, aus dem Ergebnis einen Plan machen, zusagen, Reservierung und Fahrgemeinschaft festhalten.

| | |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, React Router, TanStack Query, Headless UI |
| Backend | Supabase: Postgres, Auth, Row Level Security, RPC-Funktionen, Realtime, optional eine Edge Function |
| Sprache, Region | Deutsch, Euro, Europe/Berlin (Textsystem für weitere Sprachen vorbereitet) |

## Inhalt

1. [Stand: was funktioniert, was Demo ist, was vorbereitet ist](#1-stand)
2. [Lokal starten](#2-lokal-starten)
3. [Supabase-Projekt einrichten (gehostet)](#3-supabase-projekt-einrichten-gehostet)
4. [Deployment](#4-deployment)
5. [Umgebungsvariablen](#5-umgebungsvariablen)
6. [Tests](#6-tests)
7. [Architektur](#7-architektur)
8. [Datenmodell](#8-datenmodell)
9. [Sicherheit und Datenschutz](#9-sicherheit-und-datenschutz)
10. [Erweitern](#10-erweitern)
11. [Was geprüft wurde – und was nicht](#11-was-geprüft-wurde--und-was-nicht)
12. [Vor dem Produktivstart](#12-vor-dem-produktivstart)

---

## 1. Stand

### Implementiert und getestet

| Bereich | Umfang |
|---|---|
| Konto | Registrierung mit E-Mail und Passwort, E-Mail-Bestätigung, Anmeldung, Passwort zurücksetzen und ändern, Abmelden, Datenexport (JSON), Konto löschen (serverseitig) |
| Onboarding | Anzeigename, Profilbild, Stadt, Interessen, Lieblingsaktivitäten, Budget, Entfernung, Benachrichtigungen – alles außer dem Namen optional. Wer über einen gültigen Einladungslink kommt, hat nur einen Schritt (W1 Etappe 2): die Einladung als kleines Ticket, darunter Name, Bild, Stadt und „<Crew> beitreten“ – Profil speichern und Beitritt mit einem Tipp; „Erst mal ohne Crew weiter“ speichert nur das Profil. Der Rest lässt sich in den Einstellungen nachtragen |
| Crews | Anlegen, umbenennen, löschen, verlassen; Rollen Owner/Admin/Mitglied; Mitglieder entfernen; Crew übergeben; automatische Nachfolge, wenn der Owner geht |
| Einladungen | Links mit Ablaufzeit und Nutzungslimit, widerrufbar; gespeichert wird nur der Hash des Tokens; Beitritt mit Vorschau und ausdrücklicher Zustimmung. Wer den Link ohne Konto öffnet, landet auf der Einladungs-Landingpage `/invite/<token>` (W1): Einladung als Ticket mit Crew, Vornamen der Mitglieder und dem nächsten Abend (nur Titel und Beginn), darunter direkt die Registrierung; nach der Bestätigung tritt man im verkürzten Onboarding mit einem ausdrücklichen Tipp bei (der Knopf nennt die Crew). Scheitert der Beitritt (Link inzwischen abgelaufen, Crew voll, Netz), führt die App auf die Beitrittsseite, die den Grund zeigt |
| Crew-Chat | Nachrichten schreiben und löschen |
| Echte Orte | Jede Stadt in Deutschland: Beim ersten Aufruf importiert die Edge Function `places` die Orte aus OpenStreetMap (Restaurants, Cafés, Bars, Kinos, Bowling, Minigolf, Bäder, Escape Rooms, Lasertag, Kart, Klettern, Theater, Museen, Zoos …), danach liegen sie 30 Tage in der Datenbank. Quelle und Stand stehen bei jedem Ort, Öffnungszeiten werden übersetzt oder im Original gezeigt |
| Discover | Freie Stadtwahl, Kategorien, Suche (serverseitig über alle Orte der Stadt), Filter (Preis, Entfernung ab Stadtmitte, Gruppengröße, Dauer, drinnen/draußen, Alter, jetzt geöffnet), Detailseite mit Öffnungszeiten, Karte (erst nach Klick), Meldefunktion |
| Abstimmungen | 1–10 Optionen aus Orten oder eigenen Vorschlägen, Termin je Option, Budget, Treffpunkt, Mindestteilnehmer, Frist; Antworten „Bin dabei / Vielleicht / Bin nicht dabei“, änderbar bis zum Ende; Zwischenstand, Beteiligung, Erinnerung; „Abstimmung teilen“ (W8); Ergebnis, Gleichstand, Stichwahl; automatisches Ende nach Fristablauf |
| Pläne | Aus einer Abstimmung oder direkt; Status Vorschlag → Bestätigt → Reservierung ausstehend → Gebucht → Abgeschlossen bzw. Abgesagt; Zu- und Absagen; Kosten pro Person und gesamt; Bearbeiten mit Benachrichtigung bei wesentlichen Änderungen; „Plan teilen“ (W8): Teilen-Menü des Geräts (Web Share API), sonst Text und Link in die Zwischenablage – geteilt werden nur Titel, Zeitpunkt und Link, keine Namen, Adressen oder Treffpunkte |
| Reservierung | Dokumentierter Ablauf: Entwurf → ausdrückliche Freigabe → Ergebnis eintragen. Die App reserviert nicht selbst (siehe unten) |
| Fahrgemeinschaften | Fahrt anbieten, Mitfahrt anfragen, Zusage durch die fahrende Person, Platzkontrolle |
| Rewards | Punkte-Ledger: 30 Punkte fürs Organisieren, 10 fürs Dabeisein, vergeben beim Abschließen eines Plans – serverseitig, einmalig, mit Tageslimit |
| Benachrichtigungen | In-App für alle im Konzept genannten Ereignisse, pro Gruppe abschaltbar, gelesen/ungelesen, löschen |
| Admin | Geschützter Bereich: Kennzahlen, Aktivitäten ein-/ausblenden und als geprüft markieren, Meldungen bearbeiten, Audit-Log |
| Installierbare App (W4) | Manifest, Icons und ein eigener Service Worker (`public/sw.js`, ohne Bibliothek, nur im Produktionsbuild). Hinweis „Hol dir AFTERHOURS auf den Homescreen“ auf Home – erst wenn du in einer Crew bist, nur wenn der Browser die Installation anbietet (Chromium: `beforeinstallprompt`) bzw. auf iPhone/iPad in Safari mit der Anleitung „Teilen → Zum Home-Bildschirm“; „Nicht jetzt“ hält ihn 30 Tage fern. Offline öffnet sich die App aus dem Cache und zeigt oben „Offline – Inhalte laden, sobald du wieder Netz hast.“; Daten (Pläne, Crews) sind offline noch nicht lesbar, darunter steht ein Ladekreis, bis das Netz zurück ist (Etappe 2) Ungelesene Benachrichtigungen als Zahl am App-Icon (Badging-API, wo vorhanden) |
| Oberfläche | Smartphone (untere Navigation), Tablet, Desktop (Seitenleiste); Lade-, Leer- und Fehlerzustände; Tastaturbedienung, sichtbarer Fokus, reduzierte Bewegung |

### Demo-Modus (klar gekennzeichnet)

- **Demo-Orte**: `supabase/seed.sql` enthält 35 erfundene Orte in Berlin, Hamburg, München und Köln, überall mit „Demo“ gekennzeichnet. Sobald für eine Stadt echte Orte importiert sind, blendet die Suche die Demo-Orte dort aus. Ohne Internetzugang der Edge Function bleiben sie sichtbar.
- **Was OpenStreetMap nicht liefert**, bleibt leer und wird als unbekannt angezeigt: Preise, Bewertungen, Dauer, Gruppengröße, Verfügbarkeit, Fotos (statt Fotos stehen Kategorie-Grafiken).
- **Reservierungen an Demo-Orten** laufen als „Testmodus“.
- **Partnerprämien** auf der Rewards-Seite sind drei als Demo markierte Beispiele; einlösen lässt sich nichts.

### Vorbereitet, aber nicht aktiv

| Funktion | Stand |
|---|---|
| Live-Standorte | Die Einstellung (aus / während Aktivität / ausgewählte Freunde / eine Crew) wird gespeichert, Standard ist „aus“. Es wird kein Gerätestandort abgefragt, gespeichert oder angezeigt; die App sagt das an jeder Stelle. Es gibt bewusst noch keine Standort-Tabelle |
| KI-Planungsassistent | Edge Function `supabase/functions/assistant` und Seite `/assistant` sind fertig, bleiben aber aus, bis ein KI-Schlüssel gesetzt ist ([Abschnitt 10](#ki-assistent)) |
| Automatische Buchung, KI-Telefonagent | Datenmodell kennt die Kanäle `online` und `phone_agent`; es gibt keine Anbindung. Die App behauptet nie, etwas gebucht zu haben |
| Push-Mitteilungen | Nicht vorhanden; die Benachrichtigungstabelle ist die Grundlage dafür |
| Partnerportal, Anlegen einzelner Orte im Admin | Rechte und Tabellen stehen, die Oberfläche fehlt |
| Google-/Apple-Anmeldung, Kalender-Export | Nicht vorhanden |

---

## 2. Lokal starten

Voraussetzungen: Node.js ≥ 20.19 und Docker (für die lokale Supabase-Umgebung). Die Supabase CLI kommt über `npm install` mit (`npx supabase …`).

**Windows, ein Klick:** `AFTERHOURS-starten.cmd` doppelklicken. Das Skript (`scripts/setup.ps1`) installiert bei Bedarf Node.js und Docker Desktop per winget, führt `npm install` aus, startet Supabase, schreibt `.env.local` und öffnet die App. Protokoll: `setup.log`. Beenden: Fenster „npm run dev“ schließen, dann `AFTERHOURS-stoppen.cmd`.

Von Hand:

```bash
npm install

# Lokale Supabase-Umgebung starten: Postgres, Auth, API, Realtime, Postfach (Mailpit).
# Spielt beim ersten Start alle Migrationen und die Demo-Daten ein und startet die Edge Functions.
npx supabase start

# URL und anon-Key aus der Ausgabe von `supabase start` (oder `supabase status`) eintragen:
cp .env.example .env.local

npm run dev            # http://127.0.0.1:5173
```

- Bestätigungs- und Reset-Mails landen lokal in Mailpit: <http://127.0.0.1:54324>
- Datenbank zurücksetzen (Migrationen und Demo-Daten neu einspielen): `supabase db reset`
- Administratorrolle vergeben (nur per SQL, z. B. im Studio unter <http://127.0.0.1:54323>):

  ```sql
  insert into public.app_admins (user_id)
  select id from auth.users where email = 'du@example.com';
  ```

Ohne `.env.local` zeigt die App einen Einrichtungshinweis statt einer Fehlermeldung.

---

## 3. Supabase-Projekt einrichten (gehostet)

1. Projekt auf <https://supabase.com> anlegen (Region in der EU wählen).
2. Schema einspielen:

   ```bash
   supabase login
   supabase link --project-ref <projekt-ref>
   supabase db push                 # Migrationen
   supabase db push --include-seed  # nur, wenn die Demo-Orte gewünscht sind
   ```

   Alternativ die Dateien aus `supabase/migrations/` der Reihe nach im SQL-Editor ausführen, danach bei Bedarf `supabase/seed.sql`.
   Edge Function für echte Orte:

   ```bash
   supabase secrets set OSM_CONTACT=kontakt@deine-domain.de   # Kennung gegenüber OpenStreetMap
   supabase functions deploy places
   ```
3. **Authentication → URL Configuration**: *Site URL* auf die Adresse der App setzen, unter *Redirect URLs* `https://deine-domain/**` eintragen.
4. **Authentication → Sign In / Providers → Email**: *Confirm email* aktiv lassen, Mindestlänge des Passworts auf 8.
5. **Authentication → Emails**: eigenen SMTP-Dienst eintragen. Der eingebaute Versand von Supabase ist auf wenige E-Mails pro Stunde begrenzt und nur für Tests gedacht. Die deutschen Vorlagen liegen in `supabase/templates/` (Inhalt in die jeweilige Vorlage kopieren; sie verwenden `{{ .ConfirmationURL }}`).
6. **Realtime** ist für die relevanten Tabellen bereits per Migration aktiviert (Publication `supabase_realtime`).
7. Optional, empfohlen: Extension `pg_cron` aktivieren und Abstimmungen minütlich automatisch schließen:

   ```sql
   select cron.schedule('afterhours-finalize-polls', '* * * * *',
     $$ select app_private.finalize_due_polls() $$);
   ```

   Ohne Cron endet eine abgelaufene Abstimmung, sobald ein Mitglied sie öffnet. Abstimmen ist nach Fristablauf in jedem Fall gesperrt.
8. Ersten Administrator eintragen (SQL wie oben).

Die App funktioniert mit dem klassischen `anon`-Key und mit dem neueren „publishable key“.

---

## 4. Deployment

Das Frontend ist eine statische Single-Page-App. `npm run build` erzeugt `dist/`.

**Vercel** – Repository importieren; Framework „Vite“ wird erkannt. Umgebungsvariablen aus [Abschnitt 5](#5-umgebungsvariablen) setzen. `vercel.json` liefert SPA-Rewrite und Sicherheits-Header.

**Netlify / Cloudflare Pages** – Build-Befehl `npm run build`, Ausgabeordner `dist`. `public/_redirects` und `public/_headers` werden mit ausgeliefert.

**Eigener Server** – `dist/` statisch ausliefern, alle unbekannten Pfade auf `index.html` umleiten und die Header aus `public/_headers` setzen.

Nach dem ersten Deployment die Domain in Supabase unter *Site URL* und *Redirect URLs* nachtragen ([Abschnitt 3](#3-supabase-projekt-einrichten-gehostet)). Nutzt du eine eigene Supabase-Domain, ergänze sie in der `connect-src`-Zeile der Content-Security-Policy (`vercel.json` bzw. `public/_headers`).

**Als App auf dem Homescreen**: Manifest, Icons und Service Worker (`public/sw.js`) sind vorhanden. `sw.js` muss mit `Cache-Control: no-cache` ausgeliefert werden (steht in `vercel.json` und `public/_headers`), damit Updates sofort greifen. Der Service Worker speichert nur die App selbst (HTML-Hülle, `/assets/`, `/fonts/`, `/icons/`, höchstens 150 Dateien) – nie Antworten von Supabase. Für die App-Stores lässt sich die SPA später mit Capacitor verpacken.

---

## 5. Umgebungsvariablen

Frontend (`.env.local` bzw. beim Hoster) – ausschließlich öffentliche Werte:

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `VITE_SUPABASE_URL` | ja | API-Adresse des Supabase-Projekts |
| `VITE_SUPABASE_ANON_KEY` | ja | anon- bzw. publishable Key (öffentlich; der Schutz kommt aus RLS) |
| `VITE_SITE_URL` | nein | Öffentliche Adresse der App für Einladungs- und E-Mail-Links. Leer = aktuelle Browser-Adresse |
| `VITE_ASSISTANT_ENABLED` | nein | `true`, sobald die Edge Function `assistant` deployt ist |

Server-Secrets (nie ins Frontend, nie in `.env.local`): `supabase secrets set …`

| Secret | Wofür |
|---|---|
| `OSM_CONTACT` | E-Mail oder Website als Kennung gegenüber OpenStreetMap (Nominatim-Regeln verlangen das im Produktivbetrieb) |
| `OVERPASS_URL`, `NOMINATIM_URL` | optional, eigener oder kommerzieller OSM-Dienst statt der öffentlichen Server |
| `ANTHROPIC_API_KEY` | nur für den KI-Assistenten |
| `ASSISTANT_MODEL` | optional, Standard `claude-haiku-5-5` |
| `ALLOWED_ORIGIN` | optional, beschränkt CORS der Edge Functions auf die App-Domain |

Den `service_role`-Key setzt Supabase in Edge Functions automatisch; nur die Function `places` nutzt ihn, um importierte Orte zu schreiben. Er gehört nie ins Frontend.

---

## 6. Tests

```bash
npm run typecheck      # TypeScript
npm run test:db        # 338 pgTAP-Prüfungen der Datenbank (supabase test db)
deno test supabase/functions/places/osm_test.ts   # OSM-Umwandlung und Öffnungszeiten
npm run test:e2e       # komplette Nutzerjourney im Browser (Playwright)
npm run build && npm run size   # Build-Größe gegen scripts/bundle-budget.json
```

**Build-Größe (`scripts/bundle-size.mjs`)** – misst nach dem Build die gzip-Größe dessen, was beim ersten Öffnen geladen wird (Skripte, Modul-Preloads und CSS aus `dist/index.html`), den größten Seiten-Chunk und alle Skripte zusammen. Grenzen in `scripts/bundle-budget.json` (Stand Oktober 2026: Start 201 kB JavaScript + 10 kB CSS, größte Seite 22 kB). Jede Seite ist ein eigener Chunk; React/Router, Supabase und TanStack Query liegen in eigenen Bibliotheks-Chunks, die nach einem Update im Browser-Cache bleiben. In der CI läuft die Prüfung im Job „TypeScript und Build“; die Tabelle steht in der Zusammenfassung des Laufs und als Annotation. Wer eine Grenze bewusst anhebt, begründet das im PR.

**Datenbank (`supabase/tests/database/`)** – prüft Berechtigungen aus Sicht echter API-Rollen: RLS auf jeder Tabelle, keine Rechte für `anon`, Rollenregeln in Crews, Einladungslinks (Ablauf, Limit, Widerruf), öffentliche Einladungsvorschau ohne Konto (nur freigegebene Felder, Rate Limit pro Link, ungültige Links verraten nichts), eine Stimme pro Person und Option, Ergebnislogik, Fristablauf, Statusübergänge von Plänen und Reservierungen, Punktevergabe ohne Doppelbuchung, Datenexport, Kontolöschung, Import echter Orte (Sperre, Kontingent, Aktualisierung, Deaktivierung verschwundener Orte, Suche).

**OSM-Umwandlung (`supabase/functions/places/osm_test.ts`)** – Kategorien, Adressen, Links (nur https), Dubletten und der Öffnungszeiten-Parser: übersetzt werden nur sichere Fälle, alles andere bleibt Originaltext.

**End-to-End (`tests/e2e/journey.mjs`)** – vier Konten auf Smartphone, Tablet und Desktop spielen die Journey aus dem Konzept durch (Schritte 1–11), dazu Gleichstand/Stichwahl, Fristablauf, direkter Plan, Admin, Import echter Orte, Widerruf, Einstellungen, Kontolöschung, Passwort-Reset und Fehlerzustände. Ein Außenstehender greift zusätzlich direkt auf die API zu; alle Versuche müssen scheitern. Vor dem ersten Lauf: `npx playwright install chromium`.

```bash
# App und lokale Supabase-Umgebung laufen; dann:
SUPABASE_ANON_KEY=<anon-key> \
E2E_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
E2E_SCREENSHOTS=tests/e2e/screenshots \
npm run test:e2e
```

Der Test legt Konten und Daten an – nur gegen die lokale Umgebung laufen lassen. Alle Schalter stehen im Kopf der Datei.

**Barrierefreiheit (in der Journey)** – an jedem Screenshot-Punkt (rund 45 Bildschirme auf Smartphone, Tablet und Desktop) prüft [axe-core](https://github.com/dequelabs/axe-core) 4.10.3 die Seite gegen WCAG 2.1 A/AA: Kontrast, Beschriftungen, Rollen, Überschriften, Sprache. Befunde der Stufe „critical“/„serious“ lassen den Lauf scheitern, leichtere werden nur aufgelistet; der vollständige Bericht liegt als `a11y.json` neben den Screenshots. Dazu ein Tastaturschritt: Anmeldung nur mit Tab und Enter, jeder Halt muss sichtbar markiert sein. axe-core steht noch nicht im Lockfile (die Entwicklungsumgebung hatte keinen npm-Zugriff); die CI installiert es vor dem Lauf, lokal `npm install --no-save axe-core@4.10.3`. Abschalten mit `E2E_A11Y=0`. Grenzen: axe findet erfahrungsgemäß nur einen Teil der Probleme; Screenreader-Bedienung und Tastaturwege jenseits der Anmeldung sind nicht automatisch geprüft.

**In GitHub Actions** läuft die Journey bei jedem Pull Request (Job „Browser-Journey“): `.github/scripts/e2e.sh setup` startet die lokale Supabase-Umgebung, die Edge Functions und den OSM-Stellvertreter `tests/e2e/osm-stub.mjs` (Nominatim und Overpass mit festem Datenbestand: Leipzig mit 2.601 Orten, „frankfurt“ → „Frankfurt am Main“, „Atlantis“ unbekannt), baut die App und liefert sie mit `vite preview` aus. Screenshots und Protokolle liegen danach als Artefakt `journey` am Lauf. Die Screenshots legt `.github/scripts/screenshots.sh` zusätzlich auf einen eigenen Branch: `screenshots/main` (Stand von main) und `screenshots/pr-<n>` (Stand eines PRs, nur für PRs aus diesem Repository). Jeder Lauf ersetzt den Branch durch einen einzigen Commit. So lassen sich Vorher/Nachher im PR verlinken (`…/blob/screenshots/pr-<n>/04-home-neu-mobile.png`) oder lokal per `git fetch origin screenshots/main` ansehen. Lokal lässt sich der Stellvertreter ebenso nutzen: `node tests/e2e/osm-stub.mjs` und in `supabase/functions/.env` `NOMINATIM_URL`/`OVERPASS_URL` auf ihn zeigen lassen.

---

## 7. Architektur

```
Browser (React-SPA)
   │  nur anon-Key + Sitzung der angemeldeten Person
   ▼
Supabase API ──► Auth        Registrierung, Sitzungen, E-Mails
             ──► PostgREST   Lesen über RLS-Policies
                             Schreiben über geprüfte RPC-Funktionen
             ──► Realtime    Änderungen an Stimmen, Plänen, Nachrichten
             ──► Edge Function „places“    OSM-Import pro Stadt (Nominatim + Overpass)
             ──► Edge Function „assistant“ (optional, hält den KI-Schlüssel)
```

**Warum eine SPA statt Next.js?** Die App liegt vollständig hinter der Anmeldung und braucht keine Suchmaschinen-Seiten. Mit Supabase als Backend sitzt jede Berechtigungsprüfung in der Datenbank; ein zusätzlicher Server wäre eine zweite Stelle, an der Regeln auseinanderlaufen können. Eine SPA lässt sich zudem statisch hosten und später als native App verpacken.

**Grundsatz der Datenebene:** Das Frontend ist nicht vertrauenswürdig. Es darf lesen, was die RLS-Policies erlauben, und schreibt fast ausschließlich über RPC-Funktionen, die die aufrufende Person über `auth.uid()` ermitteln, Rolle und Mitgliedschaft prüfen, Eingaben bereinigen und Rate Limits anwenden.

```
src/
  app/            Router, Fehlerseiten
  components/     UI-Bausteine (Button, Field, Dialog, Avatar …), App-Rahmen, Icons
  features/       je Bereich: api.ts (Datenzugriff), Seiten, Komponenten
    auth/  onboarding/  home/  discover/  crews/  polls/  plans/
    rewards/  notifications/  profile/  admin/  assistant/
  i18n/           Textsystem (de/…); alle sichtbaren Texte
  lib/            Supabase-Client, Zeit (Europe/Berlin), Formate, Karten, Realtime
  data/           Städte, Interessen, Kategorien
  styles/         Design-Tokens und Tailwind
supabase/
  migrations/     1 Schema · 2 Sicherheit · 3 Interna · 4 API · 5 echte Orte (OSM)
  seed.sql        Demo-Orte
  tests/database/ pgTAP
  functions/      Edge Functions „places“ (OSM-Import) und „assistant“
  templates/      E-Mail-Vorlagen
tests/e2e/        Playwright-Journey
```

**Design** – Richtung: `docs/design/DESIGN.md` („Wow, aber nicht zu viel“), Umsetzung in Etappen (Roadmap D0). Home: Plakat-Überschrift in Versalien aus echten Daten (Countdown bis zum nächsten zugesagten Plan, sonst die Leitfrage) mit einem Schlüsselwort in Lime, darunter der nächste Plan als großes, leicht schräges Ticket mit echten Kerben (CSS-Maske), Strichcode-Detail und „2 von 3 dabei“, dezenter Lime-Schein mit feinem Korn oben. Abstimmung: die Frage als Plakat-Überschrift (letztes Wort in Lime, `PosterTitle`), Restzeit als Lime-Pille neben „x von y haben abgestimmt“, jede Option mit Titel in Display-Versalien und dem Stand als Balken (Lime-Verlauf = Anteil der Zusagen an der Crew, Avatare, Zahl in Display-Schrift); eigene Zusage mit Lime-Rahmen, führende Option mit „Vorn“-Badge und leichtem Lime-Schimmer. Discover: Stadt und Tageszeit als Plakat („Leipzig / heute Abend“), darüber hinaus beim Stöbern (nicht bei einer Suche) ein Ort groß auf der Bühne – bevorzugt einer, der laut bekannten Öffnungszeiten jetzt offen hat, dann der nächstgelegene – mit Kategorie-Grafik auf Lime-Schein, Namen in Display-Versalien, „Jetzt geöffnet“ nur bei bekannten Öffnungszeiten, Entfernung ehrlich als Luftlinie ab Stadtmitte, Aktionen „Zur Abstimmung“ und „Details“; die übrigen Orte folgen als Raster. Die horizontale Reihe „Auch beliebt bei Crews“ aus dem Konzept fehlt bewusst: Beliebtheit wird noch nicht gemessen. Crews und Plans: Plakat-Überschrift aus den eigenen Daten (`PosterLine`) – „5 Freunde in 2 Crews“ (verschiedene Mitglieder ohne dich), „3 Abende in Sicht“ (anstehende Pläne), sonst „2 Fragen offen“ (laufende Abstimmungen), sonst „Eure Pläne“/„Deine Crews“; die Zahl steht in Lime. Planseite: Kopf ist dasselbe große Ticket wie auf Home (Maske mit echten Löchern, Strichcode, leicht schräg) – ohne Link, Titel als h1, daneben ein Countdown in Lime („Heute Abend“, „Morgen“, „In 3 Tagen“; nur in den nächsten 13 Tagen, sonst nichts), dahinter der Lichtschein; vergangene und abgesagte Pläne liegen gerade, ohne Schatten und Schein. Darunter „Bist du dabei?“ als Plakat-Frage; fehlt die eigene Antwort, trägt die Karte einen Lime-Schimmer. Crew-Seite: Name als Plakat (letztes Wort in Lime), darunter Mitglieder und – ab dem ersten abgeschlossenen Plan – „3 gemeinsame Abende“; in der Übersicht steht der nächste nicht abgesagte Plan als großes Ticket unter „Als Nächstes“, weitere Pläne folgen unter „Danach“. Profil: eine Stammkarte im Ticket-Stil (gleiche Maske, leicht schräg, Lichtschein dahinter) – der Abriss zählt die erlebten Abende (abgeschlossene Pläne, bei denen du nicht abgesagt hast) und wird erst ab dem ersten lime; rechts Profilbild, Name als Plakat, Stadt, „Dabei seit Oktober 2026“ aus dem Kontodatum und darunter Crews, Geplant und Punkte. Solange eine Zahl lädt, steht „–“ statt einer falschen 0. Tab-Leiste auf Smartphone/Tablet halbtransparent mit Unschärfe (nur, wo der Browser `backdrop-filter` kann; sonst deckend). Nicht auf echten Geräten geprüft, nur in der Browser-Journey (390 px, Tablet, Desktop). Anthrazit als Fläche, fast Schwarz für die Navigation, Lime als einziger Akzent. Überschriften und Zahlen in *Big Shoulders Display*, Fließtext in *Figtree* (beide SIL Open Font License, lokal eingebunden in `public/fonts/`). Wiederkehrendes Motiv ist das Ticket: Ein Plan sieht aus wie eine Eintrittskarte, deren Abriss die eigene Antwort zeigt – grün (Lime) dabei, gelb vielleicht, rot abgesagt, grau ohne Antwort oder wenn der Plan vorbei ist; auf dem großen Ticket ersetzt dann ein Stempel („Dabei“, „Vielleicht“, „Abgesagt“) den Strichcode und schlägt beim Antworten neu auf, das Ticket gibt kurz nach. Bewegung (D7): Seitenwechsel laufen als View Transition (alte Seite blendet aus, neue steigt 14 px auf; Kopf, Tab-Leiste und Seitenleiste stehen still, der Lime-Strich gleitet zum neuen Tab, ein angetipptes Ticket gleitet zum großen Ticket der Planseite). Browser ohne View Transitions (u. a. ältere Firefox-Versionen) wechseln ohne Übergang; Zurück im Browser nutzt den Übergang nur, wenn der Hinweg einen hatte. Die Seiten der Navigation werden im Leerlauf vorgeladen, die Planseite übernimmt den Plan sofort aus der Liste. `prefers-reduced-motion` schaltet alles ab. Nicht auf echten Geräten geprüft. Tokens stehen in `src/styles/index.css`.

---

## 8. Datenmodell

22 Tabellen im Schema `public`. Geldbeträge sind Cent-Werte, Zeitpunkte `timestamptz`.

| Tabelle | Inhalt |
|---|---|
| `profiles` | „users“ aus dem Konzept: Anzeigename, Profilbild, Stadt, Interessen. Zugangsdaten liegen in `auth.users` |
| `user_settings` | Private Einstellungen: Standortfreigabe, Budget, Entfernung, Benachrichtigungen |
| `app_admins` | Administratorrolle (ohne API-Zugriff) |
| `crews`, `crew_members`, `crew_invitations`, `crew_messages` | Gruppen, Rollen, Einladungslinks (nur Hash), Chat |
| `activities` | Orte mit `data_source` (demo / provider / partner / manual), `provider_id`/`external_id` (z. B. `osm` / `node/123`), `source_url`, `last_verified_at` |
| `place_regions` | Importierte Städte: OSM-Objekt, Status, Anzahl, Stand, weitere Schreibweisen |
| `polls`, `poll_options`, `poll_votes` | Abstimmungen; eine Stimme je Person und Option (Unique-Index) |
| `plans`, `plan_participants` | Pläne und Zusagen |
| `booking_requests` | Reservierungsanfragen mit Status und Zeitpunkt der Nutzerfreigabe |
| `ride_offers`, `ride_requests` | Fahrgemeinschaften |
| `reward_transactions` | Punkte-Ledger (Unique-Index gegen Doppelvergabe) |
| `notifications` | In-App-Benachrichtigungen (Typ + Daten; der Text entsteht in der App) |
| `audit_log`, `rate_limit_hits`, `reports` | Protokoll kritischer Aktionen, Rate Limits, Meldungen |

Abweichungen vom Konzept: `users` heißt `profiles` (Supabase-Konvention). `notifications` hat statt `title`/`body` die Spalten `type` und `payload`, damit Texte übersetzbar bleiben. Budget und Entfernung liegen in `user_settings`, weil Crew-Mitglieder sie nicht sehen sollen. Der Planstatus „Abstimmung läuft“ ist kein gespeicherter Wert: Laufende Abstimmungen erscheinen unter *Plans → In Abstimmung*.

---

## 9. Sicherheit und Datenschutz

| Anforderung | Umsetzung |
|---|---|
| Authentifizierung | Supabase Auth (Passwörter gehasht, E-Mail-Bestätigung, Rate Limits) |
| Serverseitige Berechtigungen | RLS auf allen 22 Tabellen (30 Policies); `anon` hat keine Tabellenrechte und darf genau eine Funktion ausführen: `preview_public_invitation` (W1, siehe unten); Schreiben über 40 RPC-Funktionen für angemeldete Nutzer mit festem `search_path`; vier weitere nur für die Edge Function `places` |
| Importierte Orte | Nutzer können einen Import nur anstoßen, nicht selbst Orte schreiben. Kontingent: 10 Importe pro Person und Stunde, 60 insgesamt; Sperre gegen parallele Importe; Links nur https, Quell-Links nur auf openstreetmap.org |
| Crew-Grenzen | Jede Policy und jede Funktion prüft die Mitgliedschaft in der Datenbank |
| Eingaben | Bereinigung und Grenzen in den Funktionen, zusätzlich Check-Constraints auf den Tabellen |
| Einladungslinks | 244 Bit Zufall, nur SHA-256-Hash gespeichert, Ablauf (max. 30 Tage), Nutzungslimit (max. 50), widerrufbar, Rate Limit auf Abfragen |
| Einladung ohne Konto (W1) | `preview_public_invitation` liefert bei gültigem Link nur Crew-Name, Emoji, Zahl der Mitglieder, Vornamen (erstes Wort des Anzeigenamens, höchstens sechs, keine Bilder), Vorname der einladenden Person und vom nächsten Plan Titel und Beginn – keine IDs, Adressen, Treffpunkte, Notizen, Kosten oder E-Mails. Ungültige, widerrufene und abgelaufene Links liefern nur ihren Status. Rate Limit 60 Abrufe je Link in 10 Minuten (`app_private.rate_limit_key`); ungültige Tokens schreiben nichts. Wer den Link hat, sieht diese Angaben – so wie bei Gruppenlinks in Messengern |
| Punkte | Nur per Trigger beim Abschließen; nicht direkt schreibbar; Unique-Index, Tageslimit, Audit-Eintrag |
| Rate Limits | Pro Person und Aktion in der Datenbank, für die Einladungsvorschau ohne Konto pro Link (Crews, Einladungen, Abstimmungen, Stimmen, Nachrichten, Pläne, Meldungen, Assistent, Ortsimport) |
| Secrets | Im Frontend nur der öffentliche anon-Key; KI-Schlüssel nur als Secret der Edge Function |
| Protokoll | `audit_log` für Rollenwechsel, Entfernen, Einladungen, Abstimmungsende, Planstatus, Reservierung, Punkte, Kontolöschung |
| Fehlermeldungen | Die Oberfläche zeigt übersetzte, allgemeine Meldungen; technische Details nur in der Konsole |
| Browser | Content-Security-Policy ohne Inline-Skripte, kein Nachladen von Schriften oder Trackern, Karte erst nach Klick |
| Standort | Opt-in, Standard „aus“; in dieser Version wird kein Standort erhoben |
| Offline-Cache (W4) | Der Service Worker bedient nur Anfragen an die eigene Adresse und cacht nur App-Dateien; Supabase-Anfragen (Nutzerdaten, Sitzung) laufen nie durch ihn. Beim Abmelden bleiben deshalb keine Daten im Cache |
| Betroffenenrechte | Datenexport und sofortige Kontolöschung in den Einstellungen |

Die Seite `/privacy` beschreibt das in einfachen Worten. Sie ist **keine** rechtlich geprüfte Datenschutzerklärung.

---

## 10. Erweitern

**Echte Orte** – Ablauf: Discover fragt `place_region_status`; fehlt die Stadt oder ist sie älter als 30 Tage, ruft die App die Edge Function `places` auf. Sie prüft das Kontingent (`request_place_sync`), sucht die Stadt bei Nominatim, sperrt sie (`begin_place_sync`), fragt Overpass ab, wandelt in `osm.ts` um und schreibt in Stapeln (`ingest_place_batch`, `complete_place_sync`). Orte, die bei OSM verschwunden sind, werden deaktiviert, nicht gelöscht – Abstimmungen und Pläne verweisen weiter auf sie. Weitere Kategorien: Abfrage in `buildOverpassQuery` und Zuordnung in `categorize` ergänzen.

Die öffentlichen OSM-Server sind für moderate Last gedacht (Nominatim: 1 Anfrage/Sekunde mit Kennung). Für viele Nutzer eine eigene Overpass-Instanz oder einen kommerziellen Anbieter über `OVERPASS_URL`/`NOMINATIM_URL` eintragen. Ein weiterer Anbieter (Google Places, Foursquare …) braucht eine eigene Edge Function mit Schlüssel als Secret; seine Nutzungsbedingungen zur Speicherdauer beachten. Demo-Daten entfernen: `delete from public.activities where data_source = 'demo';`

**Karten** – `src/lib/maps.ts` kapselt den Anbieter (Standard: OpenStreetMap ohne Schlüssel). Für Mapbox, Google Maps o. Ä. `mapProvider` ersetzen und die Domain in `frame-src`/`connect-src` der CSP ergänzen.

<a id="ki-assistent"></a>
**KI-Assistent** – Die KI versteht nur die Anfrage (Gruppengröße, Budget, Kategorien). Auswahl und Begründung der Vorschläge erzeugt gewöhnlicher Code aus der Tabelle `activities`; der Assistent kann deshalb nichts erfinden. Aktivieren:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-…
supabase functions deploy assistant
# beim Hoster: VITE_ASSISTANT_ENABLED=true, danach neu bauen
```

Pro Person sind 20 Anfragen pro Stunde erlaubt. Ein anderer KI-Anbieter erfordert nur eine andere Implementierung von `understand()` in `supabase/functions/assistant/index.ts`.

**Reservierungen** – Für eine Buchungsintegration eine Edge Function ergänzen, die `booking_requests` mit `channel = 'online'` bearbeitet. Die Regel bleibt: ohne `confirmed_by_user_at` verlässt keine Anfrage den Entwurf, und „Bestätigt“ gibt es nur mit Bestätigung des Anbieters. Für einen Telefonagenten gilt dasselbe; zusätzlich sind Kennzeichnung als automatisierter Anruf, Aufzeichnungs- und Telekommunikationsrecht zu klären.

**Push** – Ein Database Webhook auf `notifications` kann einen Push-Dienst auslösen; die Texte liegen in `src/i18n/de/misc.ts`.

**Live-Standorte** – Erfordert eine eigene Tabelle mit kurzer Aufbewahrung, RLS anhand von `location_sharing_mode`, eine ausdrückliche Einwilligung beim ersten Teilen und einen Kartenanbieter.

**Profilbilder in Supabase Storage** – Aktuell liegen sie als 128-Pixel-JPEG im Profil. Für größere Bilder einen Bucket mit Policies anlegen und `avatar_url` auf die https-Adresse setzen; das Feld akzeptiert beides.

**Weitere Sprache** – `src/i18n/en/index.ts` anlegen (`satisfies Messages`), in `src/i18n/index.ts` eintragen. Formate liegen in `src/lib/time.ts` und `src/lib/format.ts`.

---

## 11. Was geprüft wurde – und was nicht

Entwickelt wurde in einer Umgebung ohne Zugriff auf die npm-Registry und ohne Docker. Geprüft habe ich deshalb so:

| Geprüft | Wie |
|---|---|
| Migrationen und Demo-Daten | Mit der echten Supabase CLI (2.120) per `supabase db push --include-seed` gegen Postgres 16 eingespielt, als nicht privilegierte Rolle `postgres` |
| Datenbanklogik und Berechtigungen | 338 pgTAP-Prüfungen, als `postgres` und auf einer Datenbank mit Bestandsdaten |
| Auth | Original-Binary von Supabase Auth (GoTrue 2.197) inklusive echter Bestätigungs- und Reset-E-Mails über SMTP |
| API | Original-Binary von PostgREST 14 |
| Frontend | TypeScript-Prüfung ohne Fehler; Bundle mit esbuild gegen die Original-Quellen von supabase-js 2.117, react-router 6.30 und TanStack Query 5.90 |
| Nutzerjourney | 186 Browser-Prüfungen (Chromium), als Produktiv- und als Entwicklungs-Build (React StrictMode), ausgeliefert mit der Content-Security-Policy aus `vercel.json` |
| Edge Functions | Mit Deno 2.9 typgeprüft und lokal ausgeführt. `places` gegen einen Stellvertreter für Nominatim/Overpass mit 2.600 Orten: Stapelimport, Alias, Umkreissuche, Zeitüberschreitung, Kontingent, Anmeldung |
| CI (GitHub Actions) | Bei jedem PR: TypeScript, Produktionsbuild, Build-Größe, pgTAP im Supabase-Container (`supabase test db`), Deno-Tests, Browser-Journey gegen lokale Supabase-Umgebung und OSM-Stellvertreter |
| Windows-Installation | `AFTERHOURS-starten.cmd` auf Windows 11 mit Windows PowerShell 5.1: Node per winget, Docker Desktop, `npm install`, `supabase start`, Vite-Entwicklungsserver laufen |

| Nicht geprüft | Folge |
|---|---|
| Import gegen die echten OSM-Server | Getestet gegen einen Stellvertreter mit dem Antwortformat von Nominatim und Overpass. Laufzeit und Datenmenge großer Städte (Berlin: mehrere Tausend Orte) hängen vom öffentlichen Overpass-Server ab |
| Supabase Realtime | Der Code abonniert Änderungen; ohne Verbindung lädt die App im Takt von 8–45 Sekunden nach. Getestet ist nur dieser Rückfall |
| Echter KI-Aufruf | Die Edge Function lief gegen einen Stellvertreter, der das Anfrageformat prüft. Modellname und Antwort eines echten Modells sind ungetestet |
| Eigene E-Mail-Vorlagen | Getestet mit den Standardvorlagen von Supabase Auth |
| Safari, Firefox, echte Mobilgeräte | Getestet nur in Chromium mit Geräte-Viewports |
| Lasttests | Keine |
| Installation und Offline auf echten Geräten | Die Journey stellt das Installations-Angebot und die Badging-API nach (Headless-Chromium hat beides nicht) und prüft Service Worker, Cache-Inhalt und Offline-Start in Chromium. Installation unter Android/iOS und der Zähler am Icon sind nicht auf Geräten geprüft |
| Barrierefreiheit jenseits von axe-core | Automatisch geprüft sind WCAG-Regeln, die axe erkennt, und die Tastatur-Anmeldung. Screenreader (VoiceOver, TalkBack) und Tastaturwege durch die übrigen Abläufe nicht |

---

## 12. Vor dem Produktivstart

- Datenschutzerklärung, Impressum und Nutzungsbedingungen rechtlich erstellen lassen; `/privacy` ersetzen oder ergänzen.
- Mindestalter und Einwilligung klären. Die Registrierung fragt „mindestens 16 Jahre“ ab (Art. 8 DSGVO, deutsche Schwelle); eine Altersprüfung ist das nicht.
- Auftragsverarbeitungsvertrag mit Supabase und dem E-Mail-Dienst abschließen, EU-Region wählen.
- Eigenen SMTP-Dienst einrichten; Absenderdomain mit SPF/DKIM.
- In Supabase: Schutz vor geleakten Passwörtern und CAPTCHA für die Registrierung aktivieren, Rate Limits prüfen, Backups einrichten (Point-in-Time-Recovery).
- `pg_cron` für das Schließen von Abstimmungen aktivieren.
- Demo-Daten entfernen oder bewusst behalten.
- `OSM_CONTACT` setzen; bei vielen Nutzern eigenen Overpass-/Nominatim-Dienst verwenden.
- Bars und Nachtleben: Für Minderjährige ausblenden, sobald das Alter bekannt ist (bisher wird es nicht erhoben).
- Moderation: Meldungen landen im Admin-Bereich; ein Verfahren zum Sperren von Konten fehlt.
- Fehler-Monitoring (z. B. Sentry) ergänzen.
- Rewards mit Geldwert, Auszahlungen oder Partnerprämien erst nach steuerlicher und rechtlicher Prüfung.

## Lizenzen

Schriften: *Big Shoulders Display* und *Figtree* unter der SIL Open Font License 1.1 (`public/fonts/OFL-*.txt`). Icons: Lucide über `react-icons` (ISC). Karten- und Ortsdaten: © OpenStreetMap-Mitwirkende, Open Database License (ODbL) 1.0 – die App nennt die Quelle in Discover und bei jedem Ort.

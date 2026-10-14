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
| Öffentliche Startseite (W6) | Wer `/` ohne Konto öffnet, sieht statt der Anmeldung die Startseite (`src/features/landing/LandingPage.tsx`, eigener Chunk): Plakat-Überschrift, was die App kann, „So wird aus einer Frage ein Abend“ in drei Schritten, sechs Funktionen, Datenschutz in einfachen Worten, Schluss-Ticket „Wer fragt diesmal in der Gruppe? – Du.“. „Crew gründen“ führt zur Registrierung (danach Onboarding und geführter Start), „Anmelden“ zur Anmeldung; das Logo auf Anmelde- und Registrierungsseite führt zurück. Die Bilder sind echte Bausteine der App (großes Ticket, Stimmbalken) mit erfundenem Inhalt, beide sichtbar als „Beispiel“ markiert; das Datum im Beispiel ist immer der kommende Samstag. Keine Nutzerzahlen, Bewertungen oder Preise. Angemeldete leitet `/` direkt zu `/home`; geschützte Adressen führen ohne Konto weiter zur Anmeldung. Vorschau in Messengern und Suchmaschinen (W6 Etappe 2): `index.html` trägt Titel, Beschreibung und Open-Graph-/Twitter-Tags mit dem Vorschaubild `public/og/home.png` (1200 × 630, Quelle `docs/design/og-home.html`, Beispiel-Abstimmung im Bild als „Beispiel“ markiert). Ist `VITE_SITE_URL` beim Build gesetzt, macht `scripts/og-image.mjs` (Vite-Plugin) die Bildadresse absolut; geteilte Pläne (`/s/<token>`) ersetzen diese Tags vollständig durch ihre eigenen |
| Onboarding | Anzeigename, Profilbild, Stadt, Interessen, Lieblingsaktivitäten, Budget, Entfernung, Benachrichtigungen – alles außer dem Namen optional. Wer über einen gültigen Einladungslink kommt, hat nur einen Schritt (W1 Etappe 2): die Einladung als kleines Ticket, darunter Name, Bild, Stadt und „<Crew> beitreten“ – Profil speichern und Beitritt mit einem Tipp; „Erst mal ohne Crew weiter“ speichert nur das Profil. Der Rest lässt sich in den Einstellungen nachtragen |
| Geführter Start (W5) | Wer sich ohne Einladungslink registriert, landet nach dem Onboarding auf `/start` (auf Home: „Erster Plan in 60 Sekunden“): 1. Crew gründen (Name, Symbol) → 2. Einladungslink teilen (7 Tage, 20 Personen, Teilen-Menü des Geräts oder Kopieren; überspringbar) → 3. Abstimmung „Was machen wir am Samstag?“ mit bis zu drei Orten aus der eigenen Stadt (dieselbe Auswahl wie „Ideen für euch“ auf Home: Interessen, Budget, echte bzw. als Demo markierte Orte – nichts erfunden), Freitag oder Samstag, Uhrzeit, Frist bis zum Vorabend 20 Uhr. Jeder Vorschlag lässt sich abwählen. Der Schritt steht in der Adresse (`?crew=<id>&step=poll`), Neuladen bleibt im Schritt; „Später“ führt nach Home. Etappe 2: Unter „Eigene Vorschläge“ lassen sich im selben Schritt freie Vorschläge eintippen („Grillen bei Bob“, 2–80 Zeichen, keine Dubletten) und weitere Orte über die Ortssuche (derselbe Dialog wie beim Erstellen einer Abstimmung) hinzufügen – zusammen höchstens 10. Steht im Profil keine Stadt, nimmt Schritt 3 die zuletzt in Discover gewählte (nur im Browser gespeichert, `afterhours.discover.city`) und sagt das dazu; ins Profil geschrieben wird sie nicht. Eigene Vorschläge gehen beim Neuladen verloren. Geschrieben wird nur über die bestehenden RPCs (`create_crew`, `create_crew_invitation`, `create_poll`) |
| Crews | Anlegen, umbenennen, löschen, verlassen; Rollen Owner/Admin/Mitglied; Mitglieder entfernen; Crew übergeben; automatische Nachfolge, wenn der Owner geht |
| Einladungen | Links mit Ablaufzeit und Nutzungslimit, widerrufbar; gespeichert wird nur der Hash des Tokens; Beitritt mit Vorschau und ausdrücklicher Zustimmung. Wer den Link ohne Konto öffnet, landet auf der Einladungs-Landingpage `/invite/<token>` (W1): Einladung als Ticket mit Crew, Vornamen der Mitglieder und dem nächsten Abend (nur Titel und Beginn), darunter direkt die Registrierung; nach der Bestätigung tritt man im verkürzten Onboarding mit einem ausdrücklichen Tipp bei (der Knopf nennt die Crew). Scheitert der Beitritt (Link inzwischen abgelaufen, Crew voll, Netz), führt die App auf die Beitrittsseite, die den Grund zeigt |
| Crew-Chat | Nachrichten schreiben und löschen |
| Echte Orte | Jede Stadt in Deutschland: Beim ersten Aufruf importiert die Edge Function `places` die Orte aus OpenStreetMap (Restaurants, Cafés, Bars, Kinos, Bowling, Minigolf, Bäder, Escape Rooms, Lasertag, Kart, Klettern, Theater, Museen, Zoos …), danach liegen sie 30 Tage in der Datenbank. Quelle und Stand stehen bei jedem Ort, Öffnungszeiten werden übersetzt oder im Original gezeigt |
| Discover | Freie Stadtwahl, Kategorien, Suche (serverseitig über alle Orte der Stadt), Filter (Preis, Entfernung ab Stadtmitte, Gruppengröße, Dauer, drinnen/draußen, Alter, jetzt geöffnet), Detailseite mit Öffnungszeiten, Karte (erst nach Klick), Meldefunktion |
| Abstimmungen | 1–10 Optionen aus Orten oder eigenen Vorschlägen, Termin je Option, Budget, Treffpunkt, Mindestteilnehmer, Frist; Antworten „Bin dabei / Vielleicht / Bin nicht dabei“, änderbar bis zum Ende; Zwischenstand, Beteiligung, Erinnerung; „Abstimmung teilen“ (W8) mit eigenem Teilen-Link `/v/<token>` (W2 Etappe 2, siehe Teilen-Karten); Ergebnis, Gleichstand, Stichwahl; automatisches Ende nach Fristablauf |
| Pläne | Zusage direkt auf Home (D6): Unter jedem Ticket in „Deine Antwort fehlt“ stehen „Bin dabei / Vielleicht / Kann nicht“ – gleiche RPC `set_attendance` wie auf der Planseite, danach wandert der Plan mit der Farbe der Antwort weiter. Aus einer Abstimmung oder direkt; Status Vorschlag → Bestätigt → Reservierung ausstehend → Gebucht → Abgeschlossen bzw. Abgesagt; Zu- und Absagen; Kosten pro Person und gesamt; Bearbeiten mit Benachrichtigung bei wesentlichen Änderungen; „Plan teilen“ (W8): Teilen-Menü des Geräts (Web Share API), sonst Text und Link in die Zwischenablage – geteilt werden nur Titel, Zeitpunkt und Link, keine Namen, Adressen oder Treffpunkte. „In den Kalender“ (P2 Etappe 1) unter „Wann?“ bei anstehenden Plänen: lädt eine iCalendar-Datei (`src/lib/ics.ts`, RFC 5545), die im Browser entsteht – Titel, Beginn, Ende nur wenn bekannt (sonst kein erfundenes), Adresse, Treffpunkt, Link zum Plan, Status (Vorschlag = vorläufig); keine Namen, Teilnehmer oder E-Mail-Adressen. Feste UID je Plan, damit ein erneuter Import den Termin ersetzt. Der Link ist ein eigener Teilen-Link `/s/<token>` (W2, siehe unten) |
| Reservierung | Dokumentierter Ablauf: Entwurf → ausdrückliche Freigabe → Ergebnis eintragen. Die App reserviert nicht selbst (siehe unten) |
| Fahrgemeinschaften | Fahrt anbieten, Mitfahrt anfragen, Zusage durch die fahrende Person, Platzkontrolle |
| Rewards | Punkte-Ledger: 30 Punkte fürs Organisieren, 10 fürs Dabeisein, vergeben beim Abschließen eines Plans – serverseitig, einmalig, mit Tageslimit |
| Benachrichtigungen | In-App für alle im Konzept genannten Ereignisse, pro Gruppe abschaltbar, gelesen/ungelesen, löschen |
| Admin | Geschützter Bereich: Kennzahlen, Aktivitäten ein-/ausblenden und als geprüft markieren, Meldungen bearbeiten, Audit-Log |
| Teilen-Karten (W2 Etappe 1) | Geteilte Pläne bekommen einen eigenen Link `/s/<token>` (ein Link je Plan, angelegt beim ersten Öffnen der Planseite durch ein Mitglied). Messenger (WhatsApp, Signal, Telegram …) zeigen dazu eine Vorschau: Titel des Plans, „Freitag, 17. Oktober · 20:00 Uhr · 3 sind dabei. Bist du dabei?“ und ein Vorschaubild im Ticket-Stil (`public/og/plan.png`, für alle Pläne gleich; Quelle `docs/design/og-plan.html`). Die Tags setzt die Vercel-Funktion `api/share.js` in die normale App-Hülle. In der App: Mitglieder der Crew springen direkt zum Plan; Freunde ohne Konto sehen die Karte (Titel, Zeit, Zahl der Zusagen) mit „Konto erstellen“ und kommen nach der Registrierung auf die Karte zurück; Angemeldete außerhalb der Crew sehen die Karte mit dem Hinweis, nach dem Einladungslink zu fragen. Drei Tage nach dem Plan zeigt der Link nichts mehr. **Abstimmungen (Etappe 2):** eigener Link `/v/<token>` je Abstimmung (angelegt beim ersten Öffnen der laufenden Abstimmung durch ein Mitglied, Tabelle `poll_share_links`). Vorschau im Messenger: die Frage, „3 Vorschläge · 2 haben abgestimmt · Abstimmen bis Samstag, 18. Oktober · 20:00 Uhr. Stimmst du mit ab?“ (nach dem Ende „Entschieden – 3 haben abgestimmt.“) und ein eigenes Vorschaubild (`public/og/poll.png`, für alle Abstimmungen gleich, Quelle `docs/design/og-poll.html`, Beispiel-Karte mit „Vorschlag 1–3“ als „Beispiel“ markiert). In der App sehen Freunde ohne Konto die Abstimmung als Karte (Frist im Abriss, Frage als Plakat, Zahl der Vorschläge und der Personen, die abgestimmt haben) mit „Konto erstellen“, Mitglieder springen zur Abstimmung, Außenstehende sehen die Karte mit dem Hinweis auf den Einladungslink. Was zur Wahl steht, steht bewusst weder in der Vorschau noch auf der Karte (eigene Vorschläge wie „Grillen bei Bob“ enthalten Namen). Drei Tage nach dem Ende zeigt der Link nichts mehr. Mitstimmen ohne Konto siehe W3; ein Vorschaubild je Plan (Titel im Bild) in Etappe 3 |
| Mitstimmen ohne Konto (W3 Etappe 1) | Wer eine Abstimmung gestartet hat (oder Owner/Admin der Crew ist), schaltet in der Seitenleiste der Abstimmung unter „Gäste“ „Gäste dürfen mitstimmen“ ein (Standard: aus; nur solange die Abstimmung läuft). Dann zeigt der Teilen-Link `/v/<token>` Freunden ohne Konto (und Angemeldeten außerhalb der Crew) statt der Karte einen Stimmzettel: Frage, Frist, alle Vorschläge mit Termin und Stand („3 dabei · 1 vielleicht“, ohne Namen), je Vorschlag „Bin dabei / Vielleicht / Bin nicht dabei“, dazu „Dein Name“ (2–40 Zeichen). Danach „Deine Stimme ist drin, Dana“ – änderbar bis zum Ende – und der Weg zum eigenen Konto. Das Gerät merkt sich je Link ein zufälliges Geheimnis (64 Hex-Zeichen, `localStorage` `afterhours.guest.<token>`); die Datenbank speichert nur dessen SHA-256-Hash. Gast-Stimmen zählen beim Ergebnis und bei der Stichwahl wie die der Crew. Die Crew sieht Gäste in Balken und „Wer hat wie geantwortet?“ als „Dana (Gast)“, dazu „+ 1 Gast hat mitgestimmt“; wer verwaltet, sieht die Gästeliste und kann Gäste entfernen (Name und Antworten werden gelöscht). Die Erstellerin bekommt beim ersten Abstimmen eines Gasts eine Benachrichtigung „Dana (Gast) hat abgestimmt“. Die Messenger-Vorschau endet dann mit „Stimmst du mit ab? Geht auch ohne Konto.“ Ausschalten verhindert neue Gast-Stimmen; bisherige bleiben. **Gast-Stimmen übernehmen (Etappe 2):** Wer als Gast abgestimmt hat und danach der Crew beitritt (Konto anlegen, Einladungslink), findet auf derselben Abstimmung – auf dem Gerät, mit dem er abgestimmt hat – die Karte „Du hast hier schon als Gast abgestimmt“ („Als „Erik“ hast du 2 Antworten gegeben …“). „Stimmen übernehmen“ macht die Gast-Antworten zu eigenen Antworten des Mitglieds; wo es schon selbst geantwortet hat, bleibt seine Antwort (die Karte sagt das vorher). „Gast-Stimme löschen“ (mit Rückfrage) verwirft sie. Danach ist der Gast gelöscht, und das Geheimnis wird vom Gerät entfernt – keine Person zählt doppelt. Nur solange die Abstimmung läuft und nur mit ausdrücklichem Tipp; die App übernimmt nie von selbst. Der Stimmzettel sagt Gästen nach dem Abstimmen, dass sie ihre Stimme beim Beitritt mitnehmen können |
| Installierbare App (W4) | Manifest, Icons und ein eigener Service Worker (`public/sw.js`, ohne Bibliothek, nur im Produktionsbuild). Hinweis „Hol dir AFTERHOURS auf den Homescreen“ auf Home – erst wenn du in einer Crew bist, nur wenn der Browser die Installation anbietet (Chromium: `beforeinstallprompt`) bzw. auf iPhone/iPad in Safari mit der Anleitung „Teilen → Zum Home-Bildschirm“; „Nicht jetzt“ hält ihn 30 Tage fern. Offline öffnet sich die App aus dem Cache. Was du zuletzt gesehen hast – Pläne, Crews, Namen der Mitglieder, Orte deiner Pläne, Abstimmungen – liegt zusätzlich auf dem Gerät (`src/lib/offline.ts`, Etappe 2) und ist ohne Netz lesbar; oben steht dann „Offline – gespeicherter Stand von 23:41 Uhr.“, ohne gespeicherten Stand „Offline – Inhalte laden, sobald du wieder Netz hast.“ Gelesen wird der Gerätespeicher nur ohne Netz, online lädt die App wie gewohnt. Neue Version: Kommt die App in den Vordergrund (und alle 30 Minuten), vergleicht sie ihr Start-Skript mit dem der aktuellen `index.html`; weicht es ab, erscheint oben „Neue Version ist da. [Neu laden]“. Ungelesene Benachrichtigungen als Zahl am App-Icon (Badging-API, wo vorhanden) |
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
| Google-/Apple-Anmeldung | Nicht vorhanden |
| Kalender-Abo | Nur Einzeldatei je Plan (P2 Etappe 1). Ein Abo-Link, der Änderungen von selbst in den Kalender bringt, fehlt noch (P2 Etappe 2) |

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

Das Frontend ist eine statische Single-Page-App. `npm run build` erzeugt `dist/`. Einzige Ausnahme: die Vercel-Funktion `api/share.js` für die Messenger-Vorschau geteilter Pläne (W2).

**Vercel** – Repository importieren; Framework „Vite“ wird erkannt. Umgebungsvariablen aus [Abschnitt 5](#5-umgebungsvariablen) setzen. `vercel.json` liefert SPA-Rewrite und Sicherheits-Header und leitet `/s/<token>` (Plan) und `/v/<token>` (Abstimmung) an die Funktion `api/share.js` (Node-Laufzeit, keine eigene Abhängigkeit). Sie lädt `index.html` der eigenen Domain, fragt `preview_shared_plan` bzw. `preview_shared_poll` mit dem öffentlichen anon-Key ab und setzt Titel, Beschreibung und Open-Graph-Tags in den `<head>`; die Antwort wird 5 Minuten im CDN zwischengespeichert. Sie liest `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` und `VITE_SITE_URL` zur Laufzeit – dieselben Variablen wie der Build, also nichts zusätzlich anzulegen.

**Netlify / Cloudflare Pages** – Build-Befehl `npm run build`, Ausgabeordner `dist`. `public/_redirects` und `public/_headers` werden mit ausgeliefert. Geteilte Links funktionieren dort, nur die Messenger-Vorschau ist dann allgemein (die Funktion `api/share.js` müsste als Netlify-/Cloudflare-Function nachgebaut werden).

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
| `VITE_SITE_URL` | nein | Öffentliche Adresse der App für Einladungs-, Teilen- und E-Mail-Links sowie die Vorschaubilder (geteilte Pläne zur Laufzeit, Startseite beim Build – ohne Adresse bleibt `og:image` relativ, was viele Messenger nicht anzeigen). Leer = aktuelle Browser-Adresse |
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
npm run test:db        # 539 pgTAP-Prüfungen der Datenbank (supabase test db)
npm run test:unit      # Messenger-Vorschau (api/share.js), ohne Netz
deno test supabase/functions/places/osm_test.ts   # OSM-Umwandlung und Öffnungszeiten
npm run test:e2e       # komplette Nutzerjourney im Browser (Playwright)
npm run build && npm run size   # Build-Größe gegen scripts/bundle-budget.json
```

**Build-Größe (`scripts/bundle-size.mjs`)** – misst nach dem Build die gzip-Größe dessen, was beim ersten Öffnen geladen wird (Skripte, Modul-Preloads und CSS aus `dist/index.html`), den größten Seiten-Chunk und alle Skripte zusammen. Grenzen in `scripts/bundle-budget.json` (Stand 14. Oktober 2026: Start 205 kB JavaScript + 12 kB CSS, größte Seite 22 kB; Grenzen 225 kB, 13 kB, 30 kB). Jede Seite ist ein eigener Chunk; React/Router, Supabase und TanStack Query liegen in eigenen Bibliotheks-Chunks, die nach einem Update im Browser-Cache bleiben. In der CI läuft die Prüfung im Job „TypeScript und Build“; die Tabelle steht in der Zusammenfassung des Laufs und als Annotation. Wer eine Grenze bewusst anhebt, begründet das im PR.

**Datenbank (`supabase/tests/database/`)** – prüft Berechtigungen aus Sicht echter API-Rollen: RLS auf jeder Tabelle, keine Rechte für `anon`, Rollenregeln in Crews, Einladungslinks (Ablauf, Limit, Widerruf), öffentliche Einladungsvorschau ohne Konto (nur freigegebene Felder, Rate Limit pro Link, ungültige Links verraten nichts), eine Stimme pro Person und Option, Ergebnislogik, Fristablauf, Statusübergänge von Plänen und Reservierungen, Punktevergabe ohne Doppelbuchung, Datenexport, Kontolöschung, Import echter Orte (Sperre, Kontingent, Aktualisierung, Deaktivierung verschwundener Orte, Suche), Mitstimmen ohne Konto (Freigabe nur durch Berechtigte, Stimmzettel ohne IDs und Namen, Eingabeprüfung, Ergebnis mit Gast-Stimmen, Entfernen, Obergrenzen und Rate Limits), Gast-Stimmen übernehmen (nur Mitglieder mit dem eigenen Geheimnis, eigene Antwort hat Vorrang, keine doppelte Stimme, nach dem Ende gesperrt, Rate Limit).

**OSM-Umwandlung (`supabase/functions/places/osm_test.ts`)** – Kategorien, Adressen, Links (nur https), Dubletten und der Öffnungszeiten-Parser: übersetzt werden nur sichere Fälle, alles andere bleibt Originaltext.

**Messenger-Vorschau (`tests/unit/share-card.test.mjs`)** – `node --test`, ohne Netz: Datum in Berliner Zeit, Texte je Planstatus und je Stand einer Abstimmung, Wahl der Datenbankfunktion und des Vorschaubilds nach `/s/` bzw. `/v/`, HTML-Escaping (ein Plantitel kann kein Markup einschleusen), Einbau in `index.html`, Verhalten bei ungültigem Token, Datenbankfehler, Rate Limit und fehlender App-Hülle. Läuft in der CI im Job „TypeScript und Build“. Die Journey ruft dieselbe Funktion zusätzlich gegen die lokale Datenbank auf und prüft die Seiten `/s/<token>` und `/v/<token>` als Gast, Mitglied und Außenstehende.

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
Browser (React-SPA)          Messenger (WhatsApp & Co.) ──► /s/<token>, /v/<token> ──► Vercel-Funktion api/share.js
   │  nur anon-Key + Sitzung der angemeldeten Person                       (anon-Key, nur preview_shared_plan/_poll)
   ▼
Supabase API ──► Auth        Registrierung, Sitzungen, E-Mails
             ──► PostgREST   Lesen über RLS-Policies
                             Schreiben über geprüfte RPC-Funktionen
             ──► Realtime    Änderungen an Stimmen, Plänen, Nachrichten
             ──► Edge Function „places“    OSM-Import pro Stadt (Nominatim + Overpass)
             ──► Edge Function „assistant“ (optional, hält den KI-Schlüssel)
```

**Warum eine SPA statt Next.js?** Die App liegt bis auf Startseite, Einladungs- und Datenschutzseite hinter der Anmeldung und braucht kaum Suchmaschinen-Seiten. Mit Supabase als Backend sitzt jede Berechtigungsprüfung in der Datenbank; ein zusätzlicher Server wäre eine zweite Stelle, an der Regeln auseinanderlaufen können. Eine SPA lässt sich zudem statisch hosten und später als native App verpacken.

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

26 Tabellen im Schema `public`. Geldbeträge sind Cent-Werte, Zeitpunkte `timestamptz`.

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
| `plan_share_links` | Teilen-Link je Plan (W2): Token, wer ihn angelegt hat. Ohne API-Rechte; Zugriff nur über `plan_share_token` und `preview_shared_plan` |
| `poll_share_links` | Teilen-Link je Abstimmung (W2 Etappe 2), aufgebaut wie `plan_share_links`. Zugriff nur über `poll_share_token` und `preview_shared_poll` |
| `poll_guests`, `poll_guest_votes` | Gäste ohne Konto (W3): Name und Hash ihres Geheimnisses je Abstimmung, ihre Antworten (eine je Gast und Option). Die Crew liest Name und Antworten (nicht den Hash); geschrieben wird nur über `guest_vote_shared_poll`, `remove_poll_guest`. Freigabe: Spalte `polls.guests_allowed` |
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
| Serverseitige Berechtigungen | RLS auf allen 26 Tabellen (32 Policies); `anon` hat keine Tabellenrechte und darf genau fünf Funktionen ausführen: `preview_public_invitation` (W1), `preview_shared_plan` und `preview_shared_poll` (W2), `shared_poll_ballot` und `guest_vote_shared_poll` (W3), siehe unten; Schreiben über 44 RPC-Funktionen für angemeldete Nutzer mit festem `search_path`; vier weitere nur für die Edge Function `places` |
| Importierte Orte | Nutzer können einen Import nur anstoßen, nicht selbst Orte schreiben. Kontingent: 10 Importe pro Person und Stunde, 60 insgesamt; Sperre gegen parallele Importe; Links nur https, Quell-Links nur auf openstreetmap.org |
| Crew-Grenzen | Jede Policy und jede Funktion prüft die Mitgliedschaft in der Datenbank |
| Eingaben | Bereinigung und Grenzen in den Funktionen, zusätzlich Check-Constraints auf den Tabellen |
| Einladungslinks | 244 Bit Zufall, nur SHA-256-Hash gespeichert, Ablauf (max. 30 Tage), Nutzungslimit (max. 50), widerrufbar, Rate Limit auf Abfragen |
| Einladung ohne Konto (W1) | `preview_public_invitation` liefert bei gültigem Link nur Crew-Name, Emoji, Zahl der Mitglieder, Vornamen (erstes Wort des Anzeigenamens, höchstens sechs, keine Bilder), Vorname der einladenden Person und vom nächsten Plan Titel und Beginn – keine IDs, Adressen, Treffpunkte, Notizen, Kosten oder E-Mails. Ungültige, widerrufene und abgelaufene Links liefern nur ihren Status. Rate Limit 60 Abrufe je Link in 10 Minuten (`app_private.rate_limit_key`); ungültige Tokens schreiben nichts. Wer den Link hat, sieht diese Angaben – so wie bei Gruppenlinks in Messengern |
| Geteilte Pläne (W2) | `plan_share_token` gibt nur Crew-Mitgliedern den Link (30 neue Links pro Person und Stunde). `preview_shared_plan` liefert bei gültigem Link nur Titel, Beginn, Ende, Status und die Zahl der Zusagen – keine IDs, Namen, Adressen, Treffpunkte, Notizen, Kosten, keinen Crew-Namen; die Plan-ID nur angemeldeten Mitgliedern (für die Weiterleitung). Unbekannte Links liefern `not_found`, Links zu Plänen, die mehr als drei Tage vorbei sind, nur `expired`. Rate Limit 120 Abrufe je Link in 10 Minuten. Der Token (122 Bit Zufall) liegt im Klartext, damit derselbe Link mehrfach geteilt werden kann – in einer Tabelle ohne jede API-Berechtigung; er öffnet keine Crew und keinen Plan. Die Plan-ID taugt nicht als öffentlicher Schlüssel, weil sie in allen App-Adressen steht. Abstimmungen (Etappe 2) genauso: `poll_share_token` nur für Mitglieder (30 neue Links pro Person und Stunde), `preview_shared_poll` liefert nur Frage, Frist, offen/entschieden, Zahl der Vorschläge und Zahl der Personen, die abgestimmt haben – keine Vorschläge im Wortlaut, keine IDs, Namen, Treffpunkte, Budgets, Beschreibungen, keinen Crew-Namen; die ID nur angemeldeten Mitgliedern. Rate Limit 120 Abrufe je Link in 10 Minuten, drei Tage nach dem Ende nur `expired`. Plan- und Abstimmungs-Tokens liegen in getrennten Tabellen und öffnen nur ihre eigene Art |
| Mitstimmen ohne Konto (W3) | Nur nach ausdrücklicher Freigabe je Abstimmung durch Ersteller:in oder Owner/Admin (`set_poll_guests`, Audit-Eintrag). Erst dann zeigt `shared_poll_ballot` die Vorschläge im Wortlaut – mit Termin und der Zahl der Antworten je Vorschlag, ohne IDs (Schlüssel ist die Position), Namen, Treffpunkt, Budget, Beschreibung und Crew-Namen; ohne Freigabe nur `guests_off`. `guest_vote_shared_poll` prüft Link, Freigabe, Frist, Geheimnis (64 Hex-Zeichen), Name (2–40 Zeichen), jede Antwort und jeden Vorschlag, bevor es schreibt; Mitglieder der Crew werden abgewiesen (`already_member`). Grenzen: 30 Gäste je Abstimmung, 30 neue Gäste je Link und Stunde, 300 Stimmabgaben je Link in 10 Minuten, 240 Abrufe des Stimmzettels je Link in 10 Minuten. Wer den Link hat und Gäste erlaubt sind, kann unter beliebigem Namen abstimmen – deshalb steht bei jedem Gast „(Gast)“, und wer verwaltet, kann Gäste entfernen. Gäste haben kein Konto; Name und Antworten verschwinden mit der Abstimmung. Übernahme (Etappe 2): `poll_guest_claim_preview` und `claim_poll_guest` nur für angemeldete Mitglieder der Crew, nur bei laufender Abstimmung; Nachweis ist das Geheimnis vom Gerät des Gasts (wer es nicht hat, findet keinen Gast – auch nicht aus der Crew). Übernommen wird mit `on conflict do nothing` (eigene Antwort hat Vorrang), der Gast wird in derselben Transaktion gelöscht; Audit-Eintrag `poll_guest_claimed` bzw. `poll_guest_discarded`; Rate Limit 20 je Person und Stunde, Abfrage 120 je Person in 10 Minuten |
| Punkte | Nur per Trigger beim Abschließen; nicht direkt schreibbar; Unique-Index, Tageslimit, Audit-Eintrag |
| Rate Limits | Pro Person und Aktion in der Datenbank, für die Einladungsvorschau ohne Konto pro Link (Crews, Einladungen, Abstimmungen, Stimmen, Nachrichten, Pläne, Meldungen, Assistent, Ortsimport) |
| Secrets | Im Frontend nur der öffentliche anon-Key; KI-Schlüssel nur als Secret der Edge Function |
| Protokoll | `audit_log` für Rollenwechsel, Entfernen, Einladungen, Abstimmungsende, Planstatus, Reservierung, Punkte, Kontolöschung |
| Fehlermeldungen | Die Oberfläche zeigt übersetzte, allgemeine Meldungen; technische Details nur in der Konsole |
| Browser | Content-Security-Policy ohne Inline-Skripte, kein Nachladen von Schriften oder Trackern, Karte erst nach Klick |
| Standort | Opt-in, Standard „aus“; in dieser Version wird kein Standort erhoben |
| Offline-Cache (W4) | Der Service Worker bedient nur Anfragen an die eigene Adresse und cacht nur App-Dateien; Supabase-Anfragen (Nutzerdaten, Sitzung) laufen nie durch ihn |
| Offline lesbare Pläne (W4 Etappe 2) | Im `localStorage` des Geräts (Schlüssel `afterhours.offline`) liegt der zuletzt geladene Stand von Plänen, Crews (mit Mitgliedern), Namen und Profilbildern der Crew-Mitglieder, Orten der Pläne, Abstimmungen (mit Namen und Antworten von Gästen, W3) und dem eigenen Profil – höchstens 7 Tage alt, höchstens ~1,5 MB, gebunden an die Konto-ID. Nicht gespeichert: Einladungslinks, Chat, Benachrichtigungen, Einstellungen, Reservierungen, Fahrgemeinschaften, Admin. Abmelden und Konto löschen entfernen den Eintrag sofort; ein Stand einer anderen Person wird beim Anmelden verworfen, nie angezeigt. Nichts davon verlässt das Gerät. Wer das Gerät entsperrt nutzt, kann den Stand lesen – wie bei jeder App mit Offline-Daten |
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
| Datenbanklogik und Berechtigungen | 539 pgTAP-Prüfungen, als `postgres` und auf einer Datenbank mit Bestandsdaten |
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
| Öffentliche Startseite (W6) | Die Journey prüft sie auf Smartphone, Tablet und Desktop (Inhalt, „Beispiel“-Kennzeichnung, keine Zahlen-/Bewertungsbehauptungen, Wege zu Registrierung und Anmeldung, Weiterleitung Angemeldeter, axe-core). Ohne Hosting gibt es keine öffentliche Adresse. Die Vorschau-Tags stehen im HTML und sind per Unit-Test und Journey geprüft (absolute Bildadresse im Build, Bild wird ausgeliefert); wie WhatsApp, Signal, Telegram und Google sie tatsächlich darstellen, ist ungeprüft. Den Seiteninhalt sehen Suchmaschinen weiter nur, wenn sie JavaScript ausführen (kein Server-Rendering); Titel und Beschreibung stehen aber im HTML. Ein Impressum fehlt (rechtlich, siehe Abschnitt 12) |
| Kalenderdatei (.ics) | Die Journey prüft Aufbau, Maskierung, Zeilenlänge und Inhalt der Datei. Der Import in Apple-, Google- und Outlook-Kalender ist nicht auf echten Geräten geprüft; ein Plan ohne Ende erscheint dort je nach Kalender als Termin ohne Dauer |
| Offline lesbare Pläne, Update-Hinweis | Die Journey prüft Speichern, Lesen ohne Netz, Löschen beim Abmelden und den Update-Hinweis (alter Build nachgestellt) in Chromium. Echte Funklöcher („Netz da, aber nichts kommt an“) zeigen weiter Ladezustände, bis die Anfrage scheitert – der Gerätespeicher springt nur ein, wenn der Browser „offline“ meldet |
| Installation und Offline auf echten Geräten | Die Journey stellt das Installations-Angebot und die Badging-API nach (Headless-Chromium hat beides nicht) und prüft Service Worker, Cache-Inhalt und Offline-Start in Chromium. Installation unter Android/iOS und der Zähler am Icon sind nicht auf Geräten geprüft |
| Messenger-Vorschau auf Vercel | Pläne (`/s/`) und Abstimmungen (`/v/`): `api/share.js` ist mit Unit-Tests und in der Journey gegen die lokale Datenbank geprüft, aber nicht auf Vercel selbst gelaufen (kein Deployment). Wie WhatsApp, Signal und Telegram die Vorschau tatsächlich darstellen, ist ungeprüft |
| Mitstimmen ohne Konto (W3) | pgTAP (84 Prüfungen, Etappe 2: 33 weitere) und Journey (Gast auf dem Smartphone, Wiedererkennen nach Neuladen, Anzeige bei der Crew, Benachrichtigung, Entfernen, API-Proben; Etappe 2: Gast stimmt ab, registriert sich über den Einladungslink, tritt bei und übernimmt seine Stimmen) in Chromium. Wer die Abstimmung auf einem anderen Gerät als dem Gast-Gerät öffnet, sieht keine Übernahme (das Geheimnis liegt nur dort) – seine Gast-Stimme zählt dann weiter zusätzlich, bis jemand den Gast entfernt. Ob Gäste die Funktion für Spaß-Stimmen missbrauchen, zeigt erst der echte Betrieb; ein Gast, der den Browser-Speicher löscht, kann ein zweites Mal abstimmen (bis 30 Gäste) |
| Barrierefreiheit jenseits von axe-core | Automatisch geprüft sind WCAG-Regeln, die axe erkennt, und die Tastatur-Anmeldung. Screenreader (VoiceOver, TalkBack) und Tastaturwege durch die übrigen Abläufe nicht |

---

## 12. Vor dem Produktivstart

- Datenschutzerklärung, Impressum und Nutzungsbedingungen rechtlich erstellen lassen; `/privacy` ersetzen oder ergänzen. Die öffentliche Startseite (W6) verlinkt bisher nur `/privacy`; ein Impressum-Link gehört in ihren Fuß, sobald die Angaben feststehen.
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

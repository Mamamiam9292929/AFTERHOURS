# AFTERHOURS – Roadmap

Arbeitsweise: Claude entscheidet selbst (seit 12.10.2026 von Benito vollständig übertragen). Ideen dürfen direkt umgesetzt werden; jede Aufgabe kommt als eigener Pull Request mit Tests und Screenshots und wird gemergt, sobald die CI grün ist. Reihenfolge innerhalb eines Abschnitts = Priorität.

Status: `Vorschlag` → `Freigegeben` → `In Arbeit` → `PR offen` → `Erledigt` (oder `Abgelehnt`).
Aufwand: S = eine Nacht, M = zwei bis drei Nächte, L = mehrere Etappen.

## Fundament

| # | Aufgabe | Nutzen | Aufwand | Abhängigkeiten | Status |
|---|---|---|---|---|---|
| F1 | Browser-Journey (`tests/e2e/journey.mjs`) in GitHub Actions lauffähig machen, inkl. Stellvertreter für OpenStreetMap | Jeder PR wird automatisch durchgeklickt, bevor du ihn siehst | M | – | Erledigt (#6) |
| F2 | Barrierefreiheit automatisch prüfen (axe-core in der Journey) | Fehler bei Kontrast, Beschriftung, Tastatur fallen sofort auf | S | F1 | Erledigt (#8) |
| F3 | Produktionsbuild-Größe überwachen, Seiten aufteilen wo nötig | Schneller Start auf dem Handy | S | – | Erledigt (#7) |
| F4 | Screenshots der Journey auf eigenem Branch (`screenshots/main`, `screenshots/pr-<n>`), im PR verlinkbar. Akzeptanz: nach jedem Lauf liegen alle Bilder auf dem Branch; Vorher/Nachher ohne Artefakt-Download | Jede Design-Änderung lässt sich im PR mit echten Bildern vergleichen | S | F1 | Erledigt (#10) |

## Wachstum – warum Leute die App laden und weiterempfehlen

| # | Idee | Nutzen | Aufwand | Abhängigkeiten | Status |
|---|---|---|---|---|---|
| W1 | Einladungs-Landingpage: Wer einen Crew-Link öffnet und noch kein Konto hat, sieht Crew, Mitglieder und den nächsten Plan – Registrierung in einem Schritt | Jede Einladung ist der wichtigste Weg zu neuen Nutzern | M | – | Etappe 1 erledigt (#23): Landingpage `/invite/<token>` mit Einladungs-Ticket (Crew, Vornamen, nächster Abend) und Registrierung direkt darunter. Etappe 2 erledigt (#25): Onboarding für Eingeladene auf einen Schritt gekürzt, Beitritt mit demselben Tipp. Damit ist W1 abgeschlossen; Link-Vorschau in Messengern siehe W2 |
| W2 | Teilen-Karten: Abstimmung/Plan als schöne Vorschau in WhatsApp & Co. (Open-Graph-Bild pro Plan, Text ohne private Daten) | Gruppenchats sind der Ort, an dem geplant wird – dort muss AFTERHOURS auffallen | M | Server-Rendering des Vorschaubilds (Edge Function) | Etappe 1 erledigt (#27): eigener Teilen-Link `/s/<token>` je Plan, Messenger-Vorschau (Titel, Zeit, Zusagen, Vorschaubild im Ticket-Stil) über die Vercel-Funktion `api/share.js`, Karte für Freunde ohne Konto und Außenstehende, Mitglieder direkt zum Plan. Etappe 2 erledigt (#36): Abstimmungen teilen mit eigenem Link `/v/<token>` – Messenger-Vorschau (Frage, Zahl der Vorschläge und Stimmen, Frist, eigenes Vorschaubild `og/poll.png`), Karte für Freunde ohne Konto und Außenstehende, Mitglieder direkt zur Abstimmung; Vorschläge im Wortlaut bleiben in der Crew. Etappe 3 offen: Vorschaubild je Plan mit Titel im Bild (Bild-Rendering auf dem Server ohne zusätzliche Kosten) |
| W3 | Abstimmen ohne Konto per Link (Gastname, später Konto übernehmen) | Senkt die Hürde für die Freunde, die noch nicht dabei sind | L | Missbrauchsschutz, Rate Limits | Freigegeben |
| W4 | Installierbare App (PWA): Installations-Hinweis zum richtigen Zeitpunkt, Offline-Grundgerüst, App-Icon-Badges | „Runterladen" ohne App Store | S | – | Etappe 1 erledigt (#26): Hinweis auf Home (erst mit Crew, 30 Tage Ruhe nach „Nicht jetzt“, iOS-Anleitung), Service Worker mit Offline-Hülle, Offline-Streifen, Zähler am Icon. Etappe 2 erledigt (#28): zuletzt geladene Pläne, Crews und Abstimmungen offline lesbar (nur auf dem Gerät, höchstens 7 Tage, beim Abmelden gelöscht, „gespeicherter Stand von …“), Hinweis „Neue Version – Neu laden“. Damit ist W4 abgeschlossen |
| W5 | Erster Plan in 60 Sekunden: geführter Start nach der Registrierung (Crew → Freunde einladen → Abstimmung mit 3 Vorschlägen aus der eigenen Stadt) | Neue Nutzer erleben den Kernnutzen sofort | M | – | Etappe 1 erledigt (#29): `/start` mit drei Schritten, Ziel nach dem Onboarding ohne Einladung. Etappe 2 erledigt (#31): eigene Vorschläge und Ortssuche direkt im Schritt 3, Stadt ohne Profilangabe aus Discover. Damit ist W5 abgeschlossen |
| W6 | Öffentliche Startseite (afterhours…/) mit echtem Produkt statt Login-Wand: was die App kann, Screens, „Crew gründen" | Wer von Freunden hört, muss verstehen, was es ist | M | Online erst mit Domain/Hosting durch Benito | Etappe 1 erledigt (#33): Startseite unter `/` für Besucher ohne Konto (Plakat, drei Schritte, Funktionen, Datenschutz, Beispiel-Ticket und -Abstimmung als „Beispiel“ markiert, „Crew gründen“ → Registrierung), Angemeldete weiter zu Home. Etappe 2 erledigt (#35): Vorschau für Messenger und Suchmaschinen – Open-Graph-/Twitter-Tags in `index.html`, Vorschaubild `og/home.png` (Beispiel-Abstimmung als „Beispiel“ markiert), absolute Bildadresse beim Build mit `VITE_SITE_URL`, geteilte Pläne ersetzen die Tags vollständig. Offen (Für Benito): Impressum-Link, sobald die Angaben feststehen |
| W8 | „Plan teilen“: Knopf auf Plan und Abstimmung öffnet das Teilen-Menü des Handys (Web Share API, Rückfall: Text kopieren) mit Titel, Datum und Link – ohne Namen oder Adressen der Mitglieder. Akzeptanz: Journey prüft Text und Rückfall; keine Daten an Dritte | Ein Tipp, und der Plan steht im WhatsApp-Gruppenchat – der natürliche Weg zu neuen Nutzern | S | – | Erledigt (#24) |
| W7 | Store-Verpackung vorbereiten (Capacitor-Projekt, Icons, Screenshots, Store-Texte) | Präsenz im App Store / Play Store | L | Entwicklerkonten Apple (99 €/Jahr) und Google (25 €) – Für Benito | Freigegeben |

## Design

| # | Aufgabe | Nutzen | Aufwand | Abhängigkeiten | Status |
|---|---|---|---|---|---|
| D0 | Redesign nach `docs/design/DESIGN.md` (Konzept von Benito abgesegnet): Plakat-Überschriften, Ticket als Held auf Home, Abstimm-Balken, Discover mit Bühne, neue Tab-Leiste. In Etappen: Home → Abstimmung → Discover → Rest | Der Wow-Effekt beim ersten Öffnen | M | – | Etappe 1 Home (#11) und Etappe 2 Abstimmung (#13) erledigt; Etappe 3 Discover (#15) erledigt; Etappe 4 Tab-Leiste, Crews- und Plans-Übersicht (#16) erledigt; Etappe 5a Plan-Detail (#17) erledigt; Etappe 5b Crew-Detail (#18) erledigt; Etappe 5c Profil als Stammkarte (#19) erledigt – D0 ist abgeschlossen, Feinschliff läuft über D1–D7 |
| D1 | Bewegung mit Sinn: Ticket „reißt ab", wenn ein Plan bestätigt wird; Stimmbalken wachsen; reduzierte Bewegung respektiert | Die entscheidenden Momente fühlen sich gut an | S | – | Freigegeben |
| D2 | Discover visueller: größere Karten mit Kategorie-Farbwelten, Kartenansicht (P6), Fotos aus Commons (P7) | Stöbern macht Spaß statt Liste lesen | M | P6, P7 | Freigegeben |
| D3 | Home als „Heute Abend"-Bühne: nächster Plan als großes Ticket, Live-Countdown, offene Abstimmungen mit einem Tipp beantworten | Ein Blick genügt | M | – | Freigegeben |
| D4 | Leere Zustände und Onboarding mit eigener Illustration im Ticket-Stil | Erster Eindruck | S | – | Freigegeben |
| D6 | Zusage direkt auf Home: Fehlt deine Antwort zu einem Plan, zeigt das Ticket auf Home „Bin dabei / Vielleicht / Kann nicht“ mit einem Tipp (gleiche RPC wie auf der Planseite). Akzeptanz: Journey sagt auf Home zu; Fehler- und Ladezustand | Ein Blick, ein Tipp – weniger offene Antworten | S | – | Erledigt (#30) |
| D7 | Immersiver (Benitos Wunsch, 13.10.): weiche Seitenwechsel per View Transition (Kopf und Tab-Leiste bleiben stehen, Lime-Strich gleitet zum Tab, angetipptes Ticket gleitet zum großen Ticket der Planseite), Seiten im Leerlauf vorgeladen, Plan sofort aus der Liste. Ticket in der Farbe deiner Antwort: grün dabei, gelb vielleicht, rot abgesagt, mit Stempel im Abriss, der beim Antworten aufschlägt. Akzeptanz: Journey prüft Farbe/Stempel aller drei Antworten und den Ticket-Übergang; reduzierte Bewegung schaltet alles ab | Die App fühlt sich flüssig an; die eigene Antwort sieht man auf einen Blick | S | – | Erledigt |
| D5 | Design-Audit auf echten Geräten (Safari iOS, Android Chrome), Abstände, Typo-Skala, Kontraste | Feinschliff | S | – | Freigegeben |

## Produkt

| # | Idee | Nutzen für die Crew | Aufwand | Abhängigkeiten | Status |
|---|---|---|---|---|---|
| P1 | Termin-Abstimmung: mehrere Datumsoptionen unabhängig vom Ort („Wann könnt ihr?“) | Das häufigste Problem in Gruppen ist der Termin, nicht der Ort | M | – | Freigegeben |
| P2 | Kalender-Export (.ics) für bestätigte Pläne, Abo-Link pro Person | Plan landet im eigenen Kalender, mit Änderungen | S | – | Etappe 1 erledigt (#32): „In den Kalender“ je Plan (Datei entsteht im Browser). Etappe 2 (Idee): persönlicher Abo-Link (Edge Function, widerrufbares Token, nur eigene Pläne), damit Änderungen von selbst ankommen |
| P3 | Kosten aufteilen nach dem Abend: wer hat was ausgelegt, wer schuldet wem (nur Übersicht, keine Zahlung) | Löst den nervigsten Teil nach dem Treffen | M | – | Freigegeben |
| P4 | Web-Push-Benachrichtigungen (neue Abstimmung, Plan bestätigt, Erinnerung am Tag) | Niemand verpasst eine Abstimmung | M | VAPID-Schlüssel (kostenlos), iOS nur als installierte Web-App | Freigegeben |
| P5 | Wetter für Plantag und Ort (Open-Meteo, ohne Schlüssel), Hinweis bei Draußen-Aktivitäten | Biergarten oder Bowling? Entscheidung mit Fakten | S | – | Freigegeben |
| P6 | Karte in Discover (OSM-Kacheln, erst nach Klick geladen) | Orte in der Nähe auf einen Blick | M | Nutzungsregeln der Kachelserver; bei Last eigener Anbieter | Freigegeben |
| P7 | Fotos von OSM-Orten über Wikidata/Wikimedia Commons, mit Lizenzangabe pro Bild | Discover sieht lebendiger aus, ohne Bilder zu erfinden | M | Nur Bilder mit freier Lizenz und Namensnennung | Freigegeben |
| P8 | Wiederkehrende Pläne („jeden ersten Freitag“) | Stammtische laufen von selbst | M | – | Freigegeben |
| P9 | Crew-Rückblick: gemeinsame Abende, beliebteste Orte, Serien | Bindung und Spaß, ohne Daten nach außen | M | – | Freigegeben |
| P10 | Fotos zum Plan teilen (nur Crew sichtbar, Supabase Storage) | Erinnerungen an einem Ort | M | Speicherkosten, Moderation, Löschfristen | Freigegeben |
| P11 | Englische Oberfläche | Gemischte Freundeskreise, Expats | M | – | Freigegeben |
| P12 | Anmeldung mit Google und Apple | Weniger Hürden bei der Registrierung | S | Entwicklerkonten bei Google/Apple, Schlüssel als Secret | Freigegeben |
| P13 | Live-Standort nur während eines Plans (Opt-in, verfällt automatisch) | Treffpunkt finden, ohne Dauertracking | L | Datenschutz-Konzept, Einwilligung, Aufbewahrung | Freigegeben |

## Für Benito (braucht Konto, Geld oder eine Entscheidung)

- Hosting/Domain für den Livebetrieb (Vercel + Supabase-Projekt in der EU)
- Entwicklerkonten Apple/Google für die Store-Version (W7)
- W2: Die Messenger-Vorschau braucht Vercel als Hoster (Funktion `api/share.js`). Bei Netlify/Cloudflare funktionieren geteilte Links, die Vorschau bleibt allgemein
- Impressum, Datenschutzerklärung, Nutzungsbedingungen rechtlich prüfen lassen (die öffentliche Startseite W6 braucht einen Impressum-Link, sobald die Angaben feststehen)

## Offene Fragen an Benito

- Soll die App öffentlich (jede Person kann sich registrieren) oder zunächst nur auf Einladung starten?
- Ab wann eigener Overpass-/Nominatim-Dienst statt der öffentlichen OSM-Server?

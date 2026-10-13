# AFTERHOURS – Roadmap

Arbeitsweise: Claude entscheidet selbst (seit 12.10.2026 von Benito vollständig übertragen). Ideen dürfen direkt umgesetzt werden; jede Aufgabe kommt als eigener Pull Request mit Tests und Screenshots und wird gemergt, sobald die CI grün ist. Reihenfolge innerhalb eines Abschnitts = Priorität.

Status: `Vorschlag` → `Freigegeben` → `In Arbeit` → `PR offen` → `Erledigt` (oder `Abgelehnt`).
Aufwand: S = eine Nacht, M = zwei bis drei Nächte, L = mehrere Etappen.

## Fundament

| # | Aufgabe | Nutzen | Aufwand | Abhängigkeiten | Status |
|---|---|---|---|---|---|
| F1 | Browser-Journey (`tests/e2e/journey.mjs`) in GitHub Actions lauffähig machen, inkl. Stellvertreter für OpenStreetMap | Jeder PR wird automatisch durchgeklickt, bevor du ihn siehst | M | – | Erledigt (#6) |
| F2 | Barrierefreiheit automatisch prüfen (axe-core in der Journey) | Fehler bei Kontrast, Beschriftung, Tastatur fallen sofort auf | S | F1 | Freigegeben |
| F3 | Produktionsbuild-Größe überwachen, Seiten aufteilen wo nötig | Schneller Start auf dem Handy | S | – | Erledigt (#7) |
| F4 | Screenshots der Journey auf eigenem Branch (`screenshots/main`, `screenshots/pr-<n>`), im PR verlinkbar. Akzeptanz: nach jedem Lauf liegen alle Bilder auf dem Branch; Vorher/Nachher ohne Artefakt-Download | Jede Design-Änderung lässt sich im PR mit echten Bildern vergleichen | S | F1 | In Arbeit |

## Wachstum – warum Leute die App laden und weiterempfehlen

| # | Idee | Nutzen | Aufwand | Abhängigkeiten | Status |
|---|---|---|---|---|---|
| W1 | Einladungs-Landingpage: Wer einen Crew-Link öffnet und noch kein Konto hat, sieht Crew, Mitglieder und den nächsten Plan – Registrierung in einem Schritt | Jede Einladung ist der wichtigste Weg zu neuen Nutzern | M | – | Freigegeben |
| W2 | Teilen-Karten: Abstimmung/Plan als schöne Vorschau in WhatsApp & Co. (Open-Graph-Bild pro Plan, Text ohne private Daten) | Gruppenchats sind der Ort, an dem geplant wird – dort muss AFTERHOURS auffallen | M | Server-Rendering des Vorschaubilds (Edge Function) | Freigegeben |
| W3 | Abstimmen ohne Konto per Link (Gastname, später Konto übernehmen) | Senkt die Hürde für die Freunde, die noch nicht dabei sind | L | Missbrauchsschutz, Rate Limits | Freigegeben |
| W4 | Installierbare App (PWA): Installations-Hinweis zum richtigen Zeitpunkt, Offline-Grundgerüst, App-Icon-Badges | „Runterladen" ohne App Store | S | – | Freigegeben |
| W5 | Erster Plan in 60 Sekunden: geführter Start nach der Registrierung (Crew → Freunde einladen → Abstimmung mit 3 Vorschlägen aus der eigenen Stadt) | Neue Nutzer erleben den Kernnutzen sofort | M | – | Freigegeben |
| W6 | Öffentliche Startseite (afterhours…/) mit echtem Produkt statt Login-Wand: was die App kann, Screens, „Crew gründen" | Wer von Freunden hört, muss verstehen, was es ist | M | Domain/Hosting durch Benito | Freigegeben |
| W7 | Store-Verpackung vorbereiten (Capacitor-Projekt, Icons, Screenshots, Store-Texte) | Präsenz im App Store / Play Store | L | Entwicklerkonten Apple (99 €/Jahr) und Google (25 €) – Für Benito | Freigegeben |

## Design

| # | Aufgabe | Nutzen | Aufwand | Abhängigkeiten | Status |
|---|---|---|---|---|---|
| D0 | Redesign nach `docs/design/DESIGN.md` (Konzept von Benito abgesegnet): Plakat-Überschriften, Ticket als Held auf Home, Abstimm-Balken, Discover mit Bühne, neue Tab-Leiste. In Etappen: Home → Abstimmung → Discover → Rest | Der Wow-Effekt beim ersten Öffnen | M | – | Etappe 1 Home erledigt (#11); In Arbeit: Etappe 2 Abstimmung (PR offen) |
| D1 | Bewegung mit Sinn: Ticket „reißt ab", wenn ein Plan bestätigt wird; Stimmbalken wachsen; reduzierte Bewegung respektiert | Die entscheidenden Momente fühlen sich gut an | S | – | Freigegeben |
| D2 | Discover visueller: größere Karten mit Kategorie-Farbwelten, Kartenansicht (P6), Fotos aus Commons (P7) | Stöbern macht Spaß statt Liste lesen | M | P6, P7 | Freigegeben |
| D3 | Home als „Heute Abend"-Bühne: nächster Plan als großes Ticket, Live-Countdown, offene Abstimmungen mit einem Tipp beantworten | Ein Blick genügt | M | – | Freigegeben |
| D4 | Leere Zustände und Onboarding mit eigener Illustration im Ticket-Stil | Erster Eindruck | S | – | Freigegeben |
| D5 | Design-Audit auf echten Geräten (Safari iOS, Android Chrome), Abstände, Typo-Skala, Kontraste | Feinschliff | S | – | Freigegeben |

## Produkt

| # | Idee | Nutzen für die Crew | Aufwand | Abhängigkeiten | Status |
|---|---|---|---|---|---|
| P1 | Termin-Abstimmung: mehrere Datumsoptionen unabhängig vom Ort („Wann könnt ihr?“) | Das häufigste Problem in Gruppen ist der Termin, nicht der Ort | M | – | Freigegeben |
| P2 | Kalender-Export (.ics) für bestätigte Pläne, Abo-Link pro Person | Plan landet im eigenen Kalender, mit Änderungen | S | – | Freigegeben |
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
- Impressum, Datenschutzerklärung, Nutzungsbedingungen rechtlich prüfen lassen

## Offene Fragen an Benito

- Soll die App öffentlich (jede Person kann sich registrieren) oder zunächst nur auf Einladung starten?
- Ab wann eigener Overpass-/Nominatim-Dienst statt der öffentlichen OSM-Server?

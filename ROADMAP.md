# AFTERHOURS – Roadmap

Arbeitsweise: Claude schlägt Ideen vor (Status **Vorschlag**). Gebaut wird nur, was auf **Freigegeben** steht – in der Reihenfolge der Tabelle. Jede Aufgabe kommt als eigener Pull Request mit Tests und Screenshots; gemergt wird von Benito.

Status: `Vorschlag` → `Freigegeben` → `In Arbeit` → `PR offen` → `Erledigt` (oder `Abgelehnt`).
Aufwand: S = eine Nacht, M = zwei bis drei Nächte, L = mehrere Etappen.

## Fundament

| # | Aufgabe | Nutzen | Aufwand | Abhängigkeiten | Status |
|---|---|---|---|---|---|
| F1 | Browser-Journey (`tests/e2e/journey.mjs`) in GitHub Actions lauffähig machen, inkl. Stellvertreter für OpenStreetMap | Jeder PR wird automatisch durchgeklickt, bevor du ihn siehst | M | – | Freigegeben |
| F2 | Barrierefreiheit automatisch prüfen (axe-core in der Journey) | Fehler bei Kontrast, Beschriftung, Tastatur fallen sofort auf | S | F1 | Vorschlag |
| F3 | Produktionsbuild-Größe überwachen, Seiten aufteilen wo nötig | Schneller Start auf dem Handy | S | – | Vorschlag |

## Produkt

| # | Idee | Nutzen für die Crew | Aufwand | Abhängigkeiten | Status |
|---|---|---|---|---|---|
| P1 | Termin-Abstimmung: mehrere Datumsoptionen unabhängig vom Ort („Wann könnt ihr?“) | Das häufigste Problem in Gruppen ist der Termin, nicht der Ort | M | – | Vorschlag |
| P2 | Kalender-Export (.ics) für bestätigte Pläne, Abo-Link pro Person | Plan landet im eigenen Kalender, mit Änderungen | S | – | Vorschlag |
| P3 | Kosten aufteilen nach dem Abend: wer hat was ausgelegt, wer schuldet wem (nur Übersicht, keine Zahlung) | Löst den nervigsten Teil nach dem Treffen | M | – | Vorschlag |
| P4 | Web-Push-Benachrichtigungen (neue Abstimmung, Plan bestätigt, Erinnerung am Tag) | Niemand verpasst eine Abstimmung | M | VAPID-Schlüssel (kostenlos), iOS nur als installierte Web-App | Vorschlag |
| P5 | Wetter für Plantag und Ort (Open-Meteo, ohne Schlüssel), Hinweis bei Draußen-Aktivitäten | Biergarten oder Bowling? Entscheidung mit Fakten | S | – | Vorschlag |
| P6 | Karte in Discover (OSM-Kacheln, erst nach Klick geladen) | Orte in der Nähe auf einen Blick | M | Nutzungsregeln der Kachelserver; bei Last eigener Anbieter | Vorschlag |
| P7 | Fotos von OSM-Orten über Wikidata/Wikimedia Commons, mit Lizenzangabe pro Bild | Discover sieht lebendiger aus, ohne Bilder zu erfinden | M | Nur Bilder mit freier Lizenz und Namensnennung | Vorschlag |
| P8 | Wiederkehrende Pläne („jeden ersten Freitag“) | Stammtische laufen von selbst | M | – | Vorschlag |
| P9 | Crew-Rückblick: gemeinsame Abende, beliebteste Orte, Serien | Bindung und Spaß, ohne Daten nach außen | M | – | Vorschlag |
| P10 | Fotos zum Plan teilen (nur Crew sichtbar, Supabase Storage) | Erinnerungen an einem Ort | M | Speicherkosten, Moderation, Löschfristen | Vorschlag |
| P11 | Englische Oberfläche | Gemischte Freundeskreise, Expats | M | – | Vorschlag |
| P12 | Anmeldung mit Google und Apple | Weniger Hürden bei der Registrierung | S | Entwicklerkonten bei Google/Apple, Schlüssel als Secret | Vorschlag |
| P13 | Live-Standort nur während eines Plans (Opt-in, verfällt automatisch) | Treffpunkt finden, ohne Dauertracking | L | Datenschutz-Konzept, Einwilligung, Aufbewahrung | Vorschlag |

## Offene Fragen an Benito

- Soll die App öffentlich (jede Person kann sich registrieren) oder zunächst nur auf Einladung starten?
- Ab wann eigener Overpass-/Nominatim-Dienst statt der öffentlichen OSM-Server?

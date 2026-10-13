# Design-Richtung „Wow, aber nicht zu viel"

Freigegeben von Benito am 12.10.2026 als Richtung. Konzept-Screens: `home.png`, `poll.png`, `discover.png` (Quelle: die gleichnamigen `.html` mit `style.css`). Die Konzepte sind Vorlage, kein Code zum Kopieren – umgesetzt wird mit den Komponenten und Tokens der App.

## Leitidee
Ein Abend mit Freunden ist ein Ereignis. Die App fühlt sich an wie das Ticket dafür: plakativ, haptisch, nachts gut lesbar. Der Wow-Effekt kommt aus **einem** großen Moment pro Screen, nicht aus Effekten überall.

## Was sich ändert
1. **Überschriften als Plakat:** Big Shoulders Display in Versalien, groß (42–48 px mobil), ein Schlüsselwort in Lime („Noch 3 Tage bis **Bowling**", „Was machen wir am **Freitag?**", „Leipzig **heute Abend**"). Der Satz kommt aus echten Daten, nie Dekor.
2. **Das Ticket ist der Held auf Home:** nächster Plan als großes Ticket mit Lime-Abriss (Wochentag, riesiges Datum, Monat, Strichcode-Detail), gestrichelte Perforation, Kerben, leicht schräg (−1,2°), weicher Schatten. Zusage-Avatare und „4 von 6 dabei" auf dem Ticket.
3. **Licht statt Fläche:** sehr dezenter Lime-Schein oben auf Home (Radialverlauf, ~13 % Deckkraft), feines Korn über der Fläche (~5 %). Karten mit 1-px-Lichtkante oben.
4. **Abstimmen = Balken:** Jede Option zeigt den Stand als Lime-Verlauf im Hintergrund, Zahl in Display-Schrift, Avatare der Zusagen. Eigene Wahl mit Lime-Rahmen, führende Option mit „Vorn"-Badge und leichtem Lime-Schimmer.
5. **Home zeigt, was fehlt:** „Deine Stimme fehlt" mit Mini-Ergebnis direkt auf Home.
6. **Discover mit Bühne:** eine große Hauptkarte (offen jetzt, nah), darunter horizontale Reihe. Kategorie-Grafiken auf dunklem Lime-Radialverlauf; echte Fotos ersetzen sie, sobald P7 fertig ist.
7. **Navigation:** halbtransparente Leiste mit Unschärfe, aktiver Tab mit Lime-Strich oben und Lime-Icon.

## Bewegung (D1, D7)
Nur dort, wo etwas passiert: Stimmbalken wachsen beim Abstimmen, Ticket „reißt ab", wenn ein Plan bestätigt wird. Seitenwechsel gleiten (View Transition: aus- und aufsteigend, Navigation bleibt stehen, Lime-Strich gleitet zum Tab, angetipptes Ticket wird zum großen Ticket). Beim Antworten schlägt der Stempel auf und das Ticket gibt kurz nach. `prefers-reduced-motion` schaltet alles ab.

## Antwortfarben (D7, Benitos Wunsch vom 13.10.2026)
Die eigene Antwort auf einen Plan färbt den Abriss des Tickets und die Antwort-Knöpfe: **grün (Lime) dabei, gelb (Amber) vielleicht, rot (Danger) abgesagt**, grau ohne Antwort und bei vergangenen Plänen. Auf dem großen Ticket ersetzt ein Stempel den Strichcode, dazu ein Hauch Schein in der Antwortfarbe. Gelb und Rot gibt es nur dort – überall sonst bleibt Lime der einzige Akzent.

## Grenzen (damit es nicht zu extrem wird)
- Lime bleibt der einzige Akzent; Gelb und Rot nur als Antwortfarben auf Ticket und Antwort-Knöpfen (siehe oben); keine bunten Verläufe.
- Kein Glassmorphismus außer der Tab-Leiste, keine Neon-Glows auf Text, keine Dauer-Animationen.
- Kontrast AA für Text, Bedienflächen ≥ 44 px.
- Nichts erfinden: „Jetzt geöffnet" nur mit bekannten Öffnungszeiten, Entfernung nur mit Koordinaten, Preis sonst „unbekannt".

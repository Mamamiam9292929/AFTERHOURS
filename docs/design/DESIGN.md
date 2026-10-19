# Design-Richtung „AFTERHOURS 2.0“ – Aurora × Y2K × Deck

Freigegeben von Benito am 19.10.2026 („hau das design rein, das ist geil“). Entwürfe: Design-Canvas „AFTERHOURS Neues Design“ (Home → Satz → Wischen → Match, Link im Gruppenchat, Abstimmen ohne Konto, Heute noch wer?). Höchste Priorität.

## Leitidee
Cool, modern, jugendlich. Drei Zutaten:
- **Aurora (B):** fast schwarzer Grund, weiche Farbwolken (Violett #7B5CFF, Pink #FF4FA3, ein Hauch Lime) treiben langsam hinter der App; Kopf, Seitenleiste und Tab-Leiste aus Glas.
- **Y2K Bold (C):** Unbounded, breit und fett, für Überschriften und Zahlen; Plakat-Überschriften in Chrom (`.chrome`), ein Schlüsselwort darf Lime tragen. Lesetext in Instrument Sans.
- **Deck (E):** Alles ist eine Karte. Große Pläne liegen oben auf einem angedeuteten Stapel; Abstimmen per Wischen (S6); Knöpfe sind Pillen.

## Farben mit Bedeutung
- **Lime #C8FF2E** = los / dabei (Hauptknopf, aktiver Tab, Zusage).
- **Antwortfarben:** Die eigene Antwort färbt die ganze Plan-Karte und die Antwort-Knöpfe – **grün dabei, gelb vielleicht, rot abgesagt**, dunkles Glas ohne Antwort, gedämpft wenn vorbei. Auf farbigen Karten ist die Schrift dunkel.
- Violett und Pink nur als Licht und Kartenfläche, nie als Textfarbe.

## Bewegung
Morph statt Sprung: Seitenwechsel gleiten (View Transitions), der Lime-Knopf wird zum Eingabefeld, eine angetippte Karte zur Seite, Karten fliegen beim Wischen raus, der Stempel schlägt beim Antworten auf. Aurora treibt sehr langsam. `prefers-reduced-motion` schaltet alles ab.

## Grenzen
- Kontrast AA für Text, Bedienflächen ≥ 44 px, sichtbarer Fokus (Lime-Rahmen).
- Keine Emojis als Icons, keine erfundenen Daten: „Jetzt geöffnet“ nur mit bekannten Öffnungszeiten, Entfernung nur mit Koordinaten.

## Etappen (Roadmap V2)
1. Fundament: Schriften, Farben, Aurora, Chrom, Glas, Pillen-Knöpfe, Plan-Karten in Antwortfarbe.
2. Home als Stapel mit „Was geht?“-Knopf, der zur Ein-Satz-Abstimmung (S1) aufgeht.
3. Wischen statt Liste (S6) mit „Match“.
4. Restliche Screens (Discover, Abstimmung, Gast-Stimmzettel, Spontan-Frage S4) im neuen Stil.

---

Frühere Richtung (D0, 12.10.2026, abgelöst): Anthrazit, Big Shoulders Display, Ticket mit Abriss. Konzept-Screens `home.png`, `poll.png`, `discover.png` bleiben als Archiv.

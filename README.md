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
| Echte Orte | Jede Stadt in Deutschland: Beim ersten Aufruf importiert die Edge Function `places` die Orte aus OpenStreetMap (Restaurants, Cafés, Bars, Kinos, Bowling, Minigolf, Bäder, Escape Rooms, Lasertag, Kart, Klettern, Theater, Museen, Zoos …), danach liegen sie 30 Tage in der Datenbank. Quelle und Stand stehen bei jedem Ort, Öffnungszeiten werden übersetzt oder im Original gezeigt. Ersatzserver (O1): Antwortet der Overpass-Server nicht, ist überlastet (429/503/504), meldet eine Zeitüberschreitung oder liefert Unbrauchbares, fragt `places` den nächsten aus `OVERPASS_URLS` (Standard: overpass-api.de, dann overpass.private.coffee; beide öffentlich laut OSM-Wiki). Die Zeit (120 s) wird auf die Server verteilt. Jeder Import, der OSM erreicht hat, steht mit allen Versuchen (Server, Ergebnis, Dauer) in `place_sync_runs`; Admins sehen unter Admin → Übersicht „Orte-Import aus OpenStreetMap“: Importe, Fehlschläge, Fehlerquote der letzten 7 Tage, Importe über den Ersatzserver, Fehler nach Art und Erfolg je Server – über 2 % erscheint der Hinweis aus der Entscheidung vom 14.10.2026. Stadtsuche mit Ersatz (O2): Fällt Nominatim aus (Netzfehler, 429/5xx, Zeitüberschreitung, Unbrauchbares), nimmt `places` die gespeicherte OSM-Kennung einer schon importierten Stadt (`known_place_region`) oder fragt Photon von Komoot (`PHOTON_URL`, Standard photon.komoot.io, nur Siedlungen in Deutschland). Sagt Nominatim „gibt es nicht“, wird niemand weiter gefragt. Die Admin-Karte zeigt Fehlschläge getrennt nach Stadtsuche und Overpass, Städte über Ersatz gefunden und Erfolg je Stadtsuche-Server |
| Discover | Freie Stadtwahl, Kategorien, Suche (serverseitig über alle Orte der Stadt), Filter (Preis, Entfernung ab Stadtmitte, Gruppengröße, Dauer, drinnen/draußen, Alter, jetzt geöffnet), Detailseite mit Öffnungszeiten, Karte (erst nach Klick), Meldefunktion |
| Abstimmungen | 1–10 Optionen aus Orten oder eigenen Vorschlägen, Termin je Option, Budget, Treffpunkt, Mindestteilnehmer, Frist; Antworten „Bin dabei / Vielleicht / Bin nicht dabei“, änderbar bis zum Ende; Zwischenstand, Beteiligung, Erinnerung; „Abstimmung teilen“ (W8) mit eigenem Teilen-Link `/v/<token>` (W2 Etappe 2, siehe Teilen-Karten); Ergebnis, Gleichstand, Stichwahl; automatisches Ende nach Fristablauf. **Termin-Abstimmung (P1 Etappe 1):** Oben im Formular wechselt „Was machen wir? / Wann könnt ihr?“ die Art (auch per `/polls/new?kind=date`). Bei „Wann könnt ihr?“ schlägt man 2–10 Termine vor (vorausgefüllt: nächstes Wochenende Fr/Sa und der Freitag danach, 19 Uhr; Uhrzeit optional, höchstens ein Jahr voraus, keine doppelten). Gespeichert über `create_date_poll`, das `create_poll` mit allen Prüfungen nutzt; der Server setzt den Titel jeder Option („Samstag, 17. Oktober“), sortiert chronologisch und setzt `polls.kind = 'date'`. Abgestimmt wird wie gewohnt, Ergebnis, Gleichstand, Stichwahl (erbt die Art), Gäste und Teilen funktionieren unverändert. Die Abstimmung trägt „Termin-Abstimmung“, jede Option zeigt nur die Uhrzeit (sonst „Uhrzeit offen“), keinen Preis. „Plan erstellen“ übernimmt Datum und Uhrzeit des Gewinner-Termins; den Titel („z. B. Bowling“) tippt man selbst ein, statt dass der Plan „Samstag, 17. Oktober“ heißt. **Etappe 2:** Auf der Crew-Seite öffnet „Termin finden“ direkt „Wann könnt ihr?“ (`/polls/new?crew=<id>&kind=date`). Steht der Gewinner-Termin fest, zeigt das Ergebnis jedem Mitglied „Und wo?“ mit „Ort abstimmen“: eine neue Abstimmung über Orte, in der Datum und – falls vorhanden – Uhrzeit des Gewinner-Termins schon eingetragen sind (`/polls/new?crew=<id>&date=YYYY-MM-DD&time=HH:MM`; ungültige oder vergangene Daten im Link werden ignoriert, ein Termin ohne Uhrzeit bleibt ohne Uhrzeit). Geteilt (`/v/<token>`) zeigt die Karte die Termine als kleine Abrisse, die Messenger-Vorschau „2 Termine zur Wahl: Fr 23.10. 20:00, Sa 24.10. · … Wann kannst du?“ (höchstens vier Termine, danach „und 2 weitere“), und der Gast-Stimmzettel fragt „Wann kannst du?“ mit Datum als Titel und nur der Uhrzeit darunter. Dafür liefern `preview_shared_poll` und `shared_poll_ballot` zusätzlich die Art (`kind`), die Vorschau bei Termin-Abstimmungen zusätzlich die Termine (`dates`: Datum, Uhrzeit) – Termine enthalten weder Namen noch Orte; bei Orts-Abstimmungen bleibt die Vorschau ohne Vorschläge |
| Pläne | Zusage direkt auf Home (D6): Unter jedem Ticket in „Deine Antwort fehlt“ stehen „Bin dabei / Vielleicht / Kann nicht“ – gleiche RPC `set_attendance` wie auf der Planseite, danach wandert der Plan mit der Farbe der Antwort weiter. Aus einer Abstimmung oder direkt; Status Vorschlag → Bestätigt → Reservierung ausstehend → Gebucht → Abgeschlossen bzw. Abgesagt; Zu- und Absagen; Kosten pro Person und gesamt; Bearbeiten mit Benachrichtigung bei wesentlichen Änderungen; „Plan teilen“ (W8): Teilen-Menü des Geräts (Web Share API), sonst Text und Link in die Zwischenablage – geteilt werden nur Titel, Zeitpunkt und Link, keine Namen, Adressen oder Treffpunkte. „In den Kalender“ (P2 Etappe 1) unter „Wann?“ bei anstehenden Plänen: lädt eine iCalendar-Datei (`src/lib/ics.ts`, RFC 5545), die im Browser entsteht – Titel, Beginn, Ende nur wenn bekannt (sonst kein erfundenes), Adresse, Treffpunkt, Link zum Plan, Status (Vorschlag = vorläufig); keine Namen, Teilnehmer oder E-Mail-Adressen. Feste UID je Plan, damit ein erneuter Import den Termin ersetzt. Der Link ist ein eigener Teilen-Link `/s/<token>` (W2, siehe unten). Übersichten laden höchstens die 200 Pläne mit dem spätesten Beginn: Bei sehr vielen Abenden fallen die ältesten aus Listen und Zählern („3 gemeinsame Abende“), nie anstehende |
| Kalender-Abo (P2 Etappe 2) | Unter Einstellungen → „Kalender-Abo“ legt jede Person einen persönlichen Abo-Link an (`/c/<token>.ics`, 64 Hex-Zeichen, `renew_calendar_feed`). Daneben „In Apple Kalender öffnen“ (derselbe Link als `webcal://`), „Google Kalender“ (öffnet Google mit dem Link als `cid`; Google ruft ihn dann selbst ab) und „Link kopieren“ für Outlook & Co. Kalender-Apps rufen den Link ohne Anmeldung ab; die Vercel-Funktion `api/calendar.js` fragt `calendar_feed_events` mit dem öffentlichen anon-Key und liefert iCalendar (`api/_lib/calendar-feed.js`, gleicher Aufbau und gleiche UID je Plan wie die Einzeldatei). Drin sind die Pläne aller Crews, in denen die Person gerade Mitglied ist, ab 60 Tagen zurück (höchstens 300): Titel, Beginn, Ende (nur wenn bekannt), Adresse, Treffpunkt, Crew-Name, Link zum Plan. Pläne, bei denen sie abgesagt hat, fehlen; abgesagte Pläne heißen „Abgesagt: …“ (STATUS:CANCELLED), bei eigener Antwort „Vielleicht“ „Vielleicht: …“ (vorläufig), Vorschläge sind vorläufig, fehlt die Antwort, steht „Deine Antwort fehlt noch.“ in der Beschreibung. Keine Namen anderer Mitglieder, keine Notizen, Kosten oder E-Mail-Adressen. Die Karte zeigt den Link (auch nach dem Neuladen, für ein zweites Gerät), den Hinweis, ihn wie ein Passwort zu behandeln, und „Zuletzt abgerufen …“. „Neuen Link erstellen“ ersetzt ihn sofort (der alte liefert 404), „Abo beenden“ löscht ihn – beides mit Rückfrage. Auf der Planseite führt „Alle Pläne automatisch: Kalender-Abo“ unter „In den Kalender“ dorthin. Kalender-Apps fragen meist nur alle paar Stunden nach; der Kalender bittet um stündliches Nachsehen (`REFRESH-INTERVAL`), das CDN hält die Antwort 5 Minuten |
| Wetter zum Plan (P5) | Auf der Planseite steht unter „Wo?“ das Wetter für Beginn und Ort des Plans: „14 °C · Regen“, darunter „um 20 Uhr · 70 % Regenrisiko · Wind 12 km/h“ und die Quelle „Vorhersage von Open-Meteo, Stand 04:53 Uhr. Kann sich noch ändern.“ mit Link. Findet der Plan draußen statt (`activities.setting` = `outdoor` oder `both`), kommt bei Gewitter, Schnee/Glätte, Regen (ab 50 % Risiko) oder höchstens 3 °C ein kurzer Hinweis („Draußen und Regen möglich – vielleicht einen Plan B überlegen?“); drinnen nie. Nur bei anstehenden Plänen mit einem Ort aus Discover, der Koordinaten hat – ohne Ort, nach dem Plan und bei Absage erscheint nichts; mehr als 14 Tage voraus steht „Vorhersage ab Samstag, 31. Oktober – zwei Wochen vor dem Plan.“ Fehlt ein Wert in der Vorhersage, fehlt er auch in der Anzeige. Abgefragt wird über die Edge Function `weather` (nicht aus dem Browser): Sie prüft per `plan_weather` Mitgliedschaft und Rate Limit (120 je Stunde), rundet den Ort auf zwei Nachkommastellen (rund 1 km) und fragt Open-Meteo nur nach Ort und Tag (Zeitzone Europe/Berlin) – ohne IP-Adressen, Namen oder Pläne. Die Stundenwerte des Tages liegen danach drei Stunden in `weather_forecasts` (`store_weather_forecast`, nur service_role), sodass sich die Crew eine Abfrage teilt; vergangene Tage werden beim Speichern gelöscht. Ladezustand „Vorhersage wird geladen …“, Fehler „Wetter gerade nicht abrufbar.“ mit „Erneut versuchen“. Open-Meteo ist frei ohne Schlüssel nur für nicht-kommerzielle Nutzung (siehe Abschnitt 12) |
| Kosten teilen (P3 Etappe 1–3) | Auf jeder Planseite unter „Kosten teilen“ (nach dem Start oben, davor unter den Fahrgemeinschaften): „Ausgabe eintragen“ mit Wofür (2–80 Zeichen), Betrag (0,01–10.000 €), wer bezahlt hat (Standard: ich; jedes Mitglied der Crew) und auf wen geteilt wird (Chips; vorausgewählt sind alle Zusagen plus die zahlende Person, ohne Zusagen die ganze Crew), dazu die Vorschau „je 24 € bei 2 Personen“. Der Server teilt gleichmäßig und vergibt Rest-Cent der Reihe nach (`add_plan_expense`, Anteile in `plan_expense_shares`), damit alle Geräte dieselben Beträge sehen. Ungleich aufteilen (Etappe 2): Der Schalter „Beträge je Person“ zeigt für jede ausgewählte Person ein Betragsfeld; leere Felder teilen sich den Rest gleichmäßig und zeigen ihn als Platzhalter, eine Summenzeile sagt sofort „Passt auf den Cent“, „Noch 2 € offen“ oder „2 € zu viel“ (`splitCustom` in `src/lib/settle.ts`). Der Server prüft mit `add_plan_expense_custom`, dass jede Person nur einmal vorkommt, jeder Anteil mindestens 1 Cent ist und alle Anteile genau den Betrag ergeben (`expense_shares_mismatch`). In den Einträgen steht dann „für dich (12 €) und Bob (18 €)“; Benachrichtigungen nennen jeder Person nur ihren eigenen Anteil. Darüber der Stand: Ausgaben gesamt, dein Anteil, dein Saldo („Du bekommst noch 19 €“ in Lime, „Du gibst noch 14 €“ in Gelb) und „Wer gibt wem?“ – so wenige Überweisungen wie möglich (`src/lib/settle.ts`: wer am meisten schuldet, zahlt an die Person, die am meisten bekommt; bei Gleichstand nach ID, damit alle dasselbe sehen). Wer an einer Überweisung beteiligt ist, tippt „Erledigt“: Das trägt eine Rückzahlung ein (`record_plan_settlement`), Geld fließt dabei nicht – bezahlt wird bar, per Überweisung oder wie die Crew mag. Löschen dürfen wer eingetragen hat, wer bezahlt hat, bei Rückzahlungen auch wer das Geld bekommen hat, sowie Owner/Admins (`delete_plan_expense`, Audit-Eintrag). Benachrichtigungen „Bob hat „Getränke“ eingetragen – Dein Anteil: 5 €“ und „Bob hat dir 14 € zurückgegeben“, in den Einstellungen als Gruppe „Kosten teilen“ abschaltbar. Neue Einträge erscheinen bei den anderen per Realtime bzw. spätestens nach 30 Sekunden. Auch abgeschlossene und abgesagte Pläne lassen sich abrechnen (Anzahlungen). Der Saldo zählt nur, was eingetragen ist – die Kostenschätzung des Plans („16 € pro Person“) bleibt davon getrennt. Offene Beträge der Crew (Etappe 3): Auf der Crew-Übersicht erscheint „Offene Beträge“, sobald bei einem Abend noch Geld offen ist – oben dein Stand über alle Abende („Du bekommst insgesamt 28 €“, Zahl in Lime bzw. Gelb), darunter je Abend „Du bekommst 21 €“, „Du gibst 15 €“ oder „1 Überweisung zwischen anderen“, neueste zuerst. Ein Tipp springt zu „Kosten teilen“ auf der Planseite (`/plans/<id>#kosten`); ausgeglichen wird weiterhin je Abend. Die Salden rechnet der Server (`crew_open_balances`, nur offene Zeilen), „Wer gibt wem?“ je Abend `openPlans` in `src/lib/settle.ts`. Solange die Salden laden oder nichts offen ist, bleibt der Bereich weg |
| Crew-Rückblick (P9 Etappe 1) | Auf der Crew-Übersicht erscheint ab dem ersten abgeschlossenen Plan „Euer Rückblick“: die Zahl gemeinsamer Abende (abgeschlossene Pläne der Crew) groß in Lime, „seit Oktober 2026“ (erster Abend), daneben – nur wenn sie etwas sagen – längste Serie („3 Monate am Stück“, aufeinanderfolgende Kalendermonate mit mindestens einem Abend), größte Runde („6 dabei“, meiste Zusagen bei einem Abend) und Lieblingstag (ab drei Abenden und nur, wenn ein Wochentag eindeutig vorn liegt). Darunter die letzten 12 Monate als schmale Balken (Monat mit Zahl auch für Screenreader und als Tooltip) und „Eure Stammorte“: Orte bzw. Titel mit mindestens zwei Abenden, höchstens drei. Gerechnet wird im Browser aus den Plänen, die die Crew ohnehin sieht (`src/lib/recap.ts`, Berliner Zeit) – keine neue Datenbankfunktion. Bewusst keine Rangliste von Personen („wer war am öftesten dabei“) |
| Reservierung | Dokumentierter Ablauf: Entwurf → ausdrückliche Freigabe → Ergebnis eintragen. Die App reserviert nicht selbst (siehe unten) |
| Fahrgemeinschaften | Fahrt anbieten, Mitfahrt anfragen, Zusage durch die fahrende Person, Platzkontrolle |
| Rewards | Punkte-Ledger: 30 Punkte fürs Organisieren, 10 fürs Dabeisein, vergeben beim Abschließen eines Plans – serverseitig, einmalig, mit Tageslimit |
| Benachrichtigungen | In-App für alle im Konzept genannten Ereignisse, pro Gruppe abschaltbar, gelesen/ungelesen, löschen |
| Admin | Geschützter Bereich: Kennzahlen, Zustand des Orte-Imports (O1/O2, `admin_place_sync_health`), Aktivitäten ein-/ausblenden und als geprüft markieren, Meldungen bearbeiten, Audit-Log |
| Teilen-Karten (W2 Etappe 1) | Geteilte Pläne bekommen einen eigenen Link `/s/<token>` (ein Link je Plan, angelegt beim ersten Öffnen der Planseite durch ein Mitglied). Messenger (WhatsApp, Signal, Telegram …) zeigen dazu eine Vorschau: Titel des Plans, „Freitag, 17. Oktober · 20:00 Uhr · 3 sind dabei. Bist du dabei?“ und ein Vorschaubild im Ticket-Stil (`public/og/plan.png`, für alle Pläne gleich; Quelle `docs/design/og-plan.html`). Die Tags setzt die Vercel-Funktion `api/share.js` in die normale App-Hülle. In der App: Mitglieder der Crew springen direkt zum Plan; Freunde ohne Konto sehen die Karte (Titel, Zeit, Zahl der Zusagen) mit „Konto erstellen“ und kommen nach der Registrierung auf die Karte zurück; Angemeldete außerhalb der Crew sehen die Karte mit dem Hinweis, nach dem Einladungslink zu fragen. Drei Tage nach dem Plan zeigt der Link nichts mehr. **Abstimmungen (Etappe 2):** eigener Link `/v/<token>` je Abstimmung (angelegt beim ersten Öffnen der laufenden Abstimmung durch ein Mitglied, Tabelle `poll_share_links`). Vorschau im Messenger: die Frage, „3 Vorschläge · 2 haben abgestimmt · Abstimmen bis Samstag, 18. Oktober · 20:00 Uhr. Stimmst du mit ab?“ (nach dem Ende „Entschieden – 3 haben abgestimmt.“) und ein eigenes Vorschaubild (`public/og/poll.png`, für alle Abstimmungen gleich, Quelle `docs/design/og-poll.html`, Beispiel-Karte mit „Vorschlag 1–3“ als „Beispiel“ markiert). In der App sehen Freunde ohne Konto die Abstimmung als Karte (Frist im Abriss, Frage als Plakat, Zahl der Vorschläge und der Personen, die abgestimmt haben) mit „Konto erstellen“, Mitglieder springen zur Abstimmung, Außenstehende sehen die Karte mit dem Hinweis auf den Einladungslink. Was zur Wahl steht, steht bewusst weder in der Vorschau noch auf der Karte (eigene Vorschläge wie „Grillen bei Bob“ enthalten Namen). Drei Tage nach dem Ende zeigt der Link nichts mehr. Mitstimmen ohne Konto siehe W3; ein Vorschaubild je Plan (Titel im Bild) in Etappe 3 |
| Mitstimmen ohne Konto (W3 Etappe 1) | Wer eine Abstimmung gestartet hat (oder Owner/Admin der Crew ist), schaltet in der Seitenleiste der Abstimmung unter „Gäste“ „Gäste dürfen mitstimmen“ ein (Standard: aus; nur solange die Abstimmung läuft). Dann zeigt der Teilen-Link `/v/<token>` Freunden ohne Konto (und Angemeldeten außerhalb der Crew) statt der Karte einen Stimmzettel: Frage, Frist, alle Vorschläge mit Termin und Stand („3 dabei · 1 vielleicht“, ohne Namen), je Vorschlag „Bin dabei / Vielleicht / Bin nicht dabei“, dazu „Dein Name“ (2–40 Zeichen). Danach „Deine Stimme ist drin, Dana“ – änderbar bis zum Ende – und der Weg zum eigenen Konto. Das Gerät merkt sich je Link ein zufälliges Geheimnis (64 Hex-Zeichen, `localStorage` `afterhours.guest.<token>`); die Datenbank speichert nur dessen SHA-256-Hash. Gast-Stimmen zählen beim Ergebnis und bei der Stichwahl wie die der Crew. Die Crew sieht Gäste in Balken und „Wer hat wie geantwortet?“ als „Dana (Gast)“, dazu „+ 1 Gast hat mitgestimmt“; wer verwaltet, sieht die Gästeliste und kann Gäste entfernen (Name und Antworten werden gelöscht). Die Erstellerin bekommt beim ersten Abstimmen eines Gasts eine Benachrichtigung „Dana (Gast) hat abgestimmt“. Die Messenger-Vorschau endet dann mit „Stimmst du mit ab? Geht auch ohne Konto.“ Ausschalten verhindert neue Gast-Stimmen; bisherige bleiben. **Gast-Stimmen übernehmen (Etappe 2):** Wer als Gast abgestimmt hat und danach der Crew beitritt (Konto anlegen, Einladungslink), findet auf derselben Abstimmung – auf dem Gerät, mit dem er abgestimmt hat – die Karte „Du hast hier schon als Gast abgestimmt“ („Als „Erik“ hast du 2 Antworten gegeben …“). „Stimmen übernehmen“ macht die Gast-Antworten zu eigenen Antworten des Mitglieds; wo es schon selbst geantwortet hat, bleibt seine Antwort (die Karte sagt das vorher). „Gast-Stimme löschen“ (mit Rückfrage) verwirft sie. Danach ist der Gast gelöscht, und das Geheimnis wird vom Gerät entfernt – keine Person zählt doppelt. Nur solange die Abstimmung läuft und nur mit ausdrücklichem Tipp; die App übernimmt nie von selbst. Der Stimmzettel sagt Gästen nach dem Abstimmen, dass sie ihre Stimme beim Beitritt mitnehmen können. **Crew-Beitritt vom Stimmzettel (Etappe 3):** Owner oder Admins schalten bei einer Abstimmung mit Gästen zusätzlich „Gäste dürfen der Crew beitreten“ ein (Standard: aus; Erstellerinnen ohne Admin-Rolle sehen den Hinweis, dass Owner/Admins das freischalten). Wer dann als Gast abgestimmt hat, sieht auf dem Stimmzettel „Komm in die Crew, Hanna“ mit „Crew beitreten“: Ein Tipp holt einen persönlichen Einladungslink (einmal gültig, 7 Tage, „lädt dich ein“ = wer freigeschaltet hat) und öffnet die normale Einladung `/invite/<token>` – Konto anlegen, beitreten, auf der Abstimmung die Gast-Stimme übernehmen. Vor dem Beitritt verrät der Stimmzettel weiter weder Crew-Namen noch Mitglieder. Fordert derselbe Gast erneut an, verfällt sein alter Link; Ausschalten (auch „Gäste dürfen mitstimmen“ aus), Entfernen des Gasts oder der Verlust der Admin-Rolle der Person, die freigeschaltet hat, beenden den Beitritt und widerrufen offene Gast-Links. Gast-Links stehen nicht in der Einladungsliste der Crew und zählen nicht gegen deren Grenze von 10 offenen Einladungen |
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
   supabase functions deploy weather   # P5: Wetter zum Plan (Open-Meteo, ohne Schlüssel)
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

Das Frontend ist eine statische Single-Page-App. `npm run build` erzeugt `dist/`. Ausnahmen: die Vercel-Funktionen `api/share.js` für die Messenger-Vorschau geteilter Pläne (W2) und `api/calendar.js` für das Kalender-Abo (P2 Etappe 2).

**Vercel** – Repository importieren; Framework „Vite“ wird erkannt. Umgebungsvariablen aus [Abschnitt 5](#5-umgebungsvariablen) setzen. `vercel.json` liefert SPA-Rewrite und Sicherheits-Header und leitet `/s/<token>` (Plan) und `/v/<token>` (Abstimmung) an die Funktion `api/share.js` (Node-Laufzeit, keine eigene Abhängigkeit), `/c/<token>.ics` (Kalender-Abo, P2 Etappe 2) an `api/calendar.js`. Sie lädt `index.html` der eigenen Domain, fragt `preview_shared_plan` bzw. `preview_shared_poll` mit dem öffentlichen anon-Key ab und setzt Titel, Beschreibung und Open-Graph-Tags in den `<head>`; die Antwort wird 5 Minuten im CDN zwischengespeichert. Sie liest `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` und `VITE_SITE_URL` zur Laufzeit – dieselben Variablen wie der Build, also nichts zusätzlich anzulegen.

**Netlify / Cloudflare Pages** – Build-Befehl `npm run build`, Ausgabeordner `dist`. `public/_redirects` und `public/_headers` werden mit ausgeliefert. Geteilte Links funktionieren dort, nur die Messenger-Vorschau ist dann allgemein (die Funktion `api/share.js` müsste als Netlify-/Cloudflare-Function nachgebaut werden). Das Kalender-Abo (`api/calendar.js`) funktioniert dort ohne Nachbau gar nicht – `/c/<token>.ics` liefert dann die App statt eines Kalenders.

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
| `PHOTON_URL` | Ersatz-Stadtsuche, wenn Nominatim ausfällt (Standard `https://photon.komoot.io`, `off` schaltet ab) |
| `OVERPASS_URLS`, `NOMINATIM_URL` | optional: `OVERPASS_URLS` ist eine Komma-getrennte Liste von Overpass-Servern, der Reihe nach gefragt (höchstens 4; Standard overpass-api.de, dann overpass.private.coffee). Das ältere `OVERPASS_URL` (ein Server) gilt nur ohne `OVERPASS_URLS`. Eigener oder kommerzieller Dienst einfach vorn eintragen |
| `OPEN_METEO_URL` | optional, Wetter zum Plan (P5): Standard `https://api.open-meteo.com`; für einen kommerziellen Tarif die Adresse von Open-Meteo (ggf. `customer-api.open-meteo.com`) eintragen – ein API-Schlüssel wird bisher nicht mitgeschickt |
| `ANTHROPIC_API_KEY` | nur für den KI-Assistenten |
| `ASSISTANT_MODEL` | optional, Standard `claude-haiku-5-5` |
| `ALLOWED_ORIGIN` | optional, beschränkt CORS der Edge Functions auf die App-Domain |

Den `service_role`-Key setzt Supabase in Edge Functions automatisch; die Functions `places` (importierte Orte schreiben) und `weather` (Vorhersage für die Crew ablegen) nutzen ihn. Er gehört nie ins Frontend.

---

## 6. Tests

```bash
npm run typecheck      # TypeScript
npm run test:db        # 946 pgTAP-Prüfungen der Datenbank (supabase test db)
npm run test:unit      # Messenger-Vorschau (api/share.js), Kalender-Abo (api/calendar.js), Crew-Rückblick (src/lib/recap.ts), Wetter (src/lib/weather.ts) und Kosten aufteilen, auch ungleich und je Crew (src/lib/settle.ts), ohne Netz
deno test supabase/functions/places/osm_test.ts supabase/functions/places/overpass_test.ts supabase/functions/places/geocode_test.ts supabase/functions/weather/forecast_test.ts   # OSM-Umwandlung, Öffnungszeiten, Ersatzserver, Stadtsuche, Open-Meteo
npm run test:e2e       # komplette Nutzerjourney im Browser (Playwright)
npm run build && npm run size   # Build-Größe gegen scripts/bundle-budget.json
```

**Build-Größe (`scripts/bundle-size.mjs`)** – misst nach dem Build die gzip-Größe dessen, was beim ersten Öffnen geladen wird (Skripte, Modul-Preloads und CSS aus `dist/index.html`), den größten Seiten-Chunk und alle Skripte zusammen. Grenzen in `scripts/bundle-budget.json` (Stand 19. Oktober 2026: Start 213 kB JavaScript + 12,6 kB CSS, größte Seite 24 kB, alle Skripte 361 kB; Grenzen 225 kB, 13 kB, 30 kB, 380 kB – die Gesamtgrenze wurde mit P9 von 360 auf 380 kB angehoben: sie zählt alle Seiten, die nur bei Bedarf laden, und wächst mit jeder Funktion; was beim Start lädt, bleibt bei 225 kB gedeckelt). Jede Seite ist ein eigener Chunk; React/Router, Supabase und TanStack Query liegen in eigenen Bibliotheks-Chunks, die nach einem Update im Browser-Cache bleiben. In der CI läuft die Prüfung im Job „TypeScript und Build“; die Tabelle steht in der Zusammenfassung des Laufs und als Annotation. Wer eine Grenze bewusst anhebt, begründet das im PR.

**Datenbank (`supabase/tests/database/`)** – prüft Berechtigungen aus Sicht echter API-Rollen: RLS auf jeder Tabelle, keine Rechte für `anon`, Rollenregeln in Crews, Einladungslinks (Ablauf, Limit, Widerruf), öffentliche Einladungsvorschau ohne Konto (nur freigegebene Felder, Rate Limit pro Link, ungültige Links verraten nichts), eine Stimme pro Person und Option, Ergebnislogik, Fristablauf, Statusübergänge von Plänen und Reservierungen, Punktevergabe ohne Doppelbuchung, Datenexport, Kontolöschung, Import echter Orte (Sperre, Kontingent, Aktualisierung, Deaktivierung verschwundener Orte, Suche), Mitstimmen ohne Konto (Freigabe nur durch Berechtigte, Stimmzettel ohne IDs und Namen, Eingabeprüfung, Ergebnis mit Gast-Stimmen, Entfernen, Obergrenzen und Rate Limits), Gast-Stimmen übernehmen (nur Mitglieder mit dem eigenen Geheimnis, eigene Antwort hat Vorrang, keine doppelte Stimme, nach dem Ende gesperrt, Rate Limit), Crew-Beitritt vom Stimmzettel (Freigabe nur Owner/Admin und nur mit Gästen, Link nur mit eigener Gast-Stimme, einmal gültig, Widerruf bei neuem Link, Ausschalten, Entfernen und Rollenverlust, Grenze der normalen Einladungen unberührt, Löschen ohne Konflikt), Import-Protokoll (nur die Edge Function schreibt, nur Admins lesen die Fehlerquote, Eingaben werden bereinigt, 90 Tage Aufbewahrung), Termin-Abstimmung (nur Mitglieder, 2–10 verschiedene gültige Termine, nicht in der Vergangenheit, höchstens ein Jahr voraus, deutsche Titel, chronologisch, Art nicht direkt änderbar, Plan aus dem Gewinner-Termin, Stichwahl erbt die Art), Termin-Abstimmung teilen (`15_date_poll_share`: Art in Vorschau und Stimmzettel, Termine nur bei Termin-Abstimmungen und nur Datum/Uhrzeit, keine IDs, Namen oder Beschreibung, Orts-Abstimmungen ohne Vorschläge, geratene und abgelaufene Links verraten nichts), Kosten teilen (`16_plan_expenses`: nur die Crew liest, keine direkten Schreibrechte, Anteile mit Rest-Cent und Summe = Betrag, Eingabeprüfung, Außenstehende können weder eintragen noch als Zahlende oder Beteiligte erscheinen, Rückzahlung nur durch Beteiligte, Löschrechte, Audit, Rate Limit, Benachrichtigungen, Export, Austritt und Kontolöschung), ungleich aufteilen (`17_plan_expense_custom`: Summe muss auf den Cent stimmen, kein Anteil unter 1 Cent, keine doppelten oder leeren Personen, gleich lange Listen, nur Mitglieder, jede Person erfährt nur ihren eigenen Anteil, Außenstehende und anon scheitern, gemeinsames Rate Limit), offene Beträge der Crew (`18_crew_open_balances`: Salden je Plan und Person, nur offene Zeilen, je Plan Summe 0, ausgeglichene Abende und Ausgaben nur für sich selbst fallen weg, keine fremden Pläne, Außenstehende, ehemalige Mitglieder, unbekannte Crew und anon scheitern), Kalender-Abo (`19_calendar_feeds`: Link nur für die eigene Person, Tabelle für niemanden direkt lesbar, Termine nur aus aktuellen eigenen Crews ab 60 Tagen zurück, ohne abgesagte Teilnahme, abgesagte Pläne mit Status, nur freigegebene Felder, keine Notizen, Kosten, Namen oder E-Mails, Austritt entfernt die Crew, neuer Link sperrt den alten, Beenden, Audit, ungültige Links verraten nichts und schreiben nichts, Rate Limits 60 Abrufe je Link in 10 Minuten und 10 neue Links je Stunde, Export ohne den Link, Kontolöschung), Wetter zum Plan (`20_plan_weather`: nur Mitglieder fragen ab – Außenstehende und unbekannte Pläne bekommen dieselbe Ablehnung ohne Ort, anon scheitert, nur service_role speichert, Speicher für niemanden direkt lesbar, Ort auf zwei Stellen gerundet, Tag und Stunde in Berliner Zeit, Eingabeprüfung der Stundenwerte, Speicher drei Stunden gültig, vergangene Tage verschwinden, ohne Koordinaten/ohne Ort `no_location`, über 14 Tage `too_far` ohne Koordinaten, vorbei/abgesagt `past`, Rate Limit 120 je Stunde).

**Kosten aufteilen (`tests/unit/settle.test.mjs`)** – `node --test` lädt `src/lib/settle.ts` direkt (Node 22 entfernt die Typen): Salden, Überweisungen im Beispiel der Journey, Rückzahlung ganz und teilweise, gegenseitige Schulden, Ausgabe nur für andere, zufällige Abrechnung mit 30 Einträgen (Summe stimmt, höchstens n−1 Überweisungen, danach alle ausgeglichen), feste Reihenfolge, Aufteilung mit Rest-Cent wie auf dem Server; ungleich aufteilen (alle Felder, leere Felder bekommen den Rest, zu viel/offen/nichts übrig/0 €, 500 zufällige Eingaben ergeben bei „ok“ immer genau den Betrag) und Erkennen ungleicher Einträge; Salden je Crew (`settleBalances` wie `settle`, `openPlans` mit eigenem Stand je Abend und gesamt, Nullzeilen).

**Kalender-Abo (`tests/unit/calendar-feed.test.mjs`)** – `node --test`, ohne Netz: Token-Format (mit/ohne `.ics`), Kopf, UID wie die Einzeldatei, Zeiten in UTC, Maskierung (ein Titel kann keinen Termin einschleusen), Zeilen höchstens 75 Byte ohne zerteilte Umlaute, Status und Titel bei Absage, Vorschlag, „Vielleicht“ und fehlender Antwort, kein erfundenes Ende, Unbrauchbares fällt weg, keine Teilnehmer oder E-Mails; die Funktion: 200 `text/calendar`, Token aus Pfad oder Parameter, ungültiger Token fragt die Datenbank nicht, unbekannt/beendet → 404, Rate Limit → 429, Ausfall und fehlende Konfiguration → 503, Links ohne `VITE_SITE_URL` auf die eigene Adresse. Die Journey ruft dieselbe Funktion gegen die lokale Datenbank auf (Bob legt den Link an, Kalender enthält seinen Plan, neuer Link sperrt den alten, Beenden).

**Crew-Rückblick (`tests/unit/recap.test.mjs`)** – `node --test`, ohne Netz: nur abgeschlossene Pläne zählen, erster Abend, größte Runde (nur Zusagen), Monate und Wochentage in Berliner Zeit (auch um Mitternacht und zum Jahreswechsel), längste Serie über den Jahreswechsel mit Lücke, Lieblingstag erst ab drei Abenden und nicht bei Gleichstand, Stammorte nach Ort oder Titel (ab zwei, höchstens drei, jüngster Titel), Reihenfolge der Eingabe egal. Die Journey prüft den Rückblick nach dem ersten abgeschlossenen Plan (Desktop) und auf 390 px ohne Überlauf.

**Wetter (`supabase/functions/weather/forecast_test.ts`, `tests/unit/weather.test.mjs`)** – ohne Netz: Abfrage-Adresse (gerundeter Ort, ein Tag, Europe/Berlin, nur vier Werte), Antwort mit fehlenden Werten (bleiben leer), falscher Tag und kaputte Antworten, doppelte Stunde bei der Zeitumstellung, Wahl der Stunde, Netzfehler/500/400/kein JSON → `weather_unavailable`, 429 → `weather_busy`; WMO-Codes → Art, Temperatur ohne „-0“, Draußen-Hinweis nur draußen und in fester Reihenfolge. Die Journey liest die Vorhersage aus dem Open-Meteo-Stellvertreter (`/v1/forecast` in `tests/e2e/osm-stub.mjs`), prüft Texte, Quelle, keinen Hinweis beim Bowling (drinnen), dass sich die Crew eine Abfrage teilt und dass Open-Meteo nur Ort und Tag erfährt, dazu Fehlerzustand und „Erneut versuchen“ (Smartphone, 390 px).

**OSM-Umwandlung (`supabase/functions/places/osm_test.ts`)** – Kategorien, Adressen, Links (nur https), Dubletten und der Öffnungszeiten-Parser: übersetzt werden nur sichere Fälle, alles andere bleibt Originaltext.

**Ersatzserver (`supabase/functions/places/overpass_test.ts`)** – ohne Netz: Serverliste aus `OVERPASS_URLS`/`OVERPASS_URL` (ungültige und doppelte fallen weg, höchstens 4), Aufteilung der Zeit, Wechsel zum Ersatz bei 429, 504, Netzfehler, Zeitüberschreitung, Zeitüberschreitung im Antworttext und kaputtem JSON, kein Ersatz bei Erfolg, Fehlercode wenn alle ausfallen, keine Versuche mehr nach Ablauf der Gesamtzeit. In der Journey ist der erste Overpass-Server ein absichtlich ausgefallener Stellvertreter (Port 8090, `OSM_STUB_DOWN=1`); jeder Import läuft über den Ersatz, die Journey prüft das Protokoll und die Admin-Anzeige.

**Stadtsuche mit Ersatz (`supabase/functions/places/geocode_test.ts`)** – ohne Netz: Adressen aus `NOMINATIM_URL`/`PHOTON_URL` (`off`, Ungültiges), Nominatim- und Photon-Antworten (nur Siedlungen in Deutschland, Großstadt 10 km Umkreis), bei Treffer kein Ersatz, bei „nicht gefunden“ kein Ersatz, bei Ausfall (Netz, Zeitüberschreitung, 429, 500, kaputtes JSON) erst die gespeicherte Region, dann Photon, Fehlercodes wenn alles ausfällt. In der Journey ist auch Nominatim der ausgefallene Stellvertreter (Port 8090); jede neue Stadt wird über Photon (`/api` des Stellvertreters) gefunden, die Journey prüft Protokoll und Admin-Anzeige. pgTAP `14_place_geocode_fallback`: `known_place_region` nur für service_role, Protokoll der Stadtsuche bereinigt, Aufschlüsselung nur für Admins.

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

**In GitHub Actions** läuft die Journey bei jedem Pull Request (Job „Browser-Journey“): `.github/scripts/e2e.sh setup` startet die lokale Supabase-Umgebung, die Edge Functions und den OSM-Stellvertreter `tests/e2e/osm-stub.mjs` (Nominatim, Photon und Overpass mit festem Datenbestand: Leipzig mit 2.601 Orten, „frankfurt“ → „Frankfurt am Main“, „Atlantis“ unbekannt), baut die App und liefert sie mit `vite preview` aus. Screenshots und Protokolle liegen danach als Artefakt `journey` am Lauf. Die Screenshots legt `.github/scripts/screenshots.sh` zusätzlich auf einen eigenen Branch: `screenshots/main` (Stand von main) und `screenshots/pr-<n>` (Stand eines PRs, nur für PRs aus diesem Repository). Jeder Lauf ersetzt den Branch durch einen einzigen Commit. So lassen sich Vorher/Nachher im PR verlinken (`…/blob/screenshots/pr-<n>/04-home-neu-mobile.png`) oder lokal per `git fetch origin screenshots/main` ansehen. Lokal lässt sich der Stellvertreter ebenso nutzen: `node tests/e2e/osm-stub.mjs` und in `supabase/functions/.env` `NOMINATIM_URL`/`OVERPASS_URL` auf ihn zeigen lassen.

---

## 7. Architektur

```
Browser (React-SPA)          Messenger (WhatsApp & Co.) ──► /s/<token>, /v/<token> ──► Vercel-Funktion api/share.js
   │                                                                       (anon-Key, nur preview_shared_plan/_poll)
   │                         Kalender-Apps ──► /c/<token>.ics ──► Vercel-Funktion api/calendar.js
   │  nur anon-Key + Sitzung der angemeldeten Person                       (anon-Key, nur calendar_feed_events)
   ▼
Supabase API ──► Auth        Registrierung, Sitzungen, E-Mails
             ──► PostgREST   Lesen über RLS-Policies
                             Schreiben über geprüfte RPC-Funktionen
             ──► Realtime    Änderungen an Stimmen, Plänen, Nachrichten
             ──► Edge Function „places“    OSM-Import pro Stadt (Nominatim/Photon + Overpass)
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

30 Tabellen im Schema `public`. Geldbeträge sind Cent-Werte, Zeitpunkte `timestamptz`.

| Tabelle | Inhalt |
|---|---|
| `profiles` | „users“ aus dem Konzept: Anzeigename, Profilbild, Stadt, Interessen. Zugangsdaten liegen in `auth.users` |
| `user_settings` | Private Einstellungen: Standortfreigabe, Budget, Entfernung, Benachrichtigungen |
| `app_admins` | Administratorrolle (ohne API-Zugriff) |
| `crews`, `crew_members`, `crew_invitations`, `crew_messages` | Gruppen, Rollen, Einladungslinks (nur Hash), Chat. Persönliche Gast-Links (W3 Etappe 3) tragen `via_poll_id` und `via_poll_guest_id`; Freigabe: Spalte `polls.guest_join_by` |
| `activities` | Orte mit `data_source` (demo / provider / partner / manual), `provider_id`/`external_id` (z. B. `osm` / `node/123`), `source_url`, `last_verified_at` |
| `place_regions` | Importierte Städte: OSM-Objekt, Status, Anzahl, Stand, weitere Schreibweisen |
| `place_sync_runs` | Protokoll der OSM-Importe (O1): Stadt (Normalform), Ergebnis, Fehlercode, liefernder Server, Ersatz genutzt, Versuche (Server, Ergebnis, Dauer). Seit O2 zusätzlich: Schritt des Fehlschlags (`stage`: Stadtsuche oder Overpass), Versuche der Stadtsuche, wer die Stadt geliefert hat (`geocoder`, „db“ = gespeicherte Region), Ersatz genutzt. Keine Nutzer-ID. Ohne API-Rechte; geschrieben von `record_place_sync_run` (nur service_role), gelesen über `admin_place_sync_health` (nur Admins). Einträge verfallen nach 90 Tagen |
| `polls`, `poll_options`, `poll_votes` | Abstimmungen; eine Stimme je Person und Option (Unique-Index). `polls.kind`: `place` (Orte/Vorschläge) oder `date` (Termin-Abstimmung, P1); Stichwahlen erben die Art per Trigger |
| `plans`, `plan_participants` | Pläne und Zusagen |
| `plan_share_links` | Teilen-Link je Plan (W2): Token, wer ihn angelegt hat. Ohne API-Rechte; Zugriff nur über `plan_share_token` und `preview_shared_plan` |
| `poll_share_links` | Teilen-Link je Abstimmung (W2 Etappe 2), aufgebaut wie `plan_share_links`. Zugriff nur über `poll_share_token` und `preview_shared_poll` |
| `poll_guests`, `poll_guest_votes` | Gäste ohne Konto (W3): Name und Hash ihres Geheimnisses je Abstimmung, ihre Antworten (eine je Gast und Option). Die Crew liest Name und Antworten (nicht den Hash); geschrieben wird nur über `guest_vote_shared_poll`, `remove_poll_guest`. Freigabe: Spalte `polls.guests_allowed` |
| `plan_expenses`, `plan_expense_shares` | Kosten teilen (P3): Ausgabe bzw. Rückzahlung (`kind`: `expense`/`settlement`), Betrag in Cent, wer bezahlt hat, wer eingetragen hat; je Eintrag die Anteile der Beteiligten (vom Server berechnet, Summe = Betrag). Die Crew des Plans liest beides; geschrieben wird nur über `add_plan_expense`, `add_plan_expense_custom` (Beträge je Person), `record_plan_settlement`, `delete_plan_expense`. Kontolöschung entfernt eigene Ausgaben und Anteile; Austritt aus der Crew nicht (die Abrechnung der anderen bleibt stimmig) |
| `weather_forecasts` | Wetter zum Plan (P5): Stundenwerte (Temperatur, Regenrisiko, WMO-Code, Wind) je gerundetem Ort und Tag, Abrufzeit. Keine Personen- oder Plandaten; ohne API-Rechte, Zugriff nur über `plan_weather` (lesen, Mitglieder) und `store_weather_forecast` (schreiben, service_role); vergangene Tage werden beim Speichern gelöscht |
| `calendar_feeds` | Kalender-Abo (P2 Etappe 2): je Person ein Link-Token (64 Hex-Zeichen, im Klartext, damit die Person ihren Link wieder ansehen kann), angelegt, zuletzt abgerufen (höchstens alle 15 Minuten aktualisiert). Ohne API-Rechte; Zugriff nur über `my_calendar_feed`, `renew_calendar_feed`, `revoke_calendar_feed` und `calendar_feed_events`. Verschwindet mit dem Konto |
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
| Serverseitige Berechtigungen | RLS auf allen Tabellen; `anon` hat keine Tabellenrechte und darf genau sieben Funktionen ausführen: `preview_public_invitation` (W1), `preview_shared_plan` und `preview_shared_poll` (W2), `shared_poll_ballot`, `guest_vote_shared_poll` und `guest_join_shared_poll` (W3), `calendar_feed_events` (P2), siehe unten; Schreiben über 48 RPC-Funktionen für angemeldete Nutzer mit festem `search_path`; vier weitere nur für die Edge Function `places` |
| Importierte Orte | Nutzer können einen Import nur anstoßen, nicht selbst Orte schreiben. Kontingent: 10 Importe pro Person und Stunde, 60 insgesamt; Sperre gegen parallele Importe; Links nur https, Quell-Links nur auf openstreetmap.org |
| Crew-Grenzen | Jede Policy und jede Funktion prüft die Mitgliedschaft in der Datenbank |
| Eingaben | Bereinigung und Grenzen in den Funktionen, zusätzlich Check-Constraints auf den Tabellen |
| Einladungslinks | 244 Bit Zufall, nur SHA-256-Hash gespeichert, Ablauf (max. 30 Tage), Nutzungslimit (max. 50), widerrufbar, Rate Limit auf Abfragen |
| Einladung ohne Konto (W1) | `preview_public_invitation` liefert bei gültigem Link nur Crew-Name, Emoji, Zahl der Mitglieder, Vornamen (erstes Wort des Anzeigenamens, höchstens sechs, keine Bilder), Vorname der einladenden Person und vom nächsten Plan Titel und Beginn – keine IDs, Adressen, Treffpunkte, Notizen, Kosten oder E-Mails. Ungültige, widerrufene und abgelaufene Links liefern nur ihren Status. Rate Limit 60 Abrufe je Link in 10 Minuten (`app_private.rate_limit_key`); ungültige Tokens schreiben nichts. Wer den Link hat, sieht diese Angaben – so wie bei Gruppenlinks in Messengern |
| Geteilte Pläne (W2) | `plan_share_token` gibt nur Crew-Mitgliedern den Link (30 neue Links pro Person und Stunde). `preview_shared_plan` liefert bei gültigem Link nur Titel, Beginn, Ende, Status und die Zahl der Zusagen – keine IDs, Namen, Adressen, Treffpunkte, Notizen, Kosten, keinen Crew-Namen; die Plan-ID nur angemeldeten Mitgliedern (für die Weiterleitung). Unbekannte Links liefern `not_found`, Links zu Plänen, die mehr als drei Tage vorbei sind, nur `expired`. Rate Limit 120 Abrufe je Link in 10 Minuten. Der Token (122 Bit Zufall) liegt im Klartext, damit derselbe Link mehrfach geteilt werden kann – in einer Tabelle ohne jede API-Berechtigung; er öffnet keine Crew und keinen Plan. Die Plan-ID taugt nicht als öffentlicher Schlüssel, weil sie in allen App-Adressen steht. Abstimmungen (Etappe 2) genauso: `poll_share_token` nur für Mitglieder (30 neue Links pro Person und Stunde), `preview_shared_poll` liefert nur Frage, Frist, offen/entschieden, Zahl der Vorschläge und Zahl der Personen, die abgestimmt haben – keine Vorschläge im Wortlaut, keine IDs, Namen, Treffpunkte, Budgets, Beschreibungen, keinen Crew-Namen; die ID nur angemeldeten Mitgliedern. Rate Limit 120 Abrufe je Link in 10 Minuten, drei Tage nach dem Ende nur `expired`. Plan- und Abstimmungs-Tokens liegen in getrennten Tabellen und öffnen nur ihre eigene Art |
| Mitstimmen ohne Konto (W3) | Nur nach ausdrücklicher Freigabe je Abstimmung durch Ersteller:in oder Owner/Admin (`set_poll_guests`, Audit-Eintrag). Erst dann zeigt `shared_poll_ballot` die Vorschläge im Wortlaut – mit Termin und der Zahl der Antworten je Vorschlag, ohne IDs (Schlüssel ist die Position), Namen, Treffpunkt, Budget, Beschreibung und Crew-Namen; ohne Freigabe nur `guests_off`. `guest_vote_shared_poll` prüft Link, Freigabe, Frist, Geheimnis (64 Hex-Zeichen), Name (2–40 Zeichen), jede Antwort und jeden Vorschlag, bevor es schreibt; Mitglieder der Crew werden abgewiesen (`already_member`). Grenzen: 30 Gäste je Abstimmung, 30 neue Gäste je Link und Stunde, 300 Stimmabgaben je Link in 10 Minuten, 240 Abrufe des Stimmzettels je Link in 10 Minuten. Wer den Link hat und Gäste erlaubt sind, kann unter beliebigem Namen abstimmen – deshalb steht bei jedem Gast „(Gast)“, und wer verwaltet, kann Gäste entfernen. Gäste haben kein Konto; Name und Antworten verschwinden mit der Abstimmung. Übernahme (Etappe 2): `poll_guest_claim_preview` und `claim_poll_guest` nur für angemeldete Mitglieder der Crew, nur bei laufender Abstimmung; Nachweis ist das Geheimnis vom Gerät des Gasts (wer es nicht hat, findet keinen Gast – auch nicht aus der Crew). Übernommen wird mit `on conflict do nothing` (eigene Antwort hat Vorrang), der Gast wird in derselben Transaktion gelöscht; Audit-Eintrag `poll_guest_claimed` bzw. `poll_guest_discarded`; Rate Limit 20 je Person und Stunde, Abfrage 120 je Person in 10 Minuten. Crew-Beitritt (Etappe 3): `set_poll_guest_join` nur Owner/Admin (wie `create_crew_invitation`), nur bei laufender Abstimmung mit Gästen, Audit `poll_guest_join`; `guest_join_shared_poll` (anon) prüft Link, Freigabe, Rolle der freischaltenden Person, Crew-Größe (< 50), Geheimnis einer vorhandenen Gast-Stimme und weist Mitglieder ab, dann legt es eine Einladung mit `max_uses = 1` und 7 Tagen an und gibt den Klartext-Token einmal zurück (gespeichert nur der Hash); alter offener Link desselben Gasts wird widerrufen; 30 Links je Abstimmungs-Link und Stunde; Audit `poll_guest_invitation` |
| Kosten teilen (P3) | Lesen nur für die Crew des Plans (RLS über `can_access_plan`), keine direkten Schreibrechte. `add_plan_expense` prüft Mitgliedschaft, Beschreibung (bereinigt, 2–80 Zeichen), Betrag (1 Cent bis 10.000 €), dass zahlende und beteiligte Personen aktuelle Mitglieder der Crew sind (1–50 Beteiligte, doppelte fallen weg), höchstens 200 Einträge je Plan, Rate Limit 60 je Person und Stunde. `add_plan_expense_custom` prüft dasselbe und zusätzlich: Personen- und Betragsliste gleich lang, keine doppelten oder leeren Personen, jeder Anteil 1 Cent bis Gesamtbetrag, Summe = Betrag; gleiches Rate Limit. `record_plan_settlement` nur für die beiden Beteiligten. `delete_plan_expense` nur für Eintragende, Zahlende, Empfangende einer Rückzahlung oder Owner/Admins (Rate Limit 60/h, Audit `plan_expense_deleted`). Datenexport enthält eigene Ausgaben und Anteile. Ein Mitglied kann eintragen, dass jemand anderes bezahlt hat – die zahlende Person wird benachrichtigt und kann den Eintrag löschen. `crew_open_balances` (nur lesen) prüft die Mitgliedschaft in der Crew und liefert nur Plan-ID, Person und Saldo, keine Beschreibungen. Es gibt keine Zahlungsfunktion und keine Kontodaten |
| Kalender-Abo (P2 Etappe 2) | Den Link legt nur die Person selbst an (`renew_calendar_feed`, 10 je Stunde, Audit `calendar_feed_created`/`_renewed`/`_revoked`); 244 Bit Zufall, ein Link je Person, ein neuer ersetzt den alten sofort. Der Token liegt im Klartext in einer Tabelle ohne API-Rechte – er öffnet nur Daten derselben Datenbank, und so kann die Person ihn für ein zweites Gerät wieder ansehen. `calendar_feed_events` (anon) sucht nur, was wie ein Token aussieht (ungültige schreiben nichts), liefert bei unbekannten Links nur `not_found` und sonst je Plan nur Titel, Zeiten, Adresse, Treffpunkt, Status, eigene Antwort, Crew-Name und Plan-ID – keine Namen, Notizen, Kosten, E-Mails; nur aktuelle Crews, ohne abgesagte Teilnahme. Rate Limit 60 Abrufe je Link in 10 Minuten. Wer den Link kennt, sieht diese Pläne ohne Anmeldung – das sagt die App an der Stelle deutlich. Die Vercel-Funktion antwortet mit `X-Robots-Tag: noindex` und `Cache-Control: private` (CDN 5 Minuten) |
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

**Echte Orte** – Ablauf: Discover fragt `place_region_status`; fehlt die Stadt oder ist sie älter als 30 Tage, ruft die App die Edge Function `places` auf. Sie prüft das Kontingent (`request_place_sync`), sucht die Stadt (`geocode.ts`: Nominatim, bei Ausfall gespeicherte Region oder Photon), sperrt sie (`begin_place_sync`), fragt Overpass ab, wandelt in `osm.ts` um und schreibt in Stapeln (`ingest_place_batch`, `complete_place_sync`). Orte, die bei OSM verschwunden sind, werden deaktiviert, nicht gelöscht – Abstimmungen und Pläne verweisen weiter auf sie. Weitere Kategorien: Abfrage in `buildOverpassQuery` und Zuordnung in `categorize` ergänzen.

Die öffentlichen OSM-Server sind für moderate Last gedacht (Nominatim: 1 Anfrage/Sekunde mit Kennung). Für viele Nutzer eine eigene Overpass-Instanz oder einen kommerziellen Anbieter vorn in `OVERPASS_URLS` bzw. in `NOMINATIM_URL` eintragen. Ob das nötig ist, zeigt die Fehlerquote im Admin-Bereich (Entscheidung vom 14.10.2026: ab über 2 % in einer Woche). Fällt Nominatim aus, springt die gespeicherte Region oder Photon ein (O2). Photon liefert Städte meist als Punkt; dann sucht Overpass im Umkreis (Großstadt 10 km, sonst 4 km) statt innerhalb der Stadtgrenze – beim nächsten Auffrischen mit erreichbarem Nominatim kommt die Grenze zurück. Erst wenn beide ausfallen, scheitert der Import (`osm_unavailable`/`osm_busy`, Schritt „Stadtsuche“). Ein weiterer Anbieter (Google Places, Foursquare …) braucht eine eigene Edge Function mit Schlüssel als Secret; seine Nutzungsbedingungen zur Speicherdauer beachten. Demo-Daten entfernen: `delete from public.activities where data_source = 'demo';`

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
| Import gegen die echten OSM-Server | Getestet gegen einen Stellvertreter mit dem Antwortformat von Nominatim und Overpass. Der Ersatzserver overpass.private.coffee ist nur laut OSM-Wiki öffentlich und ohne Rate Limit, aus der CI nicht live geprüft. Photon (photon.komoot.io) ist ebenfalls nur gegen den Stellvertreter geprüft; Antwortformat laut Projektbeschreibung, öffentliche Nutzung ohne zugesagte Verfügbarkeit. Bei Großstädten aus Photon deckt der Umkreis von 10 km nicht die ganze Stadt ab. Laufzeit und Datenmenge großer Städte (Berlin: mehrere Tausend Orte) hängen vom öffentlichen Overpass-Server ab |
| Supabase Realtime | Der Code abonniert Änderungen; ohne Verbindung lädt die App im Takt von 8–45 Sekunden nach. Getestet ist nur dieser Rückfall |
| Echter KI-Aufruf | Die Edge Function lief gegen einen Stellvertreter, der das Anfrageformat prüft. Modellname und Antwort eines echten Modells sind ungetestet |
| Eigene E-Mail-Vorlagen | Getestet mit den Standardvorlagen von Supabase Auth |
| Safari, Firefox, echte Mobilgeräte | Getestet nur in Chromium mit Geräte-Viewports |
| Lasttests | Keine |
| Kosten teilen (P3 Etappe 1) | pgTAP, Unit-Test und Journey (Alice trägt die Bahn ein, Bob Getränke für drei, „Wer gibt wem?“, Rückzahlung mit „Erledigt“, Benachrichtigungen, Löschen, API-Proben) in Chromium. Etappe 2 (ungleich aufteilen): pgTAP, Unit-Test und Journey (Alice trägt „Pizza“ 30 € ein, Bob 18 €, leeres Feld bekommt den Rest, „Noch 2 € offen“, „2 € zu viel“ blockiert das Senden, Eintrag „für dich (12 €) und Bob (18 €)“, Stand bei beiden). Fremdwährungen gibt es nicht; Einträge lassen sich nicht bearbeiten, nur löschen und neu anlegen. Die Vereinfachung kann Überweisungen zwischen Personen vorschlagen, die nichts direkt miteinander abgerechnet haben (Carol gibt Alice statt Bob) – so wie bei gängigen Abrechnungs-Apps. Realtime für neue Einträge ist wie überall nur im Rückfall (Nachladen) geprüft. Etappe 3 (offene Beträge der Crew): pgTAP, Unit-Test und Journey (Alice sieht auf der Crew-Seite „Du bekommst insgesamt 28 €“ und den Abend, Tipp springt zu „Kosten teilen“, Bob sieht „Du gibst insgesamt 28 €“, API-Probe für Außenstehende). Die Crew-Übersicht aktualisiert sich nicht per Realtime, sondern beim Öffnen, nach eigenen Einträgen und beim Zurückkehren in den Tab. Abende, die älter sind als die 200 geladenen Pläne, erscheinen als „Früherer Abend“ |
| Wetter zum Plan (P5) | pgTAP, Deno-Test, Unit-Test und Journey gegen einen Open-Meteo-Stellvertreter in Chromium. Nicht live gegen api.open-meteo.com geprüft (Antwortformat laut Dokumentation); Genauigkeit der Vorhersage liegt bei Open-Meteo. Der Draußen-Hinweis hängt an `activities.setting` – OSM-Orte haben das oft nicht, dann gibt es keinen Hinweis. Pläne ohne Ort aus Discover (nur Adresse) bekommen kein Wetter |
| Kalender-Abo (P2 Etappe 2) | pgTAP, Unit-Test und Journey (Funktion gegen die lokale Datenbank) in Chromium. Nicht geprüft: echtes Abonnieren in Apple Kalender, Google Kalender und Outlook (braucht eine öffentliche Adresse; Google ruft nur Links aus dem Internet ab), wie oft diese Apps tatsächlich nachsehen, und die Funktion auf Vercel selbst (kein Deployment). Bei anderen Hostern als Vercel gibt es das Abo nicht (siehe Deployment) |
| Termin-Abstimmung teilen (P1 Etappe 2) | Unit-Test (Vorschautext, Kürzung, Unbrauchbares), pgTAP und Journey (Vorschau gegen die lokale Datenbank, Gast stimmt auf dem Smartphone über Termine ab, „Und wo?“ übernimmt den Termin) in Chromium. Die „Und wo?“-Abstimmung ist nicht mit der Termin-Abstimmung verknüpft – wer den Termin danach ändert, ändert ihn in beiden Abstimmungen getrennt |
| Öffentliche Startseite (W6) | Die Journey prüft sie auf Smartphone, Tablet und Desktop (Inhalt, „Beispiel“-Kennzeichnung, keine Zahlen-/Bewertungsbehauptungen, Wege zu Registrierung und Anmeldung, Weiterleitung Angemeldeter, axe-core). Ohne Hosting gibt es keine öffentliche Adresse. Die Vorschau-Tags stehen im HTML und sind per Unit-Test und Journey geprüft (absolute Bildadresse im Build, Bild wird ausgeliefert); wie WhatsApp, Signal, Telegram und Google sie tatsächlich darstellen, ist ungeprüft. Den Seiteninhalt sehen Suchmaschinen weiter nur, wenn sie JavaScript ausführen (kein Server-Rendering); Titel und Beschreibung stehen aber im HTML. Ein Impressum fehlt (rechtlich, siehe Abschnitt 12) |
| Kalenderdatei (.ics) | Die Journey prüft Aufbau, Maskierung, Zeilenlänge und Inhalt der Datei. Der Import in Apple-, Google- und Outlook-Kalender ist nicht auf echten Geräten geprüft; ein Plan ohne Ende erscheint dort je nach Kalender als Termin ohne Dauer |
| Offline lesbare Pläne, Update-Hinweis | Die Journey prüft Speichern, Lesen ohne Netz, Löschen beim Abmelden und den Update-Hinweis (alter Build nachgestellt) in Chromium. Echte Funklöcher („Netz da, aber nichts kommt an“) zeigen weiter Ladezustände, bis die Anfrage scheitert – der Gerätespeicher springt nur ein, wenn der Browser „offline“ meldet |
| Installation und Offline auf echten Geräten | Die Journey stellt das Installations-Angebot und die Badging-API nach (Headless-Chromium hat beides nicht) und prüft Service Worker, Cache-Inhalt und Offline-Start in Chromium. Installation unter Android/iOS und der Zähler am Icon sind nicht auf Geräten geprüft |
| Messenger-Vorschau auf Vercel | Pläne (`/s/`) und Abstimmungen (`/v/`): `api/share.js` ist mit Unit-Tests und in der Journey gegen die lokale Datenbank geprüft, aber nicht auf Vercel selbst gelaufen (kein Deployment). Wie WhatsApp, Signal und Telegram die Vorschau tatsächlich darstellen, ist ungeprüft |
| Mitstimmen ohne Konto (W3) | pgTAP (84 Prüfungen, Etappe 2: 33 weitere) und Journey (Gast auf dem Smartphone, Wiedererkennen nach Neuladen, Anzeige bei der Crew, Benachrichtigung, Entfernen, API-Proben; Etappe 2: Gast stimmt ab, registriert sich über den Einladungslink, tritt bei und übernimmt seine Stimmen) in Chromium. Wer die Abstimmung auf einem anderen Gerät als dem Gast-Gerät öffnet, sieht keine Übernahme (das Geheimnis liegt nur dort) – seine Gast-Stimme zählt dann weiter zusätzlich, bis jemand den Gast entfernt. Ob Gäste die Funktion für Spaß-Stimmen missbrauchen, zeigt erst der echte Betrieb; ein Gast, der den Browser-Speicher löscht, kann ein zweites Mal abstimmen (bis 30 Gäste) |
| Crew-Beitritt vom Stimmzettel (W3 Etappe 3) | pgTAP (Freigabe, Link, Widerruf, Rollen, Kaskade) und Journey (Owner schaltet in der App frei, Gast stimmt auf dem Smartphone ab, tritt mit einem Tipp über die persönliche Einladung bei und findet die Übernahme; Link danach verbraucht; API-Probe ohne Gast-Stimme) in Chromium. Wer den Abstimmungs-Link hat und Gäste erlaubt sind, kann unter beliebigem Namen abstimmen und sich so eine Einladung holen – deshalb nur nach ausdrücklicher Freigabe durch Owner/Admin, und neue Mitglieder sieht die Crew wie bei jeder Einladung |
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
- Wetter (P5): Die freie Open-Meteo-API ist nur für nicht-kommerzielle Nutzung (bis 10.000 Abfragen am Tag). Wird AFTERHOURS kommerziell betrieben (Werbung, Abos, Partner), braucht es einen Tarif bei Open-Meteo – oder die Function `weather` bleibt ungeladen, dann zeigt die Planseite „Wetter gerade nicht abrufbar.“ Daten unter CC BY 4.0; die Quelle steht bei jeder Vorhersage.
- Bars und Nachtleben: Für Minderjährige ausblenden, sobald das Alter bekannt ist (bisher wird es nicht erhoben).
- Moderation: Meldungen landen im Admin-Bereich; ein Verfahren zum Sperren von Konten fehlt.
- Fehler-Monitoring (z. B. Sentry) ergänzen.
- Rewards mit Geldwert, Auszahlungen oder Partnerprämien erst nach steuerlicher und rechtlicher Prüfung.

## Lizenzen

Schriften: *Big Shoulders Display* und *Figtree* unter der SIL Open Font License 1.1 (`public/fonts/OFL-*.txt`). Icons: Lucide über `react-icons` (ISC). Karten- und Ortsdaten: © OpenStreetMap-Mitwirkende, Open Database License (ODbL) 1.0 – die App nennt die Quelle in Discover und bei jedem Ort. Wetterdaten: Open-Meteo.com, CC BY 4.0 – die Quelle steht bei jeder Vorhersage.

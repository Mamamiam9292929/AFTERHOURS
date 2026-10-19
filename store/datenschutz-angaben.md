# Datenschutz-Angaben für die Stores (Entwurf)

> **Nicht rechtlich geprüft.** Grundlage für Apples „App-Datenschutz“ (App Store Connect) und Googles Formular „Datensicherheit“ (Play Console). Erfasst ist der Stand des Codes vom 14.10.2026 (Datenmodell: README, Abschnitt 8 und 9). Vor dem Einreichen mit der Datenschutzerklärung abgleichen und prüfen lassen.

## Was die App speichert

| Daten | Wofür | Mit Konto verknüpft | Pflicht | Wer sieht es |
|---|---|---|---|---|
| E-Mail-Adresse | Anmeldung, Bestätigung, Passwort zurücksetzen | ja | ja | nur du (und der Betrieb) |
| Anzeigename | In der Crew erkennbar sein | ja | ja | deine Crews |
| Profilbild | In der Crew erkennbar sein | ja | nein | deine Crews |
| Stadt (selbst eingetippt, kein Gerätestandort) | Orte in Discover vorschlagen | ja | nein | nur du |
| Interessen, Lieblingsaktivitäten, Budget, Entfernung | Vorschläge passend machen | ja | nein | nur du |
| Crews, Abstimmungen, Antworten, Pläne, Zusagen, Chat-Nachrichten, Fahrgemeinschaften, Reservierungsnotizen | Kernfunktion | ja | nein | die jeweilige Crew |
| Meldungen über Orte | Moderation | ja | nein | Admins |
| Punkte | Belohnung fürs Organisieren und Dabeisein | ja | nein | nur du |
| Einstellungen (Benachrichtigungen, Standortfreigabe „aus“) | App-Verhalten | ja | – | nur du |
| Gast-Stimmen (Name, Antworten – ohne Konto, W3) | Mitstimmen ohne Konto | nein | nein | die jeweilige Crew |

Nicht erhoben: Gerätestandort (die Freigabe ist aus und es gibt keine Standort-Tabelle), Kontakte/Adressbuch, Zahlungsdaten, Gesundheitsdaten, Werbe-IDs, Diagnose- oder Absturzdaten, Nutzungsanalyse.

## Vorschlag für die Formulare

**Apple – App-Datenschutz**

- Tracking (App Tracking Transparency): **nein**, keine Daten werden zum Tracking verwendet.
- Mit deiner Identität verknüpft, Zweck „App-Funktionalität“: Kontaktinformationen → E-Mail-Adresse, Name; Benutzerinhalte → Fotos (Profilbild), Andere Benutzerinhalte (Chat, Abstimmungen, Pläne); Kennungen → Benutzer-ID.
- Offene Frage: Ob die selbst eingetippte Stadt als „Grober Standort“ zählt. Apple meint damit Standortdaten des Geräts; die Stadt ist eine Texteingabe. Vorsichtshalber angeben, falls die Prüfung das empfiehlt.

**Google – Datensicherheit**

- Erhobene Daten: Persönliche Daten → Name, E-Mail-Adresse, Nutzer-IDs; Fotos → Profilbild (optional); Nachrichten → Crew-Chat (In-App-Nachrichten); Weitere von Nutzern erstellte Inhalte → Abstimmungen, Pläne.
- Weitergabe an Dritte: **nein** (Hosting und Datenbank laufen als Auftragsverarbeitung bei Supabase und Vercel – vor dem Einreichen bestätigen, sobald das Hosting feststeht).
- Verschlüsselung bei der Übertragung: ja (HTTPS).
- Löschen: Konto und Daten lassen sich in der App löschen (Einstellungen → Konto löschen, serverseitig, sofort). Google verlangt zusätzlich eine Webadresse zum Löschen – offen, braucht Domain.

## Was vor dem Einreichen fehlt (Für Benito)

- Datenschutz-URL (öffentliche Datenschutzerklärung) und Support-URL – brauchen Hosting und Domain
- Bestätigung der Auftragsverarbeiter (Supabase-Region EU, Vercel)
- Rechtliche Prüfung dieser Angaben zusammen mit der Datenschutzerklärung

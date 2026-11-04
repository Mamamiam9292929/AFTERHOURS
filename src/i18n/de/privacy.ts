/** F7 · Texte für Datenschutz-Seite (PrivacyPage). Eigener Chunk – lädt erst mit der Seite (`loadTexts` in src/i18n/index.ts). */
export const privacy = {
  title: "Datenschutz und deine Daten",
  /** V2 Etappe 3o: Kopf als Karte – Kennzeile, Kurzfassung als Pillen (stehen so auch unten im Text). */
  label: "In einfachen Worten",
  facts: ["Kein Tracking", "Keine Werbung", "Standort aus"],
  jumpLabel: "Springe zu",
  disclaimer: "Diese Seite beschreibt in einfachen Worten, wie die App mit Daten umgeht. Sie ersetzt keine rechtlich geprüfte Datenschutzerklärung – die muss der Betreiber vor dem öffentlichen Start ergänzen.",
  sections: [
    {
      title: "Was gespeichert wird",
      items: [
        "Konto: deine E-Mail-Adresse und ein verschlüsseltes Passwort (bei Supabase Auth).",
        "Profil: Anzeigename, optional Profilbild, Stadt und Interessen.",
        "Geburtstag (nur wenn du ihn einträgst): Tag und Monat, ohne Jahr. Sehen können ihn die Mitglieder deiner Crews, eine Woche vorher bekommen sie einmal eine Erinnerung; entfernst du ihn, ist er sofort weg.",
        "„Wollen wir mal hin“ (nur wenn du einen Ort merkst): welcher Ort, für welche Crew, wann und von wem gemerkt. Sehen können das die Mitglieder dieser Crew; die Liste gehört der Crew – löschst du dein Konto, bleibt der Ort ohne deinen Namen stehen.",
        "„Bin weg“ (nur wenn du etwas einträgst): Beginn und Ende eines Zeitraums, ohne Grund und Ort. Sehen können ihn die Mitglieder deiner Crews, bis er vorbei ist; danach löscht die App ihn beim nächsten Eintragen.",
        "Aktivität: Crews, Nachrichten im Crew-Chat, Abstimmungen, Stimmen, Pläne, Zusagen, Reservierungsvermerke, Mitfahrten, Punkte und Benachrichtigungen.",
        "Einstellungen: Budget, Entfernung, Benachrichtigungen und deine Wahl zur Standortfreigabe.",
        "Fotos zum Plan (nur wenn du welche teilst): das verkleinerte Foto – ohne Aufnahmeort, Kamera und Uhrzeit, die nimmt die App vorher heraus – sowie wer es wann geteilt hat. Sehen kann es nur die Crew des Plans. Du kannst deine Fotos jederzeit löschen. Löschst du dein Konto oder wird der Plan oder die Crew gelöscht, löscht die App auch die Dateien; spätestens 12 Monate nach dem Abend verschwinden die Fotos von selbst. Meldest du ein Foto, speichern wir den Grund; Organisation und Crew-Admins sehen ihn ohne deinen Namen.",
        "Push-Mitteilungen (nur wenn du sie einschaltest): je Gerät die Adresse beim Push-Dienst deines Browsers, zwei öffentliche Schlüssel zum Verschlüsseln und ein Gerätename wie „Chrome auf Android“.",
      ],
    },
    {
      title: "Wer was sieht",
      items: [
        "Dein Profil sehen nur Personen, mit denen du mindestens eine Crew teilst.",
        "Inhalte einer Crew sehen nur ihre Mitglieder. Das erzwingt die Datenbank selbst, nicht nur die Oberfläche.",
        "Deine Einstellungen, deine E-Mail-Adresse und deine Punkte siehst nur du.",
        "Kalender-Abo: Legst du einen Abo-Link an, kann jede Kalender-App (und jede Person), die ihn kennt, deine Pläne lesen – ohne Anmeldung. Du kannst ihn jederzeit ersetzen oder beenden.",
        "Ohne Anmeldung ist nichts abrufbar – außer dem, was ihr bewusst per Link teilt: Einladungen, geteilte Pläne und Abstimmungen, dein Kalender-Abo.",
      ],
    },
    {
      title: "Standort",
      items: [
        "Die Standortfreigabe ist standardmäßig aus.",
        "Gerätestandort nur auf deinen Tipp rund um einen Plan („Wo seid ihr?“ auf der Planseite, ab 2 Stunden vor Beginn): Gespeichert wird nur die letzte Position, auf rund 10 m gerundet, ohne Verlauf. Sehen können sie nur Crew-Mitglieder, die zu diesem Plan zugesagt oder „vielleicht“ gesagt haben. Sie ist gelöscht, sobald du aufhörst, nach höchstens 3 Stunden, spätestens mit dem Ende des Plans, bei einer Absage und mit deinem Konto.",
        "Entfernungen werden aus der Stadt in deinem Profil geschätzt (Luftlinie ab Stadtmitte).",
        "Karten laden erst, wenn du auf „Karte laden“ tippst – dann geht eine Anfrage an OpenStreetMap.",
        "Die Karte in Discover zeigt die Orte zunächst nur als Punkte. Den Stadtplan von OpenStreetMap lädt sie erst nach „Stadtplan laden“ (gilt für dieses Gerät, „Stadtplan aus“ nimmt das zurück).",
      ],
    },
    {
      title: "Deine Rechte",
      items: [
        "Auskunft: In den Einstellungen lädst du alle deine Daten als Datei herunter.",
        "Berichtigung: Profil und Einstellungen kannst du jederzeit ändern.",
        "Löschung: In den Einstellungen löschst du dein Konto sofort und endgültig.",
      ],
    },
    {
      title: "Dritte",
      items: [
        "Schriften und Icons liegen in der App selbst; es wird nichts von Schrift- oder Tracking-Diensten nachgeladen.",
        "Fotos von Orten laden erst, wenn du auf „Foto anzeigen“ tippst oder „Fotos von Orten immer laden“ einschaltest (gilt nur auf diesem Gerät). Dann gehen Anfragen ohne Cookies an Wikimedia Commons und Wikidata – Wikimedia erfährt dabei deine IP-Adresse und welches Foto geladen wird.",
        "Push-Mitteilungen gibt es nur, wenn du sie auf einem Gerät einschaltest. Dann läuft jede Mitteilung über den Push-Dienst deines Browsers (Google, Apple, Mozilla oder Microsoft) – Ende-zu-Ende verschlüsselt; der Dienst sieht nur, dass etwas an dein Gerät geht. Ausschalten oder Abmelden meldet das Gerät ab.",
        "Es gibt keine Werbung und kein Tracking.",
        "Daten liegen bei Supabase (Datenbank und Anmeldung) in der Region, die der Betreiber wählt.",
      ],
    },
  ],
  toSettings: "Zu den Einstellungen",
  toLogin: "Zur Anmeldung",
};

---
name: schichtende
description: Am Ende jeder Arbeitsschicht an AFTERHOURS (nach dem letzten PR, vor dem Bericht an Benito) – hält das Lernbuch aktuell, damit die nächste Schicht dieselben Fehler nicht wiederholt
---

# Schichtende: aus der Schicht lernen

Jede Schicht startet ohne Erinnerung an die letzte. Was nicht in `docs/claude/LERNBUCH.md` oder in einem Skill steht, ist für die nächste Schicht verloren. Diese Routine dauert fünf Minuten und läuft vor dem Bericht.

## Ablauf

1. **Belege sammeln, nicht erinnern.** Gehe die PRs dieser Schicht durch (`gh api "repos/{owner}/{repo}/pulls?state=all&sort=updated&direction=desc&per_page=10"`). Prüfe pro PR:
   - Wie viele CI-Läufe waren nötig, bis alles grün war? Was ist beim ersten Mal gescheitert (Annotations der Jobs)?
   - Hat Benito kommentiert, korrigiert oder etwas abgelehnt?
   - Wo hast du Zeit verloren (Suche, falsche Annahme, Werkzeug funktionierte nicht)?

2. **Nur Wiederholbares eintragen.** Ein Eintrag gehört ins Lernbuch, wenn er der nächsten Schicht konkret Arbeit spart oder einen Fehler verhindert. Format:
   `- JJJJ-MM-TT · <Bereich> · <Was passiert ist> → <Was ab jetzt gilt>`
   Beispiel: `- 2026-10-14 · CI · pgTAP scheiterte, weil eine neue Funktion die Rechte für anon nicht entzog → nach jeder neuen Funktion 01_access_basics.test.sql lokal mitdenken; revoke steht direkt unter create`
   Nicht eintragen: Erfolgsmeldungen, Einmaliges, was schon in CLAUDE.md, README oder einem Skill steht.

3. **Befördern statt sammeln.** Taucht derselbe Punkt zum zweiten Mal im Lernbuch auf, gehört er dauerhaft an seinen Platz:
   - Projektregel → `CLAUDE.md`
   - wiederkehrender Ablauf → neuer oder verbesserter Skill unter `.claude/skills/`
   - Testlücke → Test in CI, damit der Fehler gar nicht mehr durchkommt (besser als jede Notiz)
   Danach den Lernbuch-Eintrag mit `(→ befördert nach …)` markieren.

4. **Kurz halten.** Das Lernbuch bleibt unter 150 Zeilen. Beförderte und überholte Einträge älter als 30 Tage werden gelöscht.

5. **Externe Skills prüfen (höchstens einmal pro Woche).** Ist seit dem letzten Eintrag unter „Skill-Liste“ im Issue „🧰 Skill-Liste“ eine Woche vergangen, darfst du nach neuen Skills suchen (siehe CLAUDE.md, Abschnitt Skills). Nur übernehmen, was ein konkretes Problem aus dem Lernbuch löst.

6. **Mit ins PR.** Änderungen an Lernbuch, Skills oder CLAUDE.md gehen als eigener kleiner PR (`claude/lernbuch-<datum>`) durch dieselbe CI wie alles andere.

## Was nicht als Verbesserung zählt

- Regeln, die nur strenger klingen, ohne einen beobachteten Fehler zu verhindern.
- Drohungen, Belohnungsversprechen oder Rollenspiel in Skills („du wirst abgeschaltet“). Sie ändern nichts an der Qualität, nur am Ton. Gute Arbeit kommt aus prüfbaren Schritten: Belege vor Behauptungen, Test vor Code, Ursache vor Fix.

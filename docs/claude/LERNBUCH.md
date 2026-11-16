# Lernbuch

Was Claude aus vergangenen Schichten gelernt hat. Gepflegt mit dem Skill `schichtende`. Jede Schicht liest diese Datei vor der Arbeit.

Format: `- JJJJ-MM-TT · Bereich · Was passiert ist → Was ab jetzt gilt`

## Einträge

- 2026-10-14 · GitHub · GraphQL ist in der Sitzung gesperrt; `gh pr list` scheitert → immer REST (`gh api repos/{owner}/{repo}/pulls?state=…`)
- 2026-10-14 · Git · Nach einem Squash-Merge meldet der Stop-Hook „unpushed commit“, weil die lokale Commit-ID nicht in `main` liegt → nach dem Merge lokal `git checkout -B main origin/main` und den Arbeitsbranch löschen
- 2026-10-14 · Abstimmung · Benito wollte, dass Fragen gesammelt statt einzeln gestellt werden → jede Frage ins Issue „❓ Frageliste“ (#42), mit Standard, der gilt, solange keine Antwort da ist (→ befördert nach CLAUDE.md)

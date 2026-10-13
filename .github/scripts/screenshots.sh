#!/usr/bin/env bash
# Legt die Screenshots der Browser-Journey auf einem eigenen Branch ab (Roadmap F4), damit sie ohne
# Artefakt-Download sichtbar sind – im PR verlinkbar und per `git fetch` abrufbar:
#
#   screenshots/main     Stand nach dem letzten Push auf main („vorher“)
#   screenshots/pr-<n>   Stand des Pull Requests <n> („nachher“)
#
# Jeder Lauf ersetzt den Branch durch genau einen Commit (kein Verlauf, kein Wachstum).
# Erwartet: TARGET (main | pr-<n>), GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA.
set -euo pipefail
dir=${E2E_SCREENSHOTS:-tests/e2e/screenshots}
case "${TARGET:-}" in
  main | pr-[0-9]*) ;;
  *) echo "::error title=Screenshots::ungültiges TARGET '${TARGET:-}'"; exit 1 ;;
esac
shopt -s nullglob
shots=("$dir"/*.png)
if [ ${#shots[@]} -eq 0 ]; then
  echo "Keine Screenshots in $dir – nichts abzulegen."
  exit 0
fi

branch="screenshots/$TARGET"
work=$(mktemp -d)
cp "${shots[@]}" "$work"/
cd "$work"
{
  echo "# Screenshots: $TARGET"
  echo
  echo "Browser-Journey zu Commit \`$GITHUB_SHA\` – automatisch erzeugt, wird bei jedem Lauf ersetzt."
  echo
  for f in *.png; do echo "- [$f]($f)"; done
} >README.md
git init -q -b "$branch"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add .
git commit -qm "Screenshots $TARGET ($GITHUB_SHA)"
git push -q -f "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "HEAD:refs/heads/$branch"
echo "✓ ${#shots[@]} Screenshots auf $branch"
echo "::notice title=Screenshots::${#shots[@]} Bilder auf Branch $branch – https://github.com/${GITHUB_REPOSITORY}/tree/$branch"

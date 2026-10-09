#!/usr/bin/env bash
# Regenerates the contributor avatars between the CONTRIBUTORS markers in
# README.md from GitHub's contributor list, leaving out bot accounts and the
# AI/automation accounts in EXCLUDE (which GitHub reports as regular users).
# Run by .github/workflows/contributors.yml; also safe to run locally.
set -euo pipefail

REPO="${REPO:-TimVanOnckelen/famlin}"
README="${README:-README.md}"
EXCLUDE="${EXCLUDE:-claude copilot}"

auth=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
  auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

contributors=$(curl -fsSL "${auth[@]}" "https://api.github.com/repos/${REPO}/contributors?per_page=100")

block=$(jq -r --arg exclude "$EXCLUDE" '
  ($exclude | ascii_downcase | split(" ")) as $skip
  | map(select(.type == "User" and ((.login | ascii_downcase) as $l | $skip | index($l) | not)))
  | map("<a href=\"\(.html_url)\"><img src=\"https://avatars.githubusercontent.com/u/\(.id)?v=4&s=64\" width=\"64\" height=\"64\" alt=\"\(.login)\" title=\"\(.login)\" /></a>")
  | join("\n")
' <<<"$contributors")

python3 - "$README" "$block" <<'PY'
import re, sys
path, block = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read()
pattern = re.compile(r"(<!-- CONTRIBUTORS:START -->).*?(<!-- CONTRIBUTORS:END -->)", re.S)
if not pattern.search(text):
    sys.exit(f"CONTRIBUTORS markers not found in {path}")
open(path, "w", encoding="utf-8").write(pattern.sub(lambda m: m.group(1) + "\n" + block + "\n" + m.group(2), text))
PY

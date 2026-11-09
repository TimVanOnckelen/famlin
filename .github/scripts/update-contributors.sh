#!/usr/bin/env bash
# Regenerates the contributor avatars between the CONTRIBUTORS markers in
# README.md from GitHub's contributor list plus the authors of merged pull
# requests, leaving out bot accounts and the AI/automation accounts in EXCLUDE
# (which GitHub reports as regular users). PR authors are needed because the
# contributor list only knows commits whose email is linked to a GitHub
# account; anyone else shows up there as an anonymous contributor.
# Run by .github/workflows/contributors.yml, which proposes the result as a
# pull request (main only accepts PRs); also safe to run locally.
set -euo pipefail

REPO="${REPO:-TimVanOnckelen/famlin}"
README="${README:-README.md}"
EXCLUDE="${EXCLUDE:-claude copilot}"

auth=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
  auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

contributors=$(curl -fsSL "${auth[@]}" "https://api.github.com/repos/${REPO}/contributors?per_page=100")

# Authors of merged pull requests, oldest first, one page at a time.
pr_authors=$(mktemp)
trap 'rm -f "$pr_authors"' EXIT
page=1
while :; do
  prs=$(curl -fsSL "${auth[@]}" \
    "https://api.github.com/repos/${REPO}/pulls?state=closed&sort=created&direction=asc&per_page=100&page=${page}")
  [ "$(jq 'length' <<<"$prs")" -eq 0 ] && break
  jq -c '.[] | select(.merged_at != null) | .user | {login, id, type, html_url}' <<<"$prs" >>"$pr_authors"
  page=$((page + 1))
done

# Commit contributors keep GitHub's order (most commits first); PR authors not
# already in that list follow, in the order of their first merged PR.
block=$(jq -r --arg exclude "$EXCLUDE" --slurpfile pr_authors "$pr_authors" '
  ($exclude | ascii_downcase | split(" ")) as $skip
  | (. + $pr_authors)
  | map(select(.type == "User" and ((.login | ascii_downcase) as $l | $skip | index($l) | not)))
  | reduce .[] as $u ([]; if any(.[]; .id == $u.id) then . else . + [$u] end)
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

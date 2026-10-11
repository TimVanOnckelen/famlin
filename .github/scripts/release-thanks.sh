#!/usr/bin/env bash
# Prints a "Thank you" markdown section crediting the people who took part in
# a release: commit and pull request authors, and the reporters of issues those
# pull requests closed. Leaves out bot accounts, the AI/automation accounts in
# EXCLUDE (which GitHub reports as regular users, like update-contributors.sh),
# and the repository owner. Prints nothing when nobody is left to thank.
#
# Usage: release-thanks.sh <previous-tag> <tag>
# Run by the release-assets job in .github/workflows/release-please.yml; also
# safe to run locally with an authenticated `gh`.
set -euo pipefail

PREV_TAG="$1"
TAG="$2"
REPO="${REPO:-${GITHUB_REPOSITORY:-TimVanOnckelen/famlin}}"
OWNER="${OWNER:-${REPO%%/*}}"
# `claude` is Claude Code (Co-Authored-By commits); `claude[bot]` and other
# GitHub App accounts are dropped as bots below.
EXCLUDE="${EXCLUDE:-claude copilot $OWNER}"

# One `login<TAB>type` line per person, kept only for real, non-excluded users.
keep_people() {
  jq -r --arg exclude "$EXCLUDE" '
    ($exclude | ascii_downcase | split(" ")) as $skip
    | select(.login != null and .type == "User"
        and (.login | endswith("[bot]") | not)
        and ((.login | ascii_downcase) as $l | $skip | index($l) | not))
    | .login'
}

commits=$(gh api --paginate "repos/$REPO/compare/$PREV_TAG...$TAG" \
  --jq '.commits[] | {login: .author.login, type: .author.type, message: .commit.message}' \
  | jq -s '.')

# Pull requests merged in this range, from squash ("title (#12)") and merge
# ("Merge pull request #12 from ...") commit subjects.
prs=$(jq -r '.[].message | split("\n")[0]
  | (capture("\\(#(?<n>[0-9]+)\\)$"), capture("^Merge pull request #(?<n>[0-9]+)")) | .n' \
  <<<"$commits" | sort -un)

# "login #12" lines: which PRs each person authored.
pr_refs=""
contributors=$(jq -c '.[] | {login, type}' <<<"$commits" | keep_people)
reporters=""

for pr in $prs; do
  data=$(gh api graphql -F owner="${REPO%%/*}" -F name="${REPO##*/}" -F number="$pr" -f query='
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          author { login __typename }
          closingIssuesReferences(first: 20) { nodes { author { login __typename } } }
        }
      }
    }' --jq '.data.repository.pullRequest' 2>/dev/null || true)
  [ -n "$data" ] && [ "$data" != "null" ] || continue

  author=$(jq -c '.author // empty | {login, type: .__typename}' <<<"$data" | keep_people)
  if [ -n "$author" ]; then
    contributors+=$'\n'"$author"
    pr_refs+=$'\n'"$author #$pr"
  fi
  reporters+=$'\n'$(jq -c '.closingIssuesReferences.nodes[].author // empty | {login, type: .__typename}' <<<"$data" | keep_people)
done

contributors=$(sed '/^$/d' <<<"$contributors" | sort -fu)
# Someone who both reported and fixed is thanked once, as a contributor.
reporters=$(sed '/^$/d' <<<"$reporters" | sort -fu | grep -vixF -f <(printf '%s\n' "$contributors" "") || true)

[ -n "$contributors$reporters" ] || exit 0

# A contributor is new when they have no commit before the previous release.
prev_date=$(gh api "repos/$REPO/commits/$PREV_TAG" --jq '.commit.committer.date')

echo "## 💙 Thank you"
echo
if [ -n "$contributors" ]; then
  echo "This release was made better by contributions from:"
  echo
  while IFS= read -r login; do
    line="- @$login"
    refs=$(awk -v l="$login" '$1 == l { print $2 }' <<<"$pr_refs" | sort -u -t'#' -k2n | paste -sd' ' - | sed 's/ /, /g')
    [ -z "$refs" ] || line+=" ($refs)"
    earlier=$(gh api "repos/$REPO/commits?author=$login&until=$prev_date&per_page=1" --jq 'length' 2>/dev/null || echo 1)
    [ "$earlier" != "0" ] || line+=" — first contribution 🎉"
    echo "$line"
  done <<<"$contributors"
  echo
fi
if [ -n "$reporters" ]; then
  echo "And thanks for reporting the issues fixed in this release: $(sed 's/^/@/' <<<"$reporters" | paste -sd' ' - | sed 's/ /, /g')"
  echo
fi
echo "Every report, idea and pull request helps — thank you for being part of Famlin."

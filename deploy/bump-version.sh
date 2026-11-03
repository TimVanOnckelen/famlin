#!/usr/bin/env bash
# Usage: deploy/bump-version.sh <version>   e.g. deploy/bump-version.sh 0.9.0
# Points every staged store manifest at a Famlin release. Run it after the
# release's Docker image is published (the tags must exist before users update).
set -euo pipefail

version="${1:?usage: bump-version.sh <version> (e.g. 0.9.0)}"
version="${version#v}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "error: '$version' is not a semantic version" >&2
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
image='ghcr.io/timvanonckelen/famlin'

# Image tags in compose files (an optional @sha256 digest is dropped: it
# belonged to the old tag and must be re-added for the new one).
sed -i -E "s#(image: ${image}):[0-9][^@[:space:]]*(@sha256:[0-9a-f]+)?#\1:${version}#" \
  "$root/umbrel/famlin-famlin/docker-compose.yml" \
  "$root/casaos/famlin/docker-compose.yml"

# Umbrel app version.
sed -i -E "s#^version: .*#version: \"${version}\"#" "$root/umbrel/famlin-famlin/umbrel-app.yml"

echo "Updated deploy/ manifests to ${version}."
echo "Remember to re-add image digests (see the READMEs) before publishing to the stores."
echo "The Home Assistant add-on lives in TimVanOnckelen/famlin-ha-addon: run its \"Bump version\" workflow."

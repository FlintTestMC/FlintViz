#!/usr/bin/env bash
set -euo pipefail

MC_VERSION="${MC_VERSION:-26.1.2}"
VERSION_MANIFEST_URL="https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_PATH="$SCRIPT_DIR/../public/mc-assets.zip"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing dependency: $1"
    exit 1
  }
}

require curl
require jq
require unzip
require zip
require sha1sum
require zipinfo

progress_bar() {
  local current=$1
  local total=$2
  local width=40

  if (( total == 0 )); then
    total=1
  fi

  local percent=$(( current * 100 / total ))
  local filled=$(( current * width / total ))
  local empty=$(( width - filled ))

  printf "\r["
  printf "%0.s#" $(seq 1 "$filled")
  printf "%0.s-" $(seq 1 "$empty")
  printf "] %3d%% (%d/%d)" "$percent" "$current" "$total"
}

echo "Fetching manifest…"

MANIFEST_JSON="$TMP_DIR/manifest.json"
curl -# -L "$VERSION_MANIFEST_URL" -o "$MANIFEST_JSON"

ENTRY_URL=$(jq -r --arg ver "$MC_VERSION" \
  '.versions[] | select(.id==$ver) | .url' \
  "$MANIFEST_JSON")

if [[ -z "$ENTRY_URL" || "$ENTRY_URL" == "null" ]]; then
  echo "Version $MC_VERSION not found"
  exit 1
fi

echo "Fetching version doc for $MC_VERSION…"

VERSION_JSON="$TMP_DIR/version.json"
curl -# -L "$ENTRY_URL" -o "$VERSION_JSON"

CLIENT_URL=$(jq -r '.downloads.client.url' "$VERSION_JSON")
EXPECTED_SHA1=$(jq -r '.downloads.client.sha1' "$VERSION_JSON")
SIZE=$(jq -r '.downloads.client.size' "$VERSION_JSON")

echo "Downloading client.jar ($(awk "BEGIN {printf \"%.1f\", $SIZE/1024/1024}") MB)…"

JAR_PATH="$TMP_DIR/client.jar"
curl -# -L "$CLIENT_URL" -o "$JAR_PATH"

echo "Verifying SHA1…"

ACTUAL_SHA1=$(sha1sum "$JAR_PATH" | awk '{print $1}')

if [[ "$ACTUAL_SHA1" != "$EXPECTED_SHA1" ]]; then
  echo "SHA1 mismatch"
  echo "Expected: $EXPECTED_SHA1"
  echo "Actual:   $ACTUAL_SHA1"
  exit 1
fi

echo "Extracting client.jar…"

UNZIP_DIR="$TMP_DIR/unzipped"
mkdir -p "$UNZIP_DIR"

unzip -q "$JAR_PATH" -d "$UNZIP_DIR"

echo "Finding matching assets…"

mapfile -t FILES < <(
  find "$UNZIP_DIR/assets/minecraft" -type f \
    \( \
      -path "*/blockstates/*" -o \
      -path "*/models/*" -o \
      -path "*/textures/block/*" -o \
      -path "*/textures/item/*" \
    \)
)

TOTAL_FILES="${#FILES[@]}"

KEEP_DIR="$TMP_DIR/keep"
mkdir -p "$KEEP_DIR"

echo "Copying assets…"

CURRENT=0

for file in "${FILES[@]}"; do
  rel="${file#$UNZIP_DIR/}"

  mkdir -p "$KEEP_DIR/$(dirname "$rel")"
  cp "$file" "$KEEP_DIR/$rel"

  ((CURRENT+=1))

  progress_bar "$CURRENT" "$TOTAL_FILES"
done

echo

TOTAL_ALL=$(find "$UNZIP_DIR" -type f | wc -l)
SKIPPED=$((TOTAL_ALL - TOTAL_FILES))

echo "Kept $TOTAL_FILES files, skipped $SKIPPED."

mkdir -p "$(dirname "$OUT_PATH")"

echo "Creating zip…"

(
  cd "$KEEP_DIR"

  mapfile -t ZIP_FILES < <(find . -type f)

  TOTAL_ZIP="${#ZIP_FILES[@]}"
  CURRENT_ZIP=0

  rm -f "$OUT_PATH"

  for file in "${ZIP_FILES[@]}"; do
    zip -q "$OUT_PATH" "$file"

    ((CURRENT_ZIP+=1))

    progress_bar "$CURRENT_ZIP" "$TOTAL_ZIP"
  done
)

echo

SIZE_MB=$(du -m "$OUT_PATH" | cut -f1)

echo
echo "Done."
echo "Wrote $OUT_PATH (${SIZE_MB} MB)."
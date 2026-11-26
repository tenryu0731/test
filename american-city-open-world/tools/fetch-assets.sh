#!/usr/bin/env bash
# 取得テストで使った 3 系統の素材を、配布元から取り直すスクリプト。
# 使い方: american-city-open-world/ をカレントにして  bash tools/fetch-assets.sh
# 生のアーカイブは assets/raw/（.gitignore 対象）に置き、使うファイルだけ assets/vendor/ に展開する。
set -euo pipefail
RAW=assets/raw
VENDOR=assets/vendor
UA="Mozilla/5.0"
mkdir -p "$RAW" "$VENDOR"

# --- Kenney (CC0) -----------------------------------------------------------
# kenney.nl は署名付きリンク方式。アセットページ取得 → /download-link/<id> を Referer 付きで叩く → zip。
fetch_kenney() {
  local slug="$1" jar page id url
  jar=$(mktemp); page=$(mktemp)
  curl -fsS -c "$jar" -b "$jar" -A "$UA" "https://kenney.nl/assets/$slug" -o "$page"
  id=$(grep -oE "data-download-id='[0-9a-f]+'" "$page" | head -1 | cut -d"'" -f2)
  url=$(curl -fsS -c "$jar" -b "$jar" -A "$UA" -H "Referer: https://kenney.nl/assets/$slug" \
        "https://kenney.nl/download-link/$id" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["url"])')
  curl -fsS -L -c "$jar" -b "$jar" -A "$UA" -H "Referer: https://kenney.nl/assets/$slug" "$url" -o "$RAW/kenney-$slug.zip"
  rm -f "$jar" "$page"
  unzip -tq "$RAW/kenney-$slug.zip"
  rm -rf "$RAW/kenney-$slug" && unzip -q "$RAW/kenney-$slug.zip" -d "$RAW/kenney-$slug"
  rm -rf "$VENDOR/kenney-$slug" && mkdir -p "$VENDOR/kenney-$slug"
  cp -r "$RAW/kenney-$slug/Models/GLB format/." "$VENDOR/kenney-$slug/"
  cp "$RAW/kenney-$slug/License.txt" "$VENDOR/kenney-$slug/"
  sha256sum "$RAW/kenney-$slug.zip"
}
fetch_kenney city-kit-roads
fetch_kenney city-kit-commercial

# --- KayKit City Builder Bits (CC0, GitHub) ----------------------------------
rm -rf "$RAW/kaykit-city-builder-bits"
git clone -q --depth 1 https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0 "$RAW/kaykit-city-builder-bits"
git -C "$RAW/kaykit-city-builder-bits" rev-parse HEAD
A="$RAW/kaykit-city-builder-bits/addons/kaykit_city_builder_bits/Assets"
rm -rf "$VENDOR/kaykit-city-builder-bits" && mkdir -p "$VENDOR/kaykit-city-builder-bits/gltf"
cp "$A"/gltf/* "$VENDOR/kaykit-city-builder-bits/gltf/"
cp -r "$A/texture" "$VENDOR/kaykit-city-builder-bits/"
cp "$RAW/kaykit-city-builder-bits/LICENSE.txt" "$RAW/kaykit-city-builder-bits/README.md" "$VENDOR/kaykit-city-builder-bits/"

# --- Poly Haven (CC0, 公開 API, MD5 照合) ------------------------------------
fetch_polyhaven() {
  local asset="$1" res="${2:-1k}"
  mkdir -p "$VENDOR/polyhaven/$asset"
  curl -fsS "https://api.polyhaven.com/files/$asset" | python3 -I -c '
import json,sys
d=json.load(sys.stdin)["gltf"][sys.argv[1]]["gltf"]
print(d["url"], d["url"].rsplit("/",1)[1], d["md5"])
for k,v in d["include"].items(): print(v["url"], k, v["md5"])
' "$res" | while read -r url rel md5; do
    out="$VENDOR/polyhaven/$asset/$rel"; mkdir -p "$(dirname "$out")"
    curl -fsS "$url" -o "$out"
    got=$(md5sum "$out" | cut -d' ' -f1)
    if [ "$got" = "$md5" ]; then echo "MD5 OK  $out"; else echo "MD5 NG  $out" >&2; exit 1; fi
  done
}
fetch_polyhaven modular_urban_apartments_facade 1k
fetch_polyhaven street_lamp_01 1k

echo "done"

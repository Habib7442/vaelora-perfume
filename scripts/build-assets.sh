#!/usr/bin/env bash
# VAELORA asset pipeline
# - Extracts WebP frame sequences from the hero / notes videos (desktop + mobile)
# - Converts product, lifestyle and gallery PNGs to WebP at 800w and 400w
# - Prints folder sizes and automatically lowers quality if a sequence is over budget
#
# Usage:  bash scripts/build-assets.sh            (from the project root)
# Needs:  ffmpeg built with libwebp (ffmpeg -encoders | grep libwebp)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---- Source locations (edit these if you move the raw files) ----------------
SRC_VIDEO_HERO="${SRC_VIDEO_HERO:-public/hero_sequence_video}"
SRC_VIDEO_NOTES="${SRC_VIDEO_NOTES:-public/notes_sequence_video}"
SRC_PRODUCTS="${SRC_PRODUCTS:-public/signature_collections public/ultimate_collections}"
SRC_LIFESTYLE="${SRC_LIFESTYLE:-public/model_shots}"
SRC_GALLERY="${SRC_GALLERY:-public/footer_gallery_strip}"

OUT="assets"
IMG_Q=80                # quality for product / lifestyle / gallery images
DESKTOP_BUDGET_KB=6144  # 6 MB per desktop sequence
MOBILE_BUDGET_KB=3072   # 3 MB per mobile sequence

# The source videos carry a small sparkle watermark bottom-right; delogo paints it out.
# Coordinates are in source-video pixels (1920x1080 landscape, 1080x1920 portrait).
DELOGO_D="delogo=x=1690:y=850:w=100:h=100"
DELOGO_M="delogo=x=850:y=1688:w=100:h=100"
# Lift the video's grey background (≈ #DEE2E3) to the page --bg (#E9ECEB) so frames blend in.
LEVELS="colorlevels=rimax=0.952:gimax=0.958:bimax=0.966"

command -v ffmpeg >/dev/null || { echo "ffmpeg not found on PATH" >&2; exit 1; }
ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libwebp || { echo "ffmpeg lacks libwebp" >&2; exit 1; }

kb() { du -sk "$1" 2>/dev/null | cut -f1; }
human() { awk -v k="$1" 'BEGIN{ if (k>=1024) printf "%.2f MB", k/1024; else printf "%d KB", k }'; }

# Size/quality ladders, best first. Lowering quality alone barely moves the needle on
# detailed frames (q70 → q35 only saves ~25%), so the ladder steps resolution down too.
# The last rung is the floor: below it the frames look visibly soft, so we accept being
# over budget rather than ship mush.  Format: "<scale filter>|<quality>"
LADDER_D=("scale=1920:-2|70" "scale=1920:-2|60" "scale=1600:-2|60" "scale=1440:-2|55" "scale=1280:-2|55" "scale=1280:-2|50")
# Hero on desktop/tablet uses the PORTRAIT source: the landscape hero video crops the
# bottle's cap in its first and last seconds, while the portrait one keeps the whole
# bottle in frame. The page contain-fits it beside the "VAE" / "LORA" word groups.
LADDER_P=("scale=-2:1200|60" "scale=-2:1080|60" "scale=-2:1080|50" "scale=-2:960|55" "scale=-2:960|50")
LADDER_M=("scale=-2:1080|70" "scale=-2:1080|60" "scale=-2:960|60" "scale=-2:854|55" "scale=-2:854|50" "scale=-2:720|55" "scale=-2:720|50")

TMP="$(mktemp -d 2>/dev/null || echo "$OUT/.tmp-sample")"
trap 'rm -rf "$TMP"' EXIT

# fps that yields exactly <frames> frames from the video's duration
fps_for() {
  local dur; dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1")
  awk -v f="$2" -v d="$dur" 'BEGIN{ printf "%.4f", f / d }'
}

# Estimate the full-sequence size of a rung by encoding every 8th frame.
estimate_kb() {
  local video="$1" vf="$2" q="$3" frames="$4"
  rm -rf "$TMP/s"; mkdir -p "$TMP/s"
  ffmpeg -v error -y -i "$video" -vf "${vf},select='not(mod(n\,8))'" -fps_mode vfr \
    -c:v libwebp -quality "$q" -compression_level 4 "$TMP/s/%04d.webp"
  local n; n=$(ls "$TMP/s" | wc -l | tr -d ' ')
  (( n > 0 )) || { echo 0; return; }
  echo $(( $(kb "$TMP/s") * frames / n ))
}

# extract_seq <video> <outdir> <frames> <delogo> <budgetKB> <ladder name>
extract_seq() {
  local video="$1" out="$2" frames="$3" delogo="$4" budget="$5"
  local -n ladder="$6"
  if [[ ! -f "$video" ]]; then
    echo "  ! missing $video, skipping (the page will draw a placeholder)"
    return
  fi
  local fps; fps=$(fps_for "$video" "$frames")
  local base="${delogo},${LEVELS},fps=${fps}"

  # 1) pick the best rung whose estimate fits (cheap: ~1/8 of the frames)
  local pick=$(( ${#ladder[@]} - 1 )) i
  for i in "${!ladder[@]}"; do
    local scale="${ladder[$i]%|*}" q="${ladder[$i]#*|}"
    local est; est=$(estimate_kb "$video" "${base},${scale}:flags=lanczos" "$q" "$frames")
    echo "  estimate ${scale#scale=} q=${q}: $(human "$est")"
    if (( est <= budget * 97 / 100 )); then pick=$i; break; fi
  done

  # 2) full encode; if the real size still overshoots, drop one more rung
  while :; do
    local scale="${ladder[$pick]%|*}" q="${ladder[$pick]#*|}"
    rm -rf "$out"; mkdir -p "$out"
    ffmpeg -v error -y -i "$video" -vf "${base},${scale}:flags=lanczos" \
      -frames:v "$frames" -c:v libwebp -quality "$q" -compression_level 6 -preset photo \
      "$out/%04d.webp"
    local size; size=$(kb "$out")
    local count; count=$(ls "$out" | wc -l | tr -d ' ')
    echo "  -> $out  ${count} frames  ${scale#scale=}  q=${q}  $(human "$size")"
    if (( size <= budget )); then break; fi
    if (( pick >= ${#ladder[@]} - 1 )); then
      echo "  ! over budget ($(human "$budget")) at the quality floor; keeping this rung"
      break
    fi
    pick=$(( pick + 1 ))
  done
}

slugify() {
  basename "$1" .png | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g'
}

# Bounding box of the visible pixels (alpha > ~10%) as an ffmpeg crop string, e.g. 296:384:52:58.
# alphaextract turns transparency into black, which cropdetect then trims away (like sharp's .trim()).
# skip=0: cropdetect ignores the first 2 frames by default, and a PNG has only one.
alpha_bbox() {
  ffmpeg -hide_banner -i "$1" -vf "alphaextract,format=gray,cropdetect=limit=0.1:round=2:reset=0:skip=0" -f null - 2>&1     | grep -o 'crop=[0-9:]*' | tail -1 | cut -d= -f2
}

# convert_images <outdir> <trim|plain> <src dirs...>
#   trim : products — crop to the bottle, then fit inside 800×1000 / 400×500 (so every bottle
#          can be laid out by height without hidden padding). Prints the real sizes for srcset.
#   plain: photos  — 800w / 400w.
convert_images() {
  local out="$1" mode="$2"; shift 2
  mkdir -p "$out"
  local found=0
  for dir in "$@"; do
    [[ -d "$dir" ]] || { echo "  ! missing folder $dir"; continue; }
    for f in "$dir"/*.png; do
      [[ -f "$f" ]] || continue
      found=1
      local slug; slug=$(slugify "$f")
      local crop=""
      if [[ "$mode" == trim ]]; then
        crop=$(alpha_bbox "$f")
        [[ -n "$crop" ]] && crop="crop=${crop},"
      fi
      local sizes=""
      for w in 800 400; do
        local scale="scale=${w}:-2:flags=lanczos"
        [[ "$mode" == trim ]] && scale="scale=${w}:$((w * 5 / 4)):force_original_aspect_ratio=decrease:flags=lanczos"
        # yuva420p keeps the alpha channel for transparent bottles (harmless on opaque photos)
        ffmpeg -v error -y -i "$f" -vf "${crop}${scale},format=yuva420p"           -c:v libwebp -quality "$IMG_Q" -compression_level 6 "$out/${slug}-${w}.webp"
        sizes+=" $(ffprobe -v error -show_entries stream=width,height -of csv=p=0:s=x "$out/${slug}-${w}.webp")"
      done
      echo "  $slug ${crop:+(trimmed ${crop%,})}$sizes"
    done
  done
  (( found )) || echo "  ! no PNGs found, placeholders will be used"
}

ONLY="${ONLY:-all}"    # all | seq | hero-d | hero-m | notes-d | notes-m | img | products | lifestyle | gallery
want() { [[ "$ONLY" == all || "$ONLY" == seq || "$ONLY" == "$1" ]]; }
if [[ "$ONLY" == all || "$ONLY" == seq || "$ONLY" == hero-* || "$ONLY" == notes-* ]]; then
  echo "== Sequences"
  want hero-d  && extract_seq "$SRC_VIDEO_HERO/hero-mobile.mp4"    "$OUT/seq/hero-d"  150 "$DELOGO_M" $DESKTOP_BUDGET_KB LADDER_P
  want hero-m  && extract_seq "$SRC_VIDEO_HERO/hero-mobile.mp4"    "$OUT/seq/hero-m"   90 "$DELOGO_M" $MOBILE_BUDGET_KB  LADDER_M
  want notes-d && extract_seq "$SRC_VIDEO_NOTES/notes-desktop.mp4" "$OUT/seq/notes-d" 150 "$DELOGO_D" $DESKTOP_BUDGET_KB LADDER_D
  want notes-m && extract_seq "$SRC_VIDEO_NOTES/notes-mobile.mp4"  "$OUT/seq/notes-m"  90 "$DELOGO_M" $MOBILE_BUDGET_KB  LADDER_M
fi

pick() { [[ "$ONLY" == all || "$ONLY" == img || "$ONLY" == "$1" ]]; }   # img | products | lifestyle | gallery
if pick products; then
  echo "== Products"
  # shellcheck disable=SC2086
  convert_images "$OUT/img/products" trim $SRC_PRODUCTS
fi
if pick lifestyle; then
  echo "== Lifestyle"
  convert_images "$OUT/img/lifestyle" plain "$SRC_LIFESTYLE"
fi
if pick gallery; then
  echo "== Gallery"
  convert_images "$OUT/img/gallery" plain "$SRC_GALLERY"
fi

echo
echo "== Sizes"
for d in "$OUT"/seq/* "$OUT"/img/*; do
  [[ -d "$d" ]] && printf "  %-24s %s\n" "$d" "$(human "$(kb "$d")")"
done

#!/bin/bash
# Fully automatic: a photo -> a 3D-photo lockscreen scene. No human intervention.
# Usage: scripts/make_scene.sh <photo.png> <scene_name>
set -e
PHOTO="$1"; NAME="$2"
ROOT="/Users/shin/Desktop/lockscreen"
PY="/private/tmp/image-clean-venv/bin/python"
SCENE="$ROOT/assets/scenes/$NAME"
mkdir -p "$SCENE"

echo "[1/4] resize -> 864x1536 (9:16)"
$PY -c "from PIL import Image; Image.open('$PHOTO').convert('RGB').resize((864,1536), Image.LANCZOS).save('$SCENE/plate_clean.png')"

echo "[2/4] depth (Depth Anything V2 Large, fp16 — sharp edges, accurate midground)"
( cd /tmp/depthtool && LOCAL_MODEL_DIR=/tmp/depthtool/models MODEL_NAME=depth-anything-v2-large DTYPE=fp16 \
    node depth.mjs "$SCENE/plate_clean.png" "$SCENE/depth.png" 1536 >/dev/null 2>&1 )

echo "[3/4] auto subject mask (rembg / U2Net)"
$PY "$ROOT/scripts/auto_subject_rembg.py" "$SCENE/plate_clean.png" "$SCENE/subject_mask.png"

echo "[4/4] build 3D-photo (cliff cut + LaMa back layer)"
SCENE_PLATE="$SCENE/plate_clean.png" SCENE_DEPTH="$SCENE/depth.png" \
  SCENE_CAT="$SCENE/subject_mask.png" SCENE_OUT="$ROOT/assets/photo3d_$NAME" \
  $PY "$ROOT/scripts/build_3dphoto.py" >/dev/null 2>&1

echo "done -> open ?scene=$NAME"

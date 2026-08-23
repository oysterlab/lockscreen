#!/bin/zsh

set -euo pipefail

round_number=${1:-}
if [[ ! "$round_number" =~ ^(1|2|3)$ ]]; then
  print -u2 "Usage: zsh measure_background_ssim.sh <1|2|3>"
  exit 2
fi

script_dir=${0:A:h}
workspace_dir=${script_dir:h:h:h:h:h:h}
round_label=$(printf '%02d' "$round_number")
background_path="$workspace_dir/service/validation_roadmap/phase_a_product_truth/a1_signature_world/assets/base/SM-S001_base_1080x1920.png"
output_dir="$script_dir/outputs/round-$round_label"

if [[ ! -f "$background_path" || ! -d "$output_dir" ]]; then
  print -u2 "Missing background or round output directory"
  exit 1
fi

print "test_id,background_top_ssim"
for output_path in "$output_dir"/*.png(N); do
  test_id=${output_path:t:r}
  metric=$(ffmpeg -hide_banner -loglevel info \
    -i "$background_path" -i "$output_path" \
    -lavfi "[1:v]scale=1080:1920[o];[0:v]crop=1080:900:0:0[a];[o]crop=1080:900:0:0[b];[a][b]ssim" \
    -f null - 2>&1 | rg -o 'All:[0-9.]+' | tail -n 1 | cut -d: -f2)
  print "$test_id,$metric"
done


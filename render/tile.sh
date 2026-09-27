#!/bin/bash
# usage: tile.sh video.mp4 start_sec step_sec out.jpg  -> 4x4 grid of 16 frames
v=$1; s=$2; st=$3; out=$4
ffmpeg -loglevel error -y -ss $s -i "$v" -vf "fps=1/$st,scale=480:270,tile=4x4" -frames:v 1 -q:v 3 "$out"

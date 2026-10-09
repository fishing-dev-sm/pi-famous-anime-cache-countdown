#!/usr/bin/env bash
# record_gifs.sh — 在 Xvfb 虚拟屏里用真实 Alacritty（当前配置）播放场景并录成 GIF
# 用法: ./record_gifs.sh [scene ...]   默认全部场景
set -u
cd "$(dirname "$0")"

DISP=:99
SCREEN=900x320x24
SCENES=("$@")
[ ${#SCENES[@]} -eq 0 ] && SCENES=(deepseek-12h five-phases standby-wake expire-dissolve)

Xvfb $DISP -screen 0 $SCREEN 2>/dev/null &
XVFB_PID=$!
sleep 1
trap 'kill $XVFB_PID 2>/dev/null' EXIT

mkdir -p docs
for scene in "${SCENES[@]}"; do
	mp4="/tmp/rec_$scene.mp4"
	# ffmpeg 录屏（30fps）
	DISPLAY=$DISP ffmpeg -y -loglevel error -f x11grab -draw_mouse 0 -framerate 30 -video_size ${SCREEN%x*} -i $DISP -c:v libx264 -preset ultrafast -crf 18 "$mp4" &
	FF_PID=$!
	sleep 1
	# 真 Alacritty 播放（沿用当前配置，仅覆盖：不透明、尺寸、关闭 decorations）
	DISPLAY=$DISP LIBGL_ALWAYS_SOFTWARE=1 alacritty \
		-o window.opacity=1 -o window.decorations=\"None\" \
		-o window.dimensions.columns=86 -o window.dimensions.lines=9 \
		-e node "$PWD/player.mjs" "$scene" >/dev/null 2>&1
	sleep 0.5
	kill $FF_PID 2>/dev/null; wait $FF_PID 2>/dev/null
	sleep 0.3
	if [ ! -s "$mp4" ]; then echo "docs/$scene.gif  SKIP（录屏文件缺失）"; continue; fi

	# 统一固定裁剪 = Alacritty 窗口尺寸（86 列 x 9 行 @ size 10 → 860x216）
	crop="crop=860:216:0:0"
	# blackdetect 去头尾黑段（窗口启动/关闭期）
	eval $(ffmpeg -i "$mp4" -vf blackdetect=d=0.08:pix_th=0.10 -f null - 2>&1 | grep blackdetect | \
		awk '{for(i=1;i<=NF;i++){if($i~/^black_start:/)bs[++n]=substr($i,13); if($i~/^black_end:/)be[++m]=substr($i,11)}} END{d=(n>1?bs[n]-be[1]:0); printf "SS=%s; DUR=%s", be[1]+0, d}')
	TRIM=(-ss "${SS:-0}"); awk "BEGIN{exit !(${DUR:-0} > 0)}" && TRIM+=(-t "$DUR")
	ffmpeg -y -loglevel error "${TRIM[@]}" -i "$mp4" -vf "$crop,fps=15,palettegen=max_colors=256" /tmp/pal_$scene.png
	ffmpeg -y -loglevel error "${TRIM[@]}" -i "$mp4" -i /tmp/pal_$scene.png -lavfi "$crop,fps=15 [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3" "docs/$scene.gif"
	echo "docs/$scene.gif  $(du -h docs/$scene.gif | cut -f1)  ($crop trim=${SS}s+${DUR}s)"
done

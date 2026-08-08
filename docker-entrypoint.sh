#!/bin/sh
# 설정이 생길 때까지 기다렸다가 시작한다.
#
# 설치 마법사는 메일함 컨테이너가 띄운다 (그쪽이 3000 번으로 사람이 처음 닿는
# 곳이다). 여기서는 그 결과만 기다린다. 없는 채로 뜨면 인증도 주소도 없는
# 상태로 잠깐 열리게 되는데, 그 사이에 누가 들어오면 곤란하다.
set -e

CONFIG_DIR="${BENTO_CONFIG_DIR:-/config}"
CONFIG="$CONFIG_DIR/memobento.env"
DONE="$CONFIG_DIR/setup.json"

waited=0
while [ ! -f "$DONE" ] || [ ! -f "$CONFIG" ]; do
  if [ "$waited" -eq 0 ]; then
    echo "[memobento] 설정을 기다립니다 — 메일함 쪽(3000 번)의 설치 마법사에서 진행하세요."
  fi
  waited=$((waited + 3))
  # 오래 기다리면 한 번씩 다시 알린다. 로그만 보고 있는 사람에게 멈춘 것처럼
  # 보이지 않게.
  if [ $((waited % 60)) -eq 0 ]; then
    echo "[memobento] 아직 설정이 없습니다 (${waited}초째)."
  fi
  sleep 3
done

set -a
# shellcheck disable=SC1090
. "$CONFIG"
set +a

echo "[memobento] 설정을 읽었습니다. 앱을 시작합니다."
exec node server.js

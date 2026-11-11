#!/usr/bin/env bash
# Mooncoda 磁吸孔桥接 —— 一键启动本机 Blender(macOS / Linux)
#
# 桥接只开在 http://127.0.0.1:8765(本机回环)—— 模型不出这台电脑。
# 用法:把便携版 Blender 解压出来,让 start_blender.sh 和 blender_bridge.py
#       跟 blender 在同一个文件夹里,然后跑这个脚本。

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

find_blender() {
  local candidates=(
    "$DIR/blender"
    "$DIR/blender/blender"
    "$DIR/blender.app/Contents/MacOS/Blender"
    "/Applications/Blender.app/Contents/MacOS/Blender"
    "/usr/bin/blender"
    "/usr/local/bin/blender"
    "$HOME/blender/blender"
    "$HOME/blender.app/Contents/MacOS/Blender"
  )
  # 便携版解压出来的目录名不固定(blender-5.2.0-linux-x64 之类)—— 全扫一遍
  for pattern in "$DIR"/blender*/blender "$DIR"/blender*/blender.app/Contents/MacOS/Blender \
    "$HOME"/blender*/blender "$HOME"/blender*/blender.app/Contents/MacOS/Blender; do
    [ -x "$pattern" ] && candidates+=("$pattern")
  done
  for candidate in "${candidates[@]}"; do
    if [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

find_bridge() {
  local candidates=(
    "$DIR/blender_bridge.py"
    "$DIR/../blender_bridge.py"
    "$HOME/Downloads/blender_bridge.py"
    "$HOME/Desktop/blender_bridge.py"
  )
  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

BLENDER="$(find_blender || true)"
BRIDGE="$(find_bridge || true)"

echo
echo "  [Mooncoda] 磁吸孔桥接 —— 一键启动本机 Blender"
echo "  --------------------------------------------------"
echo

if [ -z "$BLENDER" ]; then
  echo "  [Mooncoda] 没找到 blender 可执行文件"
  echo
  echo "  把便携版 Blender 解压出来,把这几个文件"
  echo "  (start_blender.sh / blender_bridge.py / blender)"
  echo "  一起放进解压出来的文件夹,然后再跑本脚本。"
  echo
  echo "  便携版下载: https://www.blender.org/download/"
  echo
  exit 1
fi

if [ -z "$BRIDGE" ]; then
  echo "  [Mooncoda] 没找到 blender_bridge.py"
  echo
  echo "  把 start_blender.sh 和 blender_bridge.py 放在同一个文件夹里,"
  echo "  或者把 blender_bridge.py 放到「下载」文件夹。"
  echo
  exit 1
fi

echo "  Blender:   $BLENDER"
echo "  桥接脚本:  $BRIDGE"
echo
echo "  桥接只开在 http://127.0.0.1:8765(本机回环,模型不出这台电脑)。"
echo
echo "  这个终端就是桥接 —— 别关。切完回网页点「检测」。"
echo "  用完了按 Ctrl+C(或直接关掉这个窗口)就停。"
echo

# ---- 清掉旧字节码缓存 ----
# Python 校验 .pyc 只看「秒级 mtime + 字节数」⇒ 脚本改过之后有可能
# 拿**旧代码**跑(用户自己改了插件就会遇到)。启动前清一次最稳。
BRIDGE_DIR="$(cd "$(dirname "$BRIDGE")" && pwd)"
rm -rf "$BRIDGE_DIR/__pycache__" 2>/dev/null || true

# ---- 命令执行,不打开 GUI ----
# --background:没有界面,纯后台跑。
# ⚠️ --background 跑完 --python 脚本 Blender 就退出了,事件循环压根不存在
#    ⇒ bpy.app.timers 永远不触发 ⇒ 作业堆在队列里干等到超时。
#    桥接脚本在后台模式下改成**自己阻塞**(主线程泵),所以它不会返回。
# --factory-startup:不加载用户的启动项和插件(用户装了个坏插件也不该
#    把桥接带崩)。
exec "$BLENDER" --background --factory-startup --python "$BRIDGE"

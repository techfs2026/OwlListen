#!/usr/bin/env bash
#
# macOS 完整打包脚本
#
# 背景：本项目通过 ffmpeg-next 动态链接 Homebrew 的 ffmpeg，而 ffmpeg 又
# 递归依赖 x264/x265/opus/openssl 等一大堆 dylib。`tauri build` 默认不会把
# 这些库打进 .app，导致只有装了 Homebrew ffmpeg 的机器能跑。
#
# 本脚本在 tauri build 之后，用 dylibbundler 递归把所有非系统 dylib 复制进
# OwlListen.app/Contents/Frameworks 并改写全部 install_name，然后重新生成 dmg。
#
# 依赖：brew install dylibbundler
#
# 用法：bash scripts/bundle-mac.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

APP_DIR="src-tauri/target/release/bundle/macos"
APP="$APP_DIR/OwlListen.app"
BIN="$APP/Contents/MacOS/owllisten"
DMG_DIR="src-tauri/target/release/bundle/dmg"
VERSION="$(grep -m1 '"version"' src-tauri/tauri.conf.json | sed -E 's/.*"version": *"([^"]+)".*/\1/')"
ARCH="$(uname -m)"   # arm64 -> 命名沿用 tauri 的 aarch64
[ "$ARCH" = "arm64" ] && DMG_ARCH="aarch64" || DMG_ARCH="$ARCH"

command -v dylibbundler >/dev/null || { echo "缺少 dylibbundler，请先： brew install dylibbundler"; exit 1; }

echo "==> 1/4 tauri build"
# 强制重新嵌入前端：generate_context!() 在 src/lib.rs 里于编译期把 dist/ 嵌进
# 二进制。Cargo 增量编译只看源码 mtime，dist 变了但 lib.rs 没变时不会重跑该宏，
# 导致二进制里残留上一次的旧前端（打包出来是旧版）。touch 一下强制重编重嵌。
touch src-tauri/src/lib.rs
# 删掉上一次的 bundle 产物：否则 tauri 可能复用残留的旧 .app，不会用新编出的
# 二进制覆盖它（表现为 cargo 产物已是新版、但 .app 仍是旧版）。
rm -rf "$APP" "$DMG_DIR"
npm run tauri build

echo "==> 2/4 用 dylibbundler 打包并修复动态库"
dylibbundler -of -cd -b \
  -x "$BIN" \
  -d "$APP/Contents/Frameworks/" \
  -p "@executable_path/../Frameworks/"

echo "==> 3/4 校验依赖闭包（确认无 homebrew 残留）"
if otool -L "$BIN" "$APP"/Contents/Frameworks/*.dylib | grep -q "homebrew"; then
  echo "❌ 仍有 homebrew 残留引用，打包不完整"; exit 1
fi
codesign --force --deep --sign - "$APP"
codesign --verify --deep "$APP" && echo "签名校验通过"

echo "==> 4/4 重新生成 dmg（tauri 生成的 dmg 基于修复前的 app，已过时）"
mkdir -p "$DMG_DIR"
OUT_DMG="$DMG_DIR/OwlListen_${VERSION}_${DMG_ARCH}.dmg"
rm -f "$OUT_DMG"
STAGING="$(mktemp -d)"
cp -R "$APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname "OwlListen" -srcfolder "$STAGING" -ov -format UDZO "$OUT_DMG"
rm -rf "$STAGING"

echo ""
echo "✅ 完成：$OUT_DMG"
echo "   app 体积： $(du -sh "$APP" | cut -f1)"

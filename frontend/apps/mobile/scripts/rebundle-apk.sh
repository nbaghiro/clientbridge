#!/usr/bin/env bash
# Swaps a fresh Hermes bundle into a cached release APK whose native build is unchanged, then re-signs it.
set -euo pipefail

cached=$(realpath "$1")
out=$(realpath -m "$2")
work=$(mktemp -d)
cd "$(dirname "$0")/.."

npx expo export:embed --platform android --dev false --minify false --reset-cache \
    --entry-file index.ts --bundle-output "$work/index.js" --assets-dest "$work/res"
mkdir -p "$work/assets"
../../node_modules/hermes-compiler/hermesc/linux64-bin/hermesc -w -emit-binary -O \
    -out "$work/assets/index.android.bundle" "$work/index.js"

cp "$cached" "$work/app.apk"
cd "$work"
zip -q -d app.apk 'META-INF/*.SF' 'META-INF/*.RSA' 'META-INF/*.MF' || true
zip -q -0 app.apk assets/index.android.bundle

tools=$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 | sort -V | tail -1)
"$tools/zipalign" -p -f 4 app.apk aligned.apk
keytool -genkeypair -keystore ci.keystore -storepass android -keypass android -alias ci \
    -keyalg RSA -dname "CN=Clientbridge CI" -validity 2 -noprompt 2>/dev/null
"$tools/apksigner" sign --ks ci.keystore --ks-pass pass:android --out "$out" aligned.apk

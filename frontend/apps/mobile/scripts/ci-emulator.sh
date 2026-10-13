#!/usr/bin/env bash
# The CI Android emulator, pinned: `key` names the cache, `install` fetches it once, `start` boots it.
set -euo pipefail

EMULATOR_BUILD=16428233
EMULATOR_SHA256=b08fc43d8608d2955f607f1b287beb525041e730086bdca3af152accac3af9c1
IMAGE="system-images;android-34;google_apis;x86_64"
IMAGE_REVISION=14
AVD=ci
# bump when the settings saved into the quick-boot snapshot change
SNAPSHOT=2
if [ "$1" = key ]; then
    echo "android-34-google_apis-x86_64-r$IMAGE_REVISION-emulator-$EMULATOR_BUILD-snapshot-$SNAPSHOT"
    exit 0
fi
sdk="$ANDROID_HOME"
tools="$sdk/cmdline-tools/latest/bin"
# avdmanager and the emulator otherwise look in different places
export ANDROID_AVD_HOME="$HOME/.android/avd"
mkdir -p "$ANDROID_AVD_HOME"

boot() {
    "$sdk/emulator/emulator" -avd "$AVD" -no-window -gpu swiftshader_indirect -noaudio -no-boot-anim \
        -camera-back none "$@" > /tmp/emulator.log 2>&1 &
    local emulator=$! waited=0
    until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do
        if ! kill -0 "$emulator" 2>/dev/null || [ "$waited" -ge 300 ]; then
            cat /tmp/emulator.log
            echo "the emulator did not boot" >&2
            exit 1
        fi
        sleep 2
        waited=$((waited + 2))
    done
    # a launcher that stops responding after a snapshot resume is killed instead of covering the app with a dialog
    adb shell settings put global hide_error_dialogs 1
}

case "$1" in
install)
    (yes || true) | "$tools/sdkmanager" --licenses > /dev/null
    for wait in 10 30 0; do
        "$tools/sdkmanager" --install "$IMAGE" > /dev/null && break
        [ "$wait" = 0 ] && exit 1
        sleep "$wait"
    done
    revision=$(sed -n 's/^Pkg.Revision=//p' "$sdk/system-images/android-34/google_apis/x86_64/source.properties")
    if [ "${revision%%.*}" != "$IMAGE_REVISION" ]; then
        echo "system image revision $revision is not the pinned $IMAGE_REVISION; update IMAGE_REVISION" >&2
        exit 1
    fi
    echo no | "$tools/avdmanager" create avd --force -n "$AVD" -k "$IMAGE"
    # the image pulls in the latest emulator, which avdmanager needs; the pinned build replaces it
    rm -rf "$sdk/emulator"
    curl -fsSL --retry 5 --retry-all-errors -o /tmp/emulator.zip \
        "https://dl.google.com/android/repository/emulator-linux_x64-$EMULATOR_BUILD.zip"
    echo "$EMULATOR_SHA256  /tmp/emulator.zip" | sha256sum -c -
    unzip -q /tmp/emulator.zip -d "$sdk"
    # boot once and quit, so later runs resume from the saved quick-boot snapshot
    boot
    adb emu kill
    while pgrep -f "emulator.*-avd $AVD" > /dev/null; do sleep 1; done
    ;;
start)
    boot -no-snapshot-save
    for setting in window_animation_scale transition_animation_scale animator_duration_scale; do
        adb shell settings put global "$setting" 0
    done
    # unlock the screen and keep it awake, as android-emulator-runner did
    adb shell input keyevent 82
    adb shell svc power stayon true
    ;;
*)
    echo "usage: $0 key|install|start" >&2
    exit 2
    ;;
esac

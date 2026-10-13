#!/usr/bin/env bash
# The CI Android emulator from a pinned build: `install` fetches it once for the cache, `start` boots it.
set -euo pipefail

EMULATOR_BUILD=16428233
IMAGE="system-images;android-34;google_apis;x86_64"
AVD=ci
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
}

case "$1" in
install)
    (yes || true) | "$tools/sdkmanager" --licenses > /dev/null
    "$tools/sdkmanager" --install "$IMAGE" > /dev/null
    echo no | "$tools/avdmanager" create avd --force -n "$AVD" -k "$IMAGE"
    # the image pulls in the latest emulator, which avdmanager needs; the pinned build replaces it
    rm -rf "$sdk/emulator"
    curl -fsSL --retry 5 --retry-all-errors -o /tmp/emulator.zip \
        "https://dl.google.com/android/repository/emulator-linux_x64-$EMULATOR_BUILD.zip"
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
    ;;
*)
    echo "usage: $0 install|start" >&2
    exit 2
    ;;
esac

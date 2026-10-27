#!/usr/bin/env bash
# A release build of the e2e app (its own app id, so a developer's build and data stay put) for the native lane.
set -euo pipefail

platform=$1
mkdir -p "$(dirname "$2")"
out="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
cd "$(dirname "$0")/.."
: "${APP_ID:?}" "${API_URL:?}" "${AUTH_URL:?}" "${POWERSYNC_URL:?}"
export APP_NAME="Clientbridge E2E" E2E_CLEARTEXT=1 CI=1

pnpm exec expo prebuild --clean --platform "$platform"
case "$platform" in
ios)
    # kept beside the build, so a rebuild compiles only what changed
    derived="$out.derived"
    xcodebuild -workspace ios/ClientbridgeE2E.xcworkspace -scheme ClientbridgeE2E -configuration Release \
        -sdk iphonesimulator -destination "generic/platform=iOS Simulator" -derivedDataPath "$derived" \
        build > "$out.log"
    rm -rf "$out"
    cp -R "$derived/Build/Products/Release-iphonesimulator/ClientbridgeE2E.app" "$out"
    ;;
android)
    abi=$(uname -m | sed 's/^arm64$/arm64-v8a/')
    # the template's 512 MB Metaspace runs out compiling the app's Kotlin, as in CI
    jvm="-Xmx4g -XX:MaxMetaspaceSize=1g"
    perl -pi -e "s/^org\.gradle\.jvmargs=.*/org.gradle.jvmargs=$jvm/" android/gradle.properties
    echo "kotlin.daemon.jvmargs=$jvm" >> android/gradle.properties
    (cd android && ./gradlew assembleRelease -PreactNativeArchitectures="$abi" > "$out.log")
    cp android/app/build/outputs/apk/release/app-release.apk "$out"
    ;;
*)
    echo "usage: $0 ios|android <output>" >&2
    exit 2
    ;;
esac

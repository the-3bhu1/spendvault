#!/usr/bin/env bash
#
# Release build, start to finish. This is step 5 of .claude/commands/generate-release-apk.md, run
# inside the container from Dockerfile.android so it behaves the same on any machine.
#
# Run it via:  docker compose run --rm spendvault-apk
# Configuration and keystore setup: docs/RELEASE.md
set -euo pipefail

cd /app

echo "==> 1/4  Installing dependencies"
# npm ci needs the lockfile to match package.json exactly; fall back rather than fail the build.
if [ -f package-lock.json ]; then
  npm ci || npm install
else
  npm install
fi

echo "==> 2/4  Building web bundle (tsc -b && vite build)"
npm run build

echo "==> 3/4  Syncing the web build into the Android project"
npx cap sync android

if [ -z "${SV_KEYSTORE_FILE:-}" ] && [ ! -f android/key.properties ]; then
  echo
  echo "!!  No signing key configured — this APK will be UNSIGNED and cannot be installed over an"
  echo "!!  existing SpendVault install. Mount your keystore and set SV_KEYSTORE_*; see docs/RELEASE.md."
  echo
elif [ -n "${SV_KEYSTORE_FILE:-}" ] && [ ! -f "${SV_KEYSTORE_FILE}" ]; then
  echo "ERROR: SV_KEYSTORE_FILE is set to '${SV_KEYSTORE_FILE}' but no file is there." >&2
  echo "       Check that SV_KEYSTORE_DIR points at the folder holding your .jks." >&2
  exit 1
fi

echo "==> 4/4  Assembling release APK"
# --no-daemon: the container is thrown away after each run, so a lingering daemon only wastes memory.
( cd android && ./gradlew assembleRelease --no-daemon )

out="android/app/build/outputs/apk/release"
if [ -f "$out/app-release.apk" ]; then
  apk="$out/app-release.apk"
  state="signed"
elif [ -f "$out/app-release-unsigned.apk" ]; then
  apk="$out/app-release-unsigned.apk"
  state="UNSIGNED — will not install over an existing build"
else
  echo "ERROR: gradle reported success but produced no APK in $out" >&2
  exit 1
fi

echo
echo "==> Done — $state"
ls -lh "$apk"
echo "    On the host: ./$apk"

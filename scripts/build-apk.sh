#!/usr/bin/env bash
#
# Release build inside the Dockerfile.android container — step 5 of
# .claude/commands/generate-release-apk.md on the Docker route.
#
# Start it with `npm run release:apk -- --docker` (scripts/release-apk.mjs). That mounts this
# machine's signing folder at /root/.spendvault, where android/app/build.gradle looks for it, and
# names the output. Gradle refuses to build if the key is missing or is not the SpendVault release
# key, so a signed APK at the end is the only way this script succeeds. See docs/RELEASE.md.
set -euo pipefail

cd /app
built="android/app/build/outputs/apk/release/app-release.apk"
name="${SV_APK_NAME:-app-release.apk}"

echo "==> 1/4  Installing dependencies (npm ci)"
# Never `npm install`: it can rewrite package-lock.json, and this checkout is the host's own.
npm ci --no-audit --no-fund

echo "==> 2/4  Building web bundle (tsc -b && vite build)"
npm run build

echo "==> 3/4  Syncing the web build into the Android project"
npx cap sync android

echo "==> 4/4  Assembling release APK"
rm -f "$built"
# `sh ./gradlew`, not `./gradlew`: a checkout made on Windows may not carry the executable bit through
# the mount. --no-daemon: the container is thrown away after each run.
#
# Sized for Docker Desktop's default VM (4 GB on a Mac, emulating amd64 on Apple silicon). Left to its
# defaults Gradle ran a separate Kotlin compiler JVM beside its own and one worker per CPU, and the
# kernel killed it mid-compile ("Gradle build daemon disappeared unexpectedly"). Kotlin compiles inside
# Gradle's JVM instead, two workers at a time, and file watching — pointless in a throwaway container,
# and erroring through the bind mount — is off.
( cd android && sh ./gradlew assembleRelease --no-daemon --no-watch-fs --max-workers=2 \
    -Pkotlin.compiler.execution.strategy=in-process )

# android/app/build is a Docker volume (see docker-compose.yml), invisible to the host — copy the APK
# out to release/, which is part of the bind-mounted checkout.
mkdir -p release
cp "$built" "release/$name"
echo
echo "==> Done — release/$name"
ls -lh "release/$name"

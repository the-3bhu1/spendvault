# Releasing SpendVault

How to produce a signed release APK, and why the signing key matters more here than in most apps.

The end-to-end release process (backup-codec audit → Ask Vault doc → tour audit → push → build) is
`.claude/commands/generate-release-apk.md`. This document covers the build machinery that step 5
depends on.

---

## 1. The keystore is the single point of failure

**Back it up before doing anything else in this document.**

Android refuses to install an APK signed with a different key over an existing install —
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`. The only way past it is to uninstall first.

Uninstalling clears the WebView's `localStorage`, and `localStorage` is where **all** SpendVault data
lives (`minimalist_finance_data_v1`, see `src/FinanceContext.tsx`). There is no server copy and no
account to sign back into.

So if the keystore is lost:

- every future version means uninstall → reinstall → import a backup JSON, and
- anything logged since the last export is gone.

It is deliberately not in git (`.gitignore`: `android/key.properties`, `*.jks`, `*.keystore`), which
means by default it exists on exactly one machine. Copy it somewhere durable — a password manager
entry, an encrypted vault, or a private repo. **Never generate a replacement for an app already
installed anywhere.**

You need two things:

| Thing | What it is |
| --- | --- |
| `*.jks` | the keystore itself |
| alias + store password + key password | the three secrets that open it |

---

## 2. Building on a machine with Android Studio

Requires: JDK 17+, the Android SDK (platform 35, build-tools 35.0.0), and `ANDROID_HOME` set or
`android/local.properties` containing `sdk.dir=...`.

Create `android/key.properties` (gitignored):

```properties
storeFile=/absolute/path/to/spendvault.jks
storePassword=...
keyAlias=...
keyPassword=...
```

Then:

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

---

## 3. Building on any machine, with Docker

This is the portable route — no local JDK, no Android SDK, no `local.properties`. The toolchain lives
in `Dockerfile.android`; only the keystore comes from the machine.

Put your `.jks` in a folder outside the repo, then create a `.env` beside `docker-compose.yml`:

```dotenv
# Host folder holding your .jks — mounted read-only at /keys
SV_KEYSTORE_DIR=/home/you/secure/spendvault-keys

# Path INSIDE the container, so it begins with /keys
SV_KEYSTORE_FILE=/keys/spendvault.jks
SV_KEYSTORE_PASSWORD=...
SV_KEY_ALIAS=...
SV_KEY_PASSWORD=...
```

Then, from a fresh clone:

```bash
docker compose run --rm spendvault-apk
```

That runs `scripts/build-apk.sh`: install deps → `npm run build` → `npx cap sync android` →
`./gradlew assembleRelease`, and prints the APK path and size. Because the repo is bind-mounted, the
APK appears on the host at `android/app/build/outputs/apk/release/app-release.apk`.

First run pulls the base image and the SDK, and Gradle downloads its dependencies — expect a long
one. Later runs reuse the `gradle-cache` volume and are much quicker.

`.env` is read by Docker Compose automatically and is gitignored. The secrets reach Gradle as
environment variables and are never written into the working tree — that is why
`android/app/build.gradle` accepts `SV_KEYSTORE_*` as an alternative to `key.properties`. Writing a
`key.properties` into a bind-mounted repo would leave credentials and container-only paths on the
host after the build.

---

## 4. Unsigned builds are loud now, not silent

With neither `android/key.properties` nor `SV_KEYSTORE_FILE` present, the release build still
succeeds — Gradle just skips signing and writes `app-release-unsigned.apk`. That file cannot upgrade
an installed app.

It used to happen without a word. `android/app/build.gradle` now prints a warning block, and
`scripts/build-apk.sh` says so before building and again in its summary, reporting the APK as
`UNSIGNED` rather than as a release.

---

## 5. Known rough edges

**Capacitor CLI is a major version behind.** `package.json` pins `@capacitor/cli` at `^7.6.0` while
`@capacitor/core` and `@capacitor/android` are both `8.2.0`. `npx cap sync` may warn or misbehave.
The fix is `npm i -D @capacitor/cli@^8` — worth doing on a run where you can verify the sync output.

**npm registry inside the container.** A container has no `~/.npmrc`, so `npm ci` there resolves
against the public registry rather than the CodeArtifact proxy this project's host setup uses. That
makes container builds independent of a CodeArtifact token — and also routes dependency installs
around the org proxy. If that is not acceptable, mount an `.npmrc` with a valid token into
`/root/.npmrc` in the `spendvault-apk` service.

**Version numbers are not bumped automatically.** `versionCode`/`versionName` in
`android/app/build.gradle` and `APP_VERSION` in `src/utils.ts` are left alone by both routes. Bump
them deliberately.

# Releasing SpendVault

How to produce a signed release APK (or a Play Store App Bundle) from any machine — macOS or Windows — and why the signing key
matters more here than in most apps.

The end-to-end release process (backup-codec audit → Ask Vault doc → tour audit → push → build) is
`.claude/commands/generate-release-apk.md`. This document covers the build machinery its last step
uses, and the one-time setup each machine needs.

```text
npm run release:doctor            what this machine can build with, and what is missing
npm run release:setup -- ...      one-time setup per machine (signing folder, git hooks)
npm run release:apk               build a signed APK into release/  (-- --local | -- --docker)
npm run release:aab               the same, as the App Bundle Google Play takes
npm run brand[:rbi|:vault]        which logo is in place / switch it (see below)
```

**Logo.** Test APKs are currently built with the original e₹ Digital Rupee mark (`npm run brand:rbi`).
That mark is the Reserve Bank of India's and must never reach Google Play, so `release:aab` refuses
to build unless the vault dial is in place. Before Play testing: `npm run brand:vault`, then commit.
`scripts/brand.mjs` explains how the swap works.

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

You need two things, and both belong in a **password manager** (the `.jks` as a file attachment, the
rest as fields) — that one entry is both the backup and how the key reaches a new machine:

| Thing | What it is |
| --- | --- |
| `spendvault-release-key.jks` | the keystore itself |
| alias + keystore password + key password | the secrets that open it (alias: `spendvault`) |

**Never** commit it, email it, paste it into chat, or sync it through an unencrypted cloud folder.
**Never generate a replacement** for an app already installed anywhere — the build refuses to use one
anyway (§4).

---

## 2. One-time setup on each machine

Everything machine-specific lives in **your home folder**, never in the repo:

| | macOS | Windows |
| --- | --- | --- |
| Signing folder (keystore + `signing.properties`) | `~/.spendvault/` | `%USERPROFILE%\.spendvault\` |
| JDK pin for Gradle (local route only) | `~/.gradle/gradle.properties` | `%USERPROFILE%\.gradle\gradle.properties` |
| Android SDK path (local route only) | `android/local.properties` (gitignored) | same |

### 2.1 Prerequisites

- **Git** (on Windows: Git for Windows) and **Node 22+**, then `npm ci` in the repo.
- Then **either** route:
  - **Docker route** — Docker Desktop, nothing else. On Windows use the WSL 2 backend. On an
    Apple-silicon Mac, turn on *Settings → General → Use Rosetta for x86_64/amd64 emulation*: the
    builder is an amd64 image (Google ships the `aapt2` build tool for x86-64 Linux only).
  - **Local route** — **JDK 21** and the Android SDK (platform 36, build-tools 36.0.0; installing
    Android Studio provides both).

### 2.2 Signing

Copy the `.jks` from your password manager to anywhere on the machine (Downloads is fine), then, in
an interactive terminal (Terminal on macOS; PowerShell or Windows Terminal on Windows — **not** Git
Bash's mintty, which hides the terminal from Node):

```bash
npm run release:setup -- --keystore ~/Downloads/spendvault-release-key.jks
```

It copies the keystore into the signing folder, asks for the alias and the two passwords (input
hidden), writes `signing.properties` next to it, restricts both to your user, checks with `keytool`
that the password opens it **and that it is the SpendVault release key**, and installs the repo's
pre-commit guard (§5). Delete the copy in Downloads afterwards.

A machine still set up the old way (`android/key.properties` in the checkout) migrates with
`npm run release:setup -- --from-key-properties`; then delete `android/key.properties` and any `.jks`
inside the repo folder.

`signing.properties` looks like this — `storeFile` is relative to the folder, which is what lets the
same file work on the host and inside the Docker builder:

```properties
storeFile=spendvault-release-key.jks
keyAlias=spendvault
storePassword=<keystore password>
keyPassword=<key password>
```

### 2.3 Local route only: point Gradle at JDK 21

If `java -version` (or `JAVA_HOME`) already says 21, skip this. Otherwise pin it **per user** — never
in `android/gradle.properties`, which is committed and shared by every machine:

```properties
# ~/.gradle/gradle.properties   (Windows: %USERPROFILE%\.gradle\gradle.properties)
org.gradle.java.home=<path to the JDK 21 home>
```

On Windows write the path with forward slashes (`C:/Program Files/...`): a `.properties` file reads a
backslash as an escape. If the SDK is not in its default place (`~/Library/Android/sdk`,
`%LOCALAPPDATA%\Android\Sdk`) and `ANDROID_HOME` is unset, Android Studio writes
`android/local.properties` with `sdk.dir=` on first open — it is gitignored.

### 2.4 Check

```bash
npm run release:doctor
```

Every line should read `[ok]`, and at least one route `READY`.

---

## 3. Building

```bash
npm run release:apk              # local toolchain if ready, otherwise Docker
npm run release:apk -- --docker  # force a route
npm run release:apk -- --local
npm run release:aab              # an App Bundle (.aab) for Google Play, same routes and checks
```

Both routes run the same steps — `npm run build` (tsc -b && vite build) → `npx cap sync android` →
`gradlew assembleRelease` — and finish by printing the APK's path, size and SHA-256:

```text
release/SpendVault-v2.1.0-99dd07c.apk
```

The name carries `APP_VERSION` and the commit, so builds from different machines are easy to tell
apart. A `-dirty` suffix means uncommitted changes went into it — fine for testing, not for a release.
`release/` is gitignored.

**Docker route.** `docker-compose.yml`'s `spendvault-apk` service mounts the checkout at `/app` and
this machine's signing folder, read-only, at `/root/.spendvault` — exactly where
`android/app/build.gradle` looks, so no secret is passed as an environment variable or written into
the checkout. Gradle's state and the Android build directories live in Docker volumes rather than in
your checkout, so a container build and an Android Studio build of the same checkout never trip over
each other's paths. (The one exception, `android/capacitor-cordova-android-plugins/`, is deleted and
regenerated by `cap sync` on every build anyway.) The first run builds a multi-GB image and downloads Gradle's dependencies (tens
of minutes); later runs reuse the volumes and take a few minutes. Run the service through
`release:apk`, which fills in the mount for your platform; started by hand it builds nothing.

---

## 4. What the build checks

`android/app/build.gradle` reads signing from the first of: `SV_KEYSTORE_*` environment variables
(CI), `<home>/.spendvault/signing.properties`, or a legacy `android/key.properties`. Before it
packages a release it then:

- **refuses an unsigned release** — no signing configured is a build error now, not a silent
  `app-release-unsigned.apk` (`-Psv.allowUnsigned=true` opts out, for an APK that cannot upgrade an
  install);
- **opens the keystore** and fails with a clear message on a wrong keystore password, a missing
  alias, or a wrong key password;
- **compares the certificate's SHA-256** against SpendVault's (`RELEASE_CERT_SHA256` in
  `build.gradle`, `b3d34d28…09460b4` — public, it is inside every APK) and fails on any other key.

So a build that finishes produced an APK that updates an installed SpendVault.

---

## 5. Keeping machines from polluting the repo

Two operating systems working on one set of branches can quietly fight over line endings, leak
one machine's paths into shared files, and leave each other's build state around. What prevents it:

- **`.gitattributes`** stores all text with LF whatever each machine's `core.autocrlf` says, keeps
  shell scripts and Docker files LF on Windows (a CRLF shebang breaks them), and batch files CRLF.
- **`.gitignore` / `android/.gitignore`** cover secrets, `local.properties`, build output,
  `release/`, `.kotlin/`, and both OSes' clutter (`.DS_Store`, `Thumbs.db`, `desktop.ini`).
- **`.dockerignore`** keeps secrets out of `./Dockerfile`'s `COPY . .` — without it, building the dev
  container baked the keystore and its passwords into the image.
- **The pre-commit guard** (`.githooks/pre-commit` → `scripts/guard-commit.mjs`), switched on per
  clone by `release:setup`, rejects a commit that adds a keystore, a signing password, `.env`,
  `local.properties`, an APK, a backup JSON, OS clutter, `org.gradle.java.home`/`sdk.dir` in a config
  file, or an absolute home path (`/Users/<name>/…`, `C:\Users\<name>\…`). A genuine false positive:
  `git commit --no-verify`.
- **Per-machine settings live in the home folder** (§2), and the Docker builder's state lives in
  Docker volumes (§3).

---

## 6. Troubleshooting

- **`bad CPU type in executable` / `spawnSync git Unknown system error -86`** (Apple-silicon Mac) —
  an Intel-only leftover from an old `/usr/local` Homebrew sits early on `PATH` and Rosetta is not
  installed. zsh silently falls through to the next copy, Node does not; the release scripts work
  around it, but other tools won't. Remove the leftover (e.g. `/usr/local/bin/git`) or install Rosetta.
- **`... is NOT the SpendVault release key`** — the keystore on this machine is a different one. Get
  the real `.jks` from the password manager and re-run `release:setup -- --keystore <file> --force`.
- **`No release signing configured`** — run `release:doctor`; usually `release:setup` was never run on
  this machine, or (Docker) the service was started without `release:apk`.
- **Docker: `aapt2 ... Daemon startup failed`** — the builder ran as arm64; it must be `linux/amd64`
  (set in `docker-compose.yml`) with Rosetta emulation on (Apple silicon).
- **Odd Gradle errors after switching between Android Studio and the Docker route** — shouldn't happen
  any more (§3), but `android/.gradle` and `android/**/build` on the host can always be deleted, and
  `docker volume ls | grep apk-` lists the builder's volumes (`docker compose down -v` drops them).

---

## 7. Known rough edges

**Capacitor CLI is a major version behind.** `package.json` pins `@capacitor/cli` at `^7.6.0` while
`@capacitor/core` and `@capacitor/android` are both `8.2.0`. `npx cap sync` currently works, but
`npm i -D @capacitor/cli@^8` is worth doing on a run where you can verify the sync output.

**Version numbers come from `APP_VERSION` alone.** `android/app/build.gradle` reads `APP_VERSION` from
`src/utils.ts`: `versionName` is it without the `v`, and `versionCode` packs it as
MAJOR·10000 + MINOR·100 + PATCH (`v2.1.0` → 20100). Nothing bumps it for you — but bumping it is the
whole job, and it must go up for every Play upload: Play rejects a versionCode it has seen, and
Android won't install over a higher one. Minor and patch stay under 100.

---

## 8. Google Play

Upload the `.aab` from `npm run release:aab`. Play doesn't accept APKs for new apps.

**Play App Signing — use the existing key.** On the first upload Play asks who holds the app signing
key. Choose to **upload your own** (Play Console walks through exporting it from the `.jks` with its
PEPK tool) rather than letting Google generate one. Play re-signs every download with the app signing
key; if that isn't this key (`b3d34d28…`), the Play build can't update a phone that already has a
sideloaded SpendVault, and that update means uninstalling first, which wipes the user's data.
The `.jks` then stays the upload key as well.

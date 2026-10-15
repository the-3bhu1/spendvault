---
description: Generate a signed release APK — audit export/backup logic for drift, refresh the Ask Vault knowledge doc with new features, push+merge to build-ver-2.1, then build the APK without bumping the version.
---

You are generating a release APK for SpendVault (a Capacitor Android app). Follow these steps
IN ORDER — don't jump to the build step before the first two are actually done.

## 1. Check whether the export/backup logic needs updating from recent bug fixes

The backup/export format is centralized in `src/services/backupCodec.ts` (`KEY_MAP`,
`minifyPayload`, `expandPayload`) and consumed by `src/components/Settings.tsx` (export, plus
the separate "ultra-compressed" clipboard path) and `src/components/OnboardingScreen.tsx`
(first-run import). `KEY_MAP` is rename-only, not an allowlist — an unmapped field still
round-trips under its full name, so nothing is silently dropped — but any field added, removed,
or renamed on the core data models (`Transaction`, `Account`, `User`, `Debt`, `RecurringBill`,
`SplitEvent`, etc. in `src/types.ts`) during recent work should get a short code so backups stay
compact and consistent.

- Look at what actually changed recently (`git log`/`git diff` since the last release build, or
  over the commits covering "the bug fixes we've done") for edits to `src/types.ts` and any new/
  renamed field on the core models.
- Cross-check each changed field against `KEY_MAP` in `src/services/backupCodec.ts` — flag
  anything missing a short code.
- Separately check the ultra-compressed clipboard path in `Settings.tsx` (search for
  `SV_ULTRA_` / `expandId` — currently around line 1080+): it hand-maintains its own list of
  ID-reference fields to remap (`t.id`, `t.accountId`, `t.linkedTransactionIds`,
  `a.cashbackDestinationAccountId`, `d.transactions[].linkedTxId`, etc.). If a recent fix added a
  new linked-transaction-style ID field, this list needs the same addition — it's a second,
  hand-maintained list separate from `KEY_MAP` and easy to forget.
- If you find a real gap, fix it (add the short code / remap entry) and run `npx tsc -b` to
  confirm it still compiles before moving on. If nothing needs updating, say so briefly — don't
  invent changes just to have something to report.

## 2. Refresh the Ask Vault knowledge doc with any new feature knowledge

The in-app "Ask Vault" assistant answers grounded ONLY from its knowledge doc — the `APP_KNOWLEDGE`
string in `src/knowledge/appKnowledge.ts` — plus the dynamic context assembled by
`src/services/buildVaultContext.ts`. Any user-facing feature, screen, flow, or queryable field added
since the last release must be reflected here, or the assistant returns an out-of-scope fallback (or,
for data it genuinely can't see, an honest "I can't find that") instead of a real answer.

- Review what changed recently (`git log`/`git diff` since the last release build) for NEW
  user-facing features/screens/flows/fields — new Settings toggles, new tabs, new log/entry flows,
  new data on transactions/accounts, etc.
- For each, check BOTH layers:
  - **`appKnowledge.ts`** — does the doc DESCRIBE the feature so "how do I…" / "what is…" questions
    can be answered? Add a concise entry if not.
  - **`buildVaultContext.ts`** — if the feature adds data the user would ask numbers about (e.g.
    tags, a new category/account type, a new balance), does the summary/slice actually SURFACE that
    data? Add it if not — documenting a feature whose data the context never emits still yields
    "I can't see that in your data." (Example: tag-based answers needed a by-tag summary, `#tag`
    query detection, tags on the transaction rows, and a pre-computed filtered total.)
- The `/audit-ask-vault-doc` command performs this coverage audit in depth (it enumerates the whole
  user-facing surface from the code and diffs it against the doc). Run it — or apply its findings —
  whenever the release includes more than a trivial change.
- Fix any real gaps, run `npx tsc -b`, and include the doc/context updates in the release commit
  (step 3). If the doc already covers everything, say so briefly — don't pad it with redundant entries.

## 3. Audit and update App Tour and Feature Tours for recent changes

Check whether recent user-facing UI changes, feature renames, tab additions, or workflow updates require updates to the in-app guided tours (in `src/components/AppTour.tsx` or feature tour definitions):

- Review recent changes (`git log`/`git diff` since the last release build) for renamed tabs, updated button labels, new Hub features, or modified UI layouts.
- Check `src/components/AppTour.tsx` to verify that step titles, descriptions, target CSS selectors, sample mock data, and feature tour titles (e.g. Wealth, Mutual Funds, EPF, Hub cards) accurately match the current UI.
- Fix any stale tour text, target selectors, or broken tour steps, and verify with `npx tsc -b`
  (`tsc --noEmit` is a no-op here: the root tsconfig has `files: []`).

## 4. Push and merge to `build-ver-2.1`

Unless told otherwise for this run, `build-ver-2.1` is always the target branch for a release:

- If there's pending work on another branch, merge it into `build-ver-2.1`.
- Commit any uncommitted changes needed for the release (ask first if it's unclear whether
  something should be included).
- Push `build-ver-2.1` to `origin`.
- Pushing affects the shared remote — confirm with the user before pushing unless they've
  already told you to push as part of this request.
- The repo's pre-commit guard (`.githooks/pre-commit`) blocks keystores, passwords and
  machine-specific paths. If it blocks a commit, fix what it names — never `--no-verify` past it
  without asking the user. Never stage `android/gradle.properties` changes that add
  `org.gradle.java.home`, nor `android/local.properties`, `key.properties` or anything in `release/`.

## 5. Build the release APK

This works the same on macOS and Windows (from any shell, Git Bash included). `docs/RELEASE.md`
covers the machinery and the one-time setup per machine.

1. Run `npm run release:doctor` FIRST. It reports this machine's signing setup, JDK, Android SDK and
   Docker, and which route `release:apk` will take. If neither route is READY, stop and report the
   `[!!]` lines to the user — the fixes (copying in the keystore, `npm run release:setup`, starting
   Docker Desktop) need them, and `release:setup` asks for passwords interactively, so the user must
   run it in their own terminal. Never create, regenerate or download a keystore: a different key
   produces an APK that cannot update an installed SpendVault, and reinstalling wipes localStorage,
   which is where all user data lives.
2. Run `npm run release:apk` (auto-picks: the local toolchain if ready, else Docker). Force a route
   with `npm run release:apk -- --local` or `-- --docker`. The Docker route's first run on a machine
   builds a multi-GB image and is slow (run it in the background); later runs are minutes.
3. Gradle itself refuses to package a release with no signing configured, with the wrong password,
   or with any keystore whose certificate is not SpendVault's — so a finished build is a correctly
   signed one. The output is copied to `release/SpendVault-<APP_VERSION>-<commit>.apk` (a `-dirty`
   suffix means uncommitted changes went in — build from the pushed commit instead).

- Do NOT bump `versionCode` (currently `1`) or `versionName` in `android/app/build.gradle`, and
  do NOT bump `APP_VERSION` in `src/utils.ts` (currently `'v2.1.0'`) — unless the user explicitly
  asks for a version bump in this run.
- Report the final APK path, its size and SHA-256 (all printed by `release:apk`), which route built
  it, and confirm the build succeeded.

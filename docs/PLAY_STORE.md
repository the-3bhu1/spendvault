# Publishing SpendVault on Google Play

What to enter in Play Console, and in what order. The build side is in [RELEASE.md](RELEASE.md).
Play's rules change, so check each form's current wording as you fill it in.

**Privacy policy URL:** `https://the-3bhu1.github.io/spendvault/privacy-policy.html`
(`docs/privacy-policy.html`, served by GitHub Pages: repo Settings → Pages → Deploy from a branch →
`build-ver-2.1`, folder `/docs`). The app links the same URL from Settings → About (`PRIVACY_POLICY_URL`
in `src/utils.ts`). If you change what the app does with data, update the policy, the in-app SMS
disclosure (`Settings.tsx`, "Auto-Log SMS") and the Data safety answers below together.

---

## Order of work

1. **Developer account.** A personal account made after Nov 2023 must run a **closed test with at
   least 12 testers for 14 days in a row** before it can apply for production. Start this first,
   because it decides the earliest launch date.
2. **Create the app.** Name SpendVault, app (not game), free.
3. **App content** forms (below): privacy policy, ads, app access, content rating, target audience,
   data safety, financial features, government apps (no), and the **SMS permissions declaration**.
4. **Store listing** (below).
5. **First upload.** `npm run release:aab`, then upload to the closed testing track. When Play App
   Signing asks for the key, **upload the existing key** (RELEASE.md §8), not one Google generates.
6. Closed test for 14 days, then apply for production access, then production release.

Each later upload needs a higher `APP_VERSION` in `src/utils.ts` (it sets `versionCode`).

---

## SMS permissions declaration

Play Console → App content → Sensitive permissions → **SMS and Call Log permissions**. SpendVault
requests **RECEIVE_SMS only** (no READ_SMS, no SEND_SMS).

- **Core functionality:** SMS-based money management (expense tracking from bank alerts).
- **Describe how the app uses the permission** (paste and adjust):

  > SpendVault is a personal expense tracker. Its core feature, Auto-Log SMS, receives incoming bank,
  > credit card and UPI transaction alert SMS and turns each one into a draft expense or income entry,
  > which the user reviews and confirms. Without it, the user would type in every card swipe and UPI
  > payment by hand. Only new incoming messages are processed, on the device. Messages that aren't
  > transaction alerts, such as personal messages and OTPs, are discarded immediately and never stored.
  > The app never reads the SMS inbox, never sends SMS, and never uploads SMS to the developer. The
  > feature is opt-in: the app shows a prominent disclosure that the user must accept before the system
  > permission prompt.

- **Demo video** (unlisted YouTube or a Drive link, 1–2 minutes; an emulator recording is fine — `adb emu sms send` delivers a real SMS through the telephony stack):
  1. Settings → Smart Features → tap **Auto-Log SMS**.
  2. Show the full disclosure dialog, then tap **Agree & Continue**.
  3. Show Android's SMS permission prompt, then tap Allow.
  4. Receive a real bank debit SMS, or use a second phone to send one in a bank's format.
  5. Show the "Transaction Detected" notification, and the pending entry in the ledger.
  6. Confirm it, and show it in the transaction list and the month's Spends.

**If it's rejected:** reviewers sometimes decide an app is usable without SMS. The fallback is a
build without RECEIVE_SMS that hides the Auto-Log toggle, shipped first, then appealing or
reapplying. That build doesn't exist yet; ask for it if needed.

---

## Data safety

SpendVault has no backend. The developer never receives user data. Everything below goes **from the
phone directly to a third party**, and only when the user turns on an optional feature with their
**own** Gemini API key. Play counts data that leaves the device as collected, so declare it rather
than relying on an exemption.

**Does the app collect or share user data?** Yes, for the optional features below.
**Is all data encrypted in transit?** Yes (HTTPS only).
**Can users request deletion?** Yes: Settings → Wipe Data, or uninstall. Nothing is held off-device.

| Data type (Play's name) | Collected | Shared | Optional | Purpose | Why |
| --- | --- | --- | --- | --- | --- |
| Messages → SMS or MMS | Yes | No | Yes | App functionality | AI SMS filter sends a detected alert's text to Gemini |
| Financial info → Other financial info | Yes | No | Yes | App functionality | Ask Vault sends a summary of finances to Gemini |
| App activity → Other user-generated content | Yes | No | Yes | App functionality | Ask Vault questions |
| Files and docs | Yes | No | Yes | App functionality | Contract-note image or PDF sent to Gemini |

- Answer **"No"** to "processed ephemerally": Google's terms, not ours, govern what Gemini keeps.
- **Shared: No.** Gemini acts as a service the user directs with their own key. If you would rather
  declare it as shared with Google, that is the more conservative choice, and either is defensible.
- **Not collected:** SMS processed only on the phone, card details (CVVs are encrypted with the
  device's key), the PIN (hashed, on-device), biometrics (handled by Android), NFC card reads, and
  investment ticker symbols sent to Yahoo Finance or mfapi.in (not linked to a user, no identifiers).
- No ads, no analytics, no crash-reporting SDK, no account.

---

## Other App content forms

- **Ads:** No ads.
- **App access:** All features are available without login. Note for reviewers: the app may ask for a
  PIN only if one is set; on a fresh install it isn't. AI features need the reviewer's own Gemini key
  and are optional.
- **Content rating (IARC):** utility or productivity, with no violence, gambling, etc. If asked about
  user-generated or AI content: the app has an AI assistant whose answers can be reported in-app
  (the **Report** link under every Ask Vault answer emails the developer).
- **Target audience:** 18 and over. Don't select younger ages; that would bring in the Families policy.
- **Financial features declaration:** personal finance / budgeting / expense tracking only. No
  banking, loans, payments, money transfer, crypto or investment trading. The app records investments
  the user already holds and doesn't buy or sell them.
- **Generative AI:** Ask Vault answers carry a Report link (Play requires reporting for AI answers).

---

## Store listing

- **App name:** SpendVault (up to 30 characters).
- **Short description** (up to 80): e.g. *Private expense tracker — logs bank SMS, cards, splits & wealth on your phone.*
- **Full description** (up to 4000): what it does, then privacy ("no account, no servers, your data
  stays on your phone"), then the optional AI features with the user's own Gemini key.
- **App icon:** 512 × 512 PNG.
- **Feature graphic:** 1024 × 500 PNG or JPG.
- **Phone screenshots:** 2–8, 16:9 or 9:16, at least 1080 px on the short side is a good target.
  Take them on a test install with made-up accounts (or during a feature tour, which shows demo
  data) so no real card numbers or balances appear.
- **Category:** Finance. **Contact email:** tribhuvankomarla@gmail.com. **Privacy policy:** the URL above.

# SpendVault — iOS Compatibility Audit

> Audited against the Android-tested build. No `ios/` Xcode project has been generated yet.

---

## 🔴 Critical Blockers (Must Fix Before iOS Build)

### 1. No iOS Xcode Project Exists
The `ios/` directory **does not exist**. You've only ever run `npx cap add android`. Before you can build for iOS, you must:
```bash
npx cap add ios
npx cap sync ios
```
This requires **Xcode 15+** on a Mac, and an **Apple Developer account** for device builds.

---

### 2. SMS Auto-Log Feature — iOS Incompatible (by Design)
**File:** `src/services/SmsService.ts`, `src/App.tsx`

The custom `SmsReader` Capacitor plugin reads SMS messages directly. **iOS does not allow apps to read SMS messages at all** — this is a hard platform restriction (no API exists, even for native apps). The plugin is Android-only.

**Current risk:** The `SmsReader.ping()`, `SmsReader.setEnabled()`, `SmsReader.drainPendingTransactions()`, and `SmsReader.checkLaunchIntent()` calls in `App.tsx` run unconditionally on every platform. On iOS, these will throw silent errors or crash the plugin bridge.

**Fix required:** Wrap all `SmsReader` calls with a platform guard:
```tsx
// In App.tsx and wherever SmsReader is called
if (Capacitor.getPlatform() === 'android') {
  SmsReader.ping().catch(() => {});
}
```
And the SMS toggle in Settings must be **hidden on iOS** (already partially done via `Capacitor.isNativePlatform()`, but needs to be `platform === 'android'` specifically).

---

### 3. `CapApp.exitApp()` — iOS Will Reject App on App Store
**File:** `src/App.tsx` (line ~215)

`CapApp.exitApp()` programmatically terminates the app on double back-press (Android behaviour). **Apple's App Store guidelines explicitly prohibit apps from calling `exit()` or any programmatic termination.** Apps that do this are rejected at review.

**Fix required:**
```tsx
// Only call exitApp on Android
if (Capacitor.getPlatform() === 'android') {
  CapApp.exitApp();
}
// On iOS — do nothing, Apple handles it
```

---

### 4. `backButton` Listener — Android-Only Concept
**File:** `src/App.tsx` (line ~223)

`CapApp.addListener('backButton', ...)` is an Android hardware back button concept. On iOS there is no hardware back button, so this event never fires — which is fine. However the double-back-exit toast (`showExitToast`) and `CapApp.exitApp()` logic nested inside are both Android-only concerns. Low risk, but clean it up alongside fix #3.

---

## 🟡 Moderate Issues (Functional, But Needs Verification on iOS)

### 5. File Export — `Directory.Documents` Behavior Differs on iOS
**File:** `src/components/Settings.tsx` (lines 660–697)

The export tries `Directory.Documents` first, then falls back to `Directory.Cache` + Share Sheet. On iOS:
- `Directory.Documents` maps to the app's **sandboxed Documents folder** (accessible via Files app if you add `UIFileSharingEnabled` to `Info.plist`)
- The Share Sheet fallback **works on iOS** (it's the most common export method on iOS)
- The comment says "blocked by scoped storage on Android 10+" but the code is platform-agnostic (`Capacitor.isNativePlatform()` covers both)

**Required for iOS:** Add `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` keys to `ios/App/App/Info.plist` after you generate the iOS project. Otherwise the Documents save silently fails and falls to Share Sheet (which still works, just not ideal).

---

### 6. `Filesystem.requestPermissions()` — iOS Difference
**File:** `src/components/Settings.tsx` (line 660)

On Android, `publicStorage` permission is required. On iOS, **no filesystem permission is needed** for the app's own sandbox — `perm.publicStorage` will always return `'granted'` or `'prompt'` on iOS. The current check (`if (perm.publicStorage === 'denied')`) is safe but slightly misleading on iOS. No crash risk.

---

### 7. `navigator.vibrate()` — Not Supported on iOS Safari/WKWebView
**File:** `src/components/Transactions.tsx` (line ~59)

```tsx
if (navigator.vibrate) navigator.vibrate(40);
```
`navigator.vibrate` is already guarded with a feature check, so it won't crash. But **iOS WKWebView does not support `navigator.vibrate`**, so the haptic feedback on long-press drag-to-reorder will be silently skipped on iOS. Acceptable, but worth noting — you could use `@capacitor/haptics` for cross-platform haptics if desired.

---

### 8. Google Fonts — Requires Internet on First Load
**File:** `index.html` (lines 6–8)

The app loads Inter, Overpass Mono, and Playfair Display from Google Fonts via CDN. On iOS, if the app is opened without internet (e.g., no WiFi, first launch), fonts will fall back to system defaults — visually jarring. 

**Fix:** Bundle the fonts locally (copy `.woff2` files to `public/fonts/` and use `@font-face` in CSS) or add them via Capacitor's bundled assets.

---

### 9. `@capgo/capacitor-native-biometric` — Needs iOS Configuration
**File:** `src/components/AuthScreen.tsx`, `src/components/Settings.tsx`

The `NativeBiometric.verifyIdentity()` call covers both Face ID and Touch ID on iOS (the plugin supports both). However, you need to:
1. Add `NSFaceIDUsageDescription` to `Info.plist`:
   ```xml
   <key>NSFaceIDUsageDescription</key>
   <string>SpendVault uses Face ID to securely unlock your financial data.</string>
   ```
2. Without this key, iOS will crash at runtime when Face ID is requested.

The plugin itself is cross-platform — biometrics **will work** once the plist key is added.

---

## 🟢 Things That Are Already iOS-Compatible

| Feature | Status |
|---|---|
| **`env(safe-area-inset-top/bottom)`** | ✅ Used throughout — notch and Dynamic Island safe |
| **`viewport-fit=cover`** | ✅ Set in `index.html` — required for edge-to-edge on iOS |
| **`-webkit-*` CSS prefixes** | ✅ Already present in `index.css` |
| **`-webkit-overflow-scrolling: touch`** | ✅ Applied to scrollable containers |
| **`-webkit-backdrop-filter`** | ✅ Alongside `backdrop-filter` |
| **`@capacitor/ios` package** | ✅ Already installed (`^8.2.0`) |
| **Biometrics (Face ID/Touch ID)** | ✅ Plugin supports both (needs plist key — see #9) |
| **Export Share Sheet** | ✅ Works cross-platform |
| **`CapApp.addListener('appStateChange')`** | ✅ Works on iOS |
| **`crypto.subtle`** | ✅ Available in iOS WKWebView |
| **LocalStorage persistence** | ✅ Works in iOS WKWebView |
| **`@capacitor/dialog`** (alerts) | ✅ Cross-platform |
| **`@capacitor/share`** | ✅ Uses iOS native share sheet |
| **Touch interactions & swipe gestures** | ✅ Standard touch events work on iOS |
| **Dark mode / light mode toggle** | ✅ CSS variables — fully cross-platform |
| **Camera (profile photo)** | ⚠️ Needs `NSCameraUsageDescription` in plist |

---

## 📋 iOS Build Checklist

Before submitting to TestFlight / App Store:

- [ ] Run `npx cap add ios` to generate the Xcode project
- [ ] Run `npm run build && npx cap sync ios`
- [ ] Open `ios/App/App.xcworkspace` in Xcode
- [ ] Add to `Info.plist`:
  - [ ] `NSFaceIDUsageDescription` — required for Face ID
  - [ ] `NSCameraUsageDescription` — required for profile photo camera
  - [ ] `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` — for Files app export
- [ ] **Fix `CapApp.exitApp()`** — guard with `Capacitor.getPlatform() === 'android'`
- [ ] **Guard all `SmsReader` calls** with `Capacitor.getPlatform() === 'android'`
- [ ] **Hide SMS auto-log toggle on iOS** (show only when `platform === 'android'`)
- [ ] Sign with your Apple Developer certificate & provisioning profile
- [ ] Test on a real iPhone (Simulator doesn't support biometrics or camera reliably)
- [ ] Bundle fonts locally to avoid CDN dependency on first launch

---

## Summary

The app is **architecturally iOS-ready** — Capacitor, safe area insets, webkit CSS prefixes, and biometrics are all in place. The two **hard blockers** are the `exitApp()` call (App Store rejection risk) and the unguarded `SmsReader` plugin calls (crash risk on iOS since the plugin has no iOS implementation). Once those are patched and the Xcode project is generated with the required `Info.plist` entries, you should have a functional iOS build.

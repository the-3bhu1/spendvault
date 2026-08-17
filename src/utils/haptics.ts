// A short confirmation buzz for a gesture that fires on its own — currently the statement screen's
// long-press to move a transaction between billing cycles. A long-press with no tactile answer reads
// as a laggy tap: the buzz is what tells you the press took, before the sheet has drawn. So this is
// part of the gesture, not decoration.
//
// Runs on the WebView's own vibrator, which needs android.permission.VIBRATE declared in
// AndroidManifest.xml — it is a normal permission (granted at install, no prompt), and without it
// this call is a silent no-op rather than an error.
//
// Two things it does NOT do, both deliberate trade-offs for having no native dependency:
//   - Nothing on iOS. navigator.vibrate is unsupported in WKWebView, so the gesture is mute there.
//   - Ignores the system haptic/touch-feedback setting, which it has no way to read.
//
// @capacitor/haptics fixes both. If it is ever added, replace the body below with:
//
//   import { Haptics, ImpactStyle } from '@capacitor/haptics';
//   Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
//
// Every caller goes through this one function, so that swap is the whole migration.
export const hapticTap = (ms = 18) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // A device with no vibrator, or a WebView that denies it, must never break the gesture.
  }
};

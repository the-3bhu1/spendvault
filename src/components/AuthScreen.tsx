import { useState, useEffect } from 'react';
import { useFinance } from '../FinanceContext';
import { Fingerprint, AlertCircle, ShieldCheck, Delete, X, Key } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { Capacitor } from '@capacitor/core';


/** The four-dot PIN display. Extracted when the reset flow arrived: it needs the same dots driven by
 *  a different buffer, and a second hand-rolled copy is how two keypads drift apart. */
const PinDots = ({ value, tone = 'var(--accent)' }: { value: string; tone?: string }) => (
  <div className="flex justify-center gap-4" style={{ marginTop: '1.5rem' }}>
    {[0, 1, 2, 3].map(i => (
      <div key={i} style={{
        width: '16px', height: '16px', borderRadius: '50%',
        border: `2px solid ${tone}`,
        background: value.length > i ? tone : 'transparent',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        transform: value.length === i ? 'scale(1.2)' : 'scale(1)'
      }} />
    ))}
  </div>
);

/** The number pad. The biometric key keeps its slot even when hidden, so the 0 and the delete key
 *  don't shuffle across the grid between the two views. */
const PinKeypad = ({ onKey, onDelete, onBiometric, showBiometric = false }: {
  onKey: (n: string) => void;
  onDelete: () => void;
  onBiometric?: () => void;
  showBiometric?: boolean;
}) => (
  <div className="pin-pad grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem 2rem', maxWidth: '280px', width: '100%' }}>
    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
      <button key={n} className="pin-btn" onClick={() => onKey(n.toString())}>{n}</button>
    ))}
    <button className="pin-btn" onClick={onBiometric} style={{ visibility: showBiometric ? 'visible' : 'hidden' }}>
      <Fingerprint size={28} />
    </button>
    <button className="pin-btn" onClick={() => onKey('0')}>0</button>
    <button className="pin-btn" onClick={onDelete}>
      <Delete size={28} />
    </button>
  </div>
);

/** Rendered by BOTH full-screen views. It used to sit inside the unlock view's markup, which is fine
 *  while that is the only screen with a keypad — the reset view would have shown unstyled circles. */
const AuthStyles = () => (
  <style>{`
    .auth-root { background: var(--bg-color); }
    .pin-btn {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      cursor: pointer;
    }
    .pin-btn:active {
      background: var(--accent);
      color: #000;
      transform: scale(0.95);
    }
    .text-secondary { color: var(--text-secondary); }
    .text-secondary:hover { color: var(--accent); }
    .border-danger { border-color: #ef4444 !important; }
    .biometric-modal {
      position: absolute;
      bottom: 2rem;
      background: var(--bg-card);
      padding: 1rem 1.5rem;
      border-radius: 24px;
      border: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 1rem;
      box-shadow: 0 10px 40px rgba(0,0,0,0.4);
    }
  `}</style>
);

export default function AuthScreen() {
  const { data, setAuthenticated, clearAllData, updateUser } = useFinance();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [view, setView] = useState<'unlock' | 'recovery' | 'forgot' | 'reset'>('unlock');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [isBiometricPromptVisible, setIsBiometricPromptVisible] = useState(false);
  const [isWipeConfirmOpen, setIsWipeConfirmOpen] = useState(false);
  // The two buffers of the post-recovery reset, and the shake window after they disagree.
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [isPinlessConfirmOpen, setIsPinlessConfirmOpen] = useState(false);

  const hashString = async (str: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleKeyPress = (num: string) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      if (newPin.length === 4) {
        verifyPin(newPin);
      }
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const verifyPin = async (enteredPin: string) => {
    const enteredHash = await hashString(enteredPin);
    if (enteredHash === data.user?.pinHash) {
      setAuthenticated(true);
      setError(false);
    } else {
      setError(true);
      setTimeout(() => {
        setPin('');
        setError(false);
      }, 1000);
    }
  };

  /* A CORRECT RECOVERY KEY OPENS THE RESET SCREEN, NOT THE APP.
   *
   * This used to call setAuthenticated(true) and stop, which left `pinHash` exactly as it was — and
   * `isAuthenticated` is in-memory state that starts false on every launch. So recovering did not
   * recover anything: the next cold start, and every return from more than 30 seconds in the
   * background, landed back on a PIN the user had already told us they had forgotten. Nor was there
   * a way out from inside the app, because Settings gates BOTH "change PIN" and "remove PIN" on the
   * current PIN. Unless biometrics happened to be on, the 16-digit key silently became the
   * password, forever.
   *
   * So the key now proves who you are and nothing more; the screen it opens is where the lock is
   * actually re-established. It has no dismiss control on purpose — the two ways out are setting a
   * new PIN and going without one, and both leave the vault in a state the user can actually open
   * tomorrow. Killing the app mid-reset is safe: nothing has been written, so it simply reverts to
   * the old lock and the same recovery key still works. */
  const handleRecovery = async () => {
    const enteredHash = await hashString(recoveryKey);
    if (enteredHash === data.user?.recoveryKeyHash) {
      setError(false);
      setRecoveryKey('');
      setView('reset');
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  };

  /** Which half of the reset the keypad is filling. */
  const resetStage: 'enter' | 'confirm' = newPin.length < 4 ? 'enter' : 'confirm';

  const commitNewPin = async (chosen: string, confirmed: string) => {
    if (chosen !== confirmed) {
      // Same 1.5s shake-and-clear the onboarding PIN step uses, so the two feel like one flow.
      setMismatch(true);
      setTimeout(() => { setNewPin(''); setConfirmPin(''); setMismatch(false); }, 1500);
      return;
    }
    const updated = { ...data.user!, pinHash: await hashString(chosen) };
    // The legacy plaintext field, dropped for the same reason Settings' removal drops it: Settings
    // still falls back to comparing against it, so a stale one left behind would out-rank the hash
    // we just wrote and reject the PIN the user chose thirty seconds ago.
    delete (updated as { pin?: string }).pin;
    updateUser(updated);
    // The recovery key is deliberately kept. Forgetting a PIN does not compromise it, the user has
    // it saved and has just used it, and demanding they write down a fresh sixteen characters while
    // locked out buys nothing.
    setAuthenticated(true);
  };

  const handleResetKey = (n: string) => {
    if (mismatch) return;                       // ignore taps during the shake window
    if (newPin.length < 4) { setNewPin(newPin + n); return; }
    if (confirmPin.length >= 4) return;
    const next = confirmPin + n;
    setConfirmPin(next);
    if (next.length === 4) commitNewPin(newPin, next);
  };

  const handleResetDelete = () => {
    if (mismatch) return;
    if (confirmPin.length > 0) { setConfirmPin(prev => prev.slice(0, -1)); return; }
    setNewPin(prev => prev.slice(0, -1));
  };

  /* Going without a lock clears the recovery key and biometrics alongside the PIN — the exact set
   * Settings' "Remove PIN" clears, and its dialog says so outright. A recovery key guarding nothing
   * is a credential with no lock behind it, and biometrics with no PIN is a state Settings refuses
   * to create ("biometric unlock needs a PIN as a fallback"). Self-healing, too: setting a PIN again
   * later regenerates a recovery key, because Settings issues one whenever none exists. */
  const goPinless = () => {
    const updated = { ...data.user! };
    delete (updated as { pinHash?: string }).pinHash;
    delete (updated as { recoveryKeyHash?: string }).recoveryKeyHash;
    delete (updated as { pin?: string }).pin;
    updated.biometricsEnabled = false;
    updateUser(updated);
    setIsPinlessConfirmOpen(false);
    setAuthenticated(true);
  };

  const triggerBiometrics = async () => {
    if (!data.user?.biometricsEnabled) return;

    // Use native biometrics if on a native platform
    if (Capacitor.isNativePlatform()) {
      try {
        const result = await NativeBiometric.isAvailable();
        if (result.isAvailable) {
          const verified = await NativeBiometric.verifyIdentity({
            reason: 'unlock spendvault',
            title: 'Biometric Unlock',
            subtitle: 'Log in with biometrics',
            description: 'Authentication is required to access your finance data.',
          }).then(() => true).catch(() => false);

          if (verified) {
            setAuthenticated(true);
            return;
          }
        }
      } catch (err) {
        console.error('Biometric authentication failed:', err);
      }
    }

    // Fallback/Simulation for Browser or failed native prompt
    if (!Capacitor.isNativePlatform()) {
      setIsBiometricPromptVisible(true);
      setTimeout(() => {
        setAuthenticated(true);
        setIsBiometricPromptVisible(false);
      }, 1500);
    }
  };

  useEffect(() => {

    if (data.user?.biometricsEnabled && view === 'unlock') {
      triggerBiometrics();
    }
  }, [view]);

  if (view === 'forgot') {
    return (
      <>
      <div className="flex-col align-center justify-center fade-in bg-main" style={{ position: 'fixed', inset: 0, zIndex: 10000, padding: '2rem' }}>
        <div className="card flex-col gap-6 w-100" style={{ maxWidth: '360px' }}>
          <div className="flex justify-between align-center">
            <h2 style={{ margin: 0 }}>forgot pin?</h2>
            <button className="text-muted" onClick={() => setView('unlock')}><X size={24} /></button>
          </div>
          <div className="flex-col gap-4">
            <div className="flex gap-3" style={{ padding: '1rem', background: 'rgba(56, 189, 248, 0.05)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
              <Key size={20} className="text-accent" />
              <div className="flex-col gap-1">
                <span className="font-bold text-sm">Option 1: Recovery Key</span>
                <p className="text-xs text-muted">Use the 16-digit key you saved during setup to bypass the PIN.</p>
                <button className="btn btn-secondary text-xs" style={{ alignSelf: 'flex-start', marginTop: '0.5rem' }} onClick={() => setView('recovery')}>Enter Recovery Key</button>
              </div>
            </div>
            
            <div className="flex gap-3" style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.05)', borderRadius: '12px', border: '1px solid #ef444433' }}>
              <AlertCircle size={20} className="text-danger" />
              <div className="flex-col gap-1">
                <span className="font-bold text-sm text-danger">Option 2: Wipe App</span>
                <p className="text-xs text-muted">If you lost your recovery key, you must reset the app. All data will be lost.</p>
                <button 
                  className="btn btn-danger text-xs" 
                  style={{ alignSelf: 'flex-start', marginTop: '0.5rem', background: '#ef4444', color: '#fff' }} 
                  onClick={() => setIsWipeConfirmOpen(true)}
                >
                  Wipe & Reset
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ConfirmDialog
        isOpen={isWipeConfirmOpen}
        title="Wipe & Reset?"
        message="FINAL WARNING: This will permanently delete ALL your accounts, transactions, and settings. This cannot be undone."
        confirmLabel="Wipe Everything"
        cancelLabel="Cancel"
        onConfirm={() => {
          clearAllData();
          setIsWipeConfirmOpen(false);
        }}
        onCancel={() => setIsWipeConfirmOpen(false)}
      />
      </>
    );
  }

  /* NO DISMISS CONTROL, and that is the feature. Every other view here has an X, because every
     other view has somewhere safe to go back to; this one exists precisely because there wasn't
     one. Both buttons on it resolve the lock. */
  if (view === 'reset') {
    return (
      <div className="auth-root flex-col align-center justify-between fade-in" style={{
        position: 'fixed', inset: 0, background: 'var(--bg-color)', zIndex: 10000,
        paddingTop: 'calc(3rem + var(--safe-area-inset-top))',
        paddingLeft: '2rem',
        paddingRight: '2rem',
        paddingBottom: 'calc(2rem + var(--safe-area-inset-bottom))'
      }}>
        <div className="flex-col align-center gap-4">
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: mismatch ? 'rgba(239, 68, 68, 0.1)' : 'rgba(56, 189, 248, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${mismatch ? '#ef4444' : 'var(--accent)'}` }}>
            {mismatch ? <AlertCircle size={28} className="text-danger" /> : <Key size={28} className="text-accent" />}
          </div>
          <div className="text-center w-100">
            <h2 style={{ margin: 0, fontSize: '1.5rem' }}>
              {resetStage === 'enter' ? 'set a new pin' : 'confirm your pin'}
            </h2>
            <p className="text-muted text-xs" style={{ marginTop: '0.25rem' }}>
              {resetStage === 'enter'
                ? 'recovery key accepted — choose the pin you\u2019ll use from now on'
                : 're-enter it so we know it is the one you meant'}
            </p>
          </div>

          <PinDots value={resetStage === 'enter' ? newPin : confirmPin} tone={mismatch ? '#ef4444' : 'var(--accent)'} />
          {mismatch && <span className="text-xs text-danger">PINs do not match. Try again.</span>}
        </div>

        <PinKeypad onKey={handleResetKey} onDelete={handleResetDelete} />

        <button
          className="text-secondary text-xs font-bold"
          style={{ background: 'none', border: 'none', letterSpacing: '1px' }}
          onClick={() => setIsPinlessConfirmOpen(true)}
        >
          USE WITHOUT A LOCK
        </button>

        <AuthStyles />
        <ConfirmDialog
          isOpen={isPinlessConfirmOpen}
          title="Use without a lock?"
          message="SpendVault will open straight to your data on this device. Your PIN, your recovery key and biometric unlock will all be removed. You can set a new PIN any time from Settings."
          confirmLabel="Remove Lock"
          cancelLabel="Cancel"
          onConfirm={goPinless}
          onCancel={() => setIsPinlessConfirmOpen(false)}
        />
      </div>
    );
  }

  if (view === 'recovery') {
    return (
      <div className="flex-col align-center justify-center fade-in bg-main" style={{ position: 'fixed', inset: 0, zIndex: 10000, padding: '2rem' }}>
        <div className="card flex-col gap-6 w-100" style={{ maxWidth: '360px' }}>
          <div className="flex justify-between align-center">
            <h2 style={{ margin: 0 }}>recovery</h2>
            <button className="text-muted" onClick={() => setView('forgot')}><X size={24} /></button>
          </div>
          <p className="text-sm text-muted">Enter your 16-digit Master Recovery Key exactly as it was shown to you.</p>
          <div className="flex-col gap-4">
            <input 
              className={`input-field ${error ? 'border-danger' : ''}`}
              style={{ textAlign: 'center', fontSize: '1.1rem', letterSpacing: '1px', fontWeight: 700 }}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={recoveryKey}
              onChange={e => setRecoveryKey(e.target.value.toUpperCase())}
            />
            {error && <span className="text-xs text-danger text-center">Invalid Recovery Key</span>}
            <button className="btn btn-primary" style={{ padding: '1rem' }} onClick={handleRecovery}>verify & unlock</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-root flex-col align-center justify-between fade-in" style={{ 
      position: 'fixed', inset: 0, background: 'var(--bg-color)', zIndex: 10000, 
      paddingTop: 'calc(3rem + var(--safe-area-inset-top))',
      paddingLeft: '2rem',
      paddingRight: '2rem',
      paddingBottom: 'calc(2rem + var(--safe-area-inset-bottom))'
    }}>
      <div className="flex-col align-center gap-4">
        <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(56, 189, 248, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--accent)' }}>
          {error ? <AlertCircle size={28} className="text-danger" /> : <ShieldCheck size={28} className="text-accent" />}
        </div>
        <div className="text-center w-100">
          <h2 style={{ margin: 0, fontSize: '1.5rem' }}>enter pin</h2>
          <p className="text-muted text-xs" style={{ marginTop: '0.25rem' }}>securely unlock spendvault</p>
        </div>
        
        <PinDots value={pin} />
      </div>

      <PinKeypad
        onKey={handleKeyPress}
        onDelete={handleDelete}
        onBiometric={triggerBiometrics}
        showBiometric={!!data.user?.biometricsEnabled}
      />

      <button className="text-secondary text-xs font-bold" style={{ background: 'none', border: 'none', letterSpacing: '1px' }} onClick={() => setView('forgot')}>
        FORGOT PIN?
      </button>

      {isBiometricPromptVisible && (
        <div className="biometric-modal fade-in">
          <Fingerprint size={32} className="text-accent" />
          <span>Verifying Biometrics...</span>
        </div>
      )}

      <AuthStyles />
      {/* Custom Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isWipeConfirmOpen}
        title="Wipe & Reset?"
        message="FINAL WARNING: This will permanently delete ALL your accounts, transactions, and settings. This cannot be undone."
        confirmLabel="Wipe Everything"
        cancelLabel="Cancel"
        onConfirm={() => {
          clearAllData();
          setIsWipeConfirmOpen(false);
        }}
        onCancel={() => setIsWipeConfirmOpen(false)}
      />
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useFinance } from '../FinanceContext';
import { Shield, Key, User as UserIcon, Check, Copy, AlertTriangle, ArrowRight, ArrowLeft } from 'lucide-react';
import type { User } from '../types';
import { APP_VERSION } from '../utils';

export default function OnboardingScreen() {
  const { updateUser, setAuthenticated } = useFinance();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  
  // Step 1: Name
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState(false);

  // Step 2: PIN Setup & Confirm
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [pinError, setPinError] = useState('');

  // Step 3: Master Recovery Key
  const [recoveryKey, setRecoveryKey] = useState('');
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [copied, setCopied] = useState(false);

  // Generate recovery key once on mount
  useEffect(() => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 16; i++) {
      if (i > 0 && i % 4 === 0) result += '-';
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setRecoveryKey(result);
  }, []);

  const hashString = async (str: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleNextStep1 = () => {
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    setNameError(false);
    setStep(2);
  };

  const handleKeyPress = (num: string) => {
    if (!isConfirming) {
      if (pin.length < 4) {
        const newPin = pin + num;
        setPin(newPin);
        if (newPin.length === 4) {
          setIsConfirming(true);
        }
      }
    } else {
      if (confirmPin.length < 4) {
        const newConfirm = confirmPin + num;
        setConfirmPin(newConfirm);
        if (newConfirm.length === 4) {
          verifyAndProceedPin(pin, newConfirm);
        }
      }
    }
  };

  const handleDelete = () => {
    if (!isConfirming) {
      setPin(prev => prev.slice(0, -1));
    } else {
      if (confirmPin.length === 0) {
        // Go back to inputting the original pin
        setIsConfirming(false);
        setPin(prev => prev.slice(0, -1));
      } else {
        setConfirmPin(prev => prev.slice(0, -1));
      }
    }
  };

  const verifyAndProceedPin = (original: string, confirmation: string) => {
    if (original === confirmation) {
      setPinError('');
      setStep(3);
    } else {
      setPinError('PINs do not match. Please try again.');
      setTimeout(() => {
        setPin('');
        setConfirmPin('');
        setIsConfirming(false);
        setPinError('');
      }, 1500);
    }
  };

  const handleCopyKey = () => {
    navigator.clipboard.writeText(recoveryKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCompleteSetup = async () => {
    if (!hasSavedKey) return;

    try {
      const hashedPin = await hashString(pin);
      const hashedRecoveryKey = await hashString(recoveryKey);

      const newUser: User = {
        id: 'default',
        name: name.trim(),
        pinHash: hashedPin,
        recoveryKeyHash: hashedRecoveryKey,
        biometricsEnabled: false,
        autoLogSms: false,
        enablePassiveTransactions: false // Default to false/off for new users
      };

      // Set profile and authenticate
      updateUser(newUser);
      setAuthenticated(true);
    } catch (e) {
      console.error('Failed to hash user credentials during onboarding:', e);
    }
  };

  return (
    <div className="onboarding-root flex-col align-center justify-between fade-in" style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--bg-color)',
      zIndex: 10000,
      paddingTop: 'calc(3rem + env(safe-area-inset-top, 24px))',
      paddingLeft: '2rem',
      paddingRight: '2rem',
      paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 16px))',
      overflowY: 'auto'
    }}>
      {/* Top Header / Progress indicator */}
      <div className="flex-col align-center w-100 gap-4" style={{ maxWidth: '400px' }}>
        <div className="flex align-center justify-center gap-4" style={{ width: '100%' }}>
          <div className={`step-dot ${step >= 1 ? 'active' : ''}`} />
          <div className="step-line" />
          <div className={`step-dot ${step >= 2 ? 'active' : ''}`} />
          <div className="step-line" />
          <div className={`step-dot ${step >= 3 ? 'active' : ''}`} />
        </div>
        <div className="text-center w-100" style={{ marginTop: '0.5rem' }}>
          <h1 className="navbar-title text-accent uppercase font-bold" style={{ fontSize: '1.25rem', letterSpacing: '2px', margin: 0 }}>
            spendvault setup
          </h1>
          <p className="text-muted text-xs">Secure your local financial vault</p>
        </div>
      </div>

      {/* Dynamic Step Content */}
      <div className="flex-col justify-center align-center w-100 flex-1" style={{ maxWidth: '400px', margin: '2rem 0' }}>
        
        {step === 1 && (
          <div className="flex-col gap-6 w-100 fade-in">
            <div className="flex-center" style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--primary-soft)', border: '1px solid var(--accent)', margin: '0 auto 0.5rem' }}>
              <UserIcon size={28} className="text-accent" />
            </div>
            <div className="text-center">
              <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>what should we call you?</h2>
              <p className="text-muted text-sm">Let's start by personalizing your local vault profile.</p>
            </div>
            <div className="flex-col gap-2">
              <input
                className={`input-field ${nameError ? 'border-danger' : ''}`}
                style={{ textAlign: 'center', fontSize: '1.1rem', padding: '1rem', background: 'var(--bg-hover)' }}
                placeholder="Enter your name"
                value={name}
                onChange={e => {
                  setName(e.target.value);
                  if (e.target.value.trim()) setNameError(false);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleNextStep1();
                }}
              />
              {nameError && <span className="text-xs text-danger text-center">Please enter a valid profile name</span>}
            </div>
            <button className="btn btn-primary flex-center gap-2" style={{ padding: '1rem', width: '100%', marginTop: '1rem' }} onClick={handleNextStep1}>
              Continue <ArrowRight size={18} />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex-col gap-4 w-100 fade-in align-center">
            <div className="flex-center" style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--primary-soft)', border: '1px solid var(--accent)', marginBottom: '0.5rem' }}>
              <Shield size={28} className="text-accent" />
            </div>
            <div className="text-center">
              <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                {!isConfirming ? 'create a secure pin' : 'confirm your pin'}
              </h2>
              <p className="text-muted text-sm">
                {!isConfirming 
                  ? 'Set a 4-digit PIN to securely lock SpendVault on this device.' 
                  : 'Re-enter your 4-digit PIN to ensure it is correct.'}
              </p>
            </div>

            {/* Dots indicator */}
            <div className="flex justify-center gap-4" style={{ margin: '1.5rem 0' }}>
              {[0, 1, 2, 3].map(i => {
                const currentVal = !isConfirming ? pin : confirmPin;
                return (
                  <div key={i} style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    border: '2px solid var(--accent)',
                    background: currentVal.length > i ? 'var(--accent)' : 'transparent',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    transform: currentVal.length === i ? 'scale(1.2)' : 'scale(1)'
                  }} />
                );
              })}
            </div>

            {pinError && <span className="text-sm text-danger text-center font-bold" style={{ height: '20px' }}>{pinError}</span>}

            {/* Tactile Keypad */}
            <div className="pin-pad grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem 1.5rem', maxWidth: '280px', width: '100%', marginTop: '0.5rem' }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                <button key={n} className="pin-btn" onClick={() => handleKeyPress(n.toString())}>{n}</button>
              ))}
              <button className="pin-btn" onClick={() => setStep(1)} style={{ background: 'transparent', border: 'none' }}>
                <ArrowLeft size={22} className="text-muted" />
              </button>
              <button className="pin-btn" onClick={() => handleKeyPress('0')}>0</button>
              <button className="pin-btn text-muted" onClick={handleDelete} style={{ background: 'transparent', border: 'none' }}>
                clear
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex-col gap-6 w-100 fade-in">
            <div className="flex-center" style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(251, 191, 36, 0.1)', border: '1px solid var(--warning)', margin: '0 auto 0.5rem' }}>
              <Key size={28} className="text-warning" />
            </div>
            <div className="text-center">
              <h2 style={{ fontSize: '1.4rem', marginBottom: '0.5rem' }}>master recovery key</h2>
              <p className="text-muted text-sm">Save this key in a secure location. You will need it to unlock your vault if you ever forget your PIN.</p>
            </div>

            <div className="card flex-col align-center gap-4" style={{ padding: '1.5rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '16px' }}>
              <span className="text-accent text-mono font-bold" style={{ fontSize: '1.35rem', letterSpacing: '2px', wordBreak: 'break-all', textAlign: 'center' }}>
                {recoveryKey}
              </span>
              <button className={`btn ${copied ? 'btn-success' : 'btn-secondary'} flex-center gap-2`} style={{ padding: '0.6rem 1.2rem', fontSize: '0.85rem' }} onClick={handleCopyKey}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Copied to Clipboard!' : 'Copy Key'}
              </button>
            </div>

            <div className="flex gap-3" style={{ padding: '1rem', background: 'rgba(251, 191, 36, 0.05)', borderRadius: '12px', border: '1px solid rgba(251, 191, 36, 0.2)' }}>
              <AlertTriangle size={24} className="text-warning" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
              <p className="text-xs text-muted leading-relaxed">
                <strong className="text-warning">WARNING:</strong> SpendVault is entirely offline. We do not store your data or recovery keys on any servers. If you lose this key and your PIN, your data cannot be recovered.
              </p>
            </div>

            <label className="flex align-center gap-3 clickable" style={{ padding: '0.5rem 0' }}>
              <input
                type="checkbox"
                checked={hasSavedKey}
                onChange={e => setHasSavedKey(e.target.checked)}
                style={{ width: '20px', height: '20px', accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              <span className="text-xs text-muted" style={{ userSelect: 'none' }}>
                I have securely saved my Master Recovery Key.
              </span>
            </label>

            <button
              className="btn btn-primary flex-center gap-2"
              style={{ padding: '1rem', width: '100%' }}
              disabled={!hasSavedKey}
              onClick={handleCompleteSetup}
            >
              Complete Setup <Check size={18} />
            </button>
          </div>
        )}

      </div>

      {/* Footer Branding */}
      <span className="text-mono uppercase text-muted" style={{ fontSize: '0.7rem', letterSpacing: '2px', opacity: 0.5 }}>
        spendvault {APP_VERSION}
      </span>

      <style>{`
        .onboarding-root {
          background: var(--bg-color);
        }
        .step-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--border-color);
          transition: all 0.3s ease;
        }
        .step-dot.active {
          background: var(--accent);
          box-shadow: 0 0 8px var(--accent);
        }
        .step-line {
          height: 2px;
          flex: 1;
          max-width: 60px;
          background: var(--border-color);
        }
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
        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none !important;
        }
        .leading-relaxed {
          line-height: 1.6;
        }
      `}</style>
    </div>
  );
}

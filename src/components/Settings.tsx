import { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { useFinance } from '../FinanceContext';
import { Trash2, Tags, Database, Briefcase, Moon, Download, Info, HelpCircle, Sun, AlertTriangle, Mail, User as UserIcon, Camera, Check, Fingerprint, ZoomIn, Move, X as CloseIcon, Eye, Upload, Clipboard, Plus, GripVertical, RotateCcw, Share2, FileJson, ChevronDown, Sparkles, ShieldAlert, Hash } from 'lucide-react';
import ProfileAvatar from './ProfileAvatar';
import ConfirmDialog from './ConfirmDialog';
import TransparentLogo from './TransparentLogo';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import SmsReader from '../services/SmsService';
import {
  getCommodityVendor, setCommodityVendor,
  setGeminiKey, clearGeminiKey, hasGeminiKey,
} from '../services/GeminiConfig';
import { getGeminiUsageToday } from '../services/GeminiService';
import { APP_VERSION } from '../utils';

const GridButton = ({ icon: Icon, label, onClick }: { icon: React.ElementType, label: string, onClick?: () => void }) => (
  <div className="card flex-col align-center justify-center" style={{ padding: '1.25rem 0.5rem', gap: '0.75rem', cursor: 'pointer', height: '100%' }} onClick={onClick}>
    <div style={{ background: 'var(--bg-hover)', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
      <Icon size={24} className="text-primary" />
    </div>
    <span className="text-mono text-center font-bold" style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)' }}>{label}</span>
  </div>
);

const GridToggleButton = ({ icon: Icon, label, active, onClick }: { icon: React.ElementType, label: string, active: boolean, onClick: () => void }) => (
  <div 
    className="card flex-col align-center justify-center" 
    style={{ 
      padding: '1.25rem 0.5rem', 
      gap: '0.75rem', 
      cursor: 'pointer', 
      height: '100%',
      background: active ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-card)',
      borderColor: active ? 'var(--success)' : 'var(--border-color)',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      transform: active ? 'translate(-2px, -2px)' : 'none',
      boxShadow: active ? '4px 4px 0 rgba(0, 255, 204, 0.2)' : 'var(--shadow)'
    }} 
    onClick={onClick}
  >
    <div style={{ 
      background: active ? 'var(--success)' : 'var(--bg-hover)', 
      padding: '0.6rem', 
      borderRadius: '8px', 
      border: '1px solid',
      borderColor: active ? 'var(--success)' : 'var(--border-color)',
      color: active ? '#000' : 'var(--primary-color)',
      transition: 'all 0.3s ease'
    }}>
      <Icon size={24} />
    </div>
    <div className="flex-col align-center gap-1">
      <span className="text-mono text-center font-bold" style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: active ? 'var(--success)' : 'var(--text-secondary)' }}>{label}</span>
      <span className="text-mono font-bold" style={{ fontSize: '8px', color: active ? 'var(--success)' : 'var(--text-muted)', textTransform: 'uppercase' }}>{active ? 'Enabled' : 'Disabled'}</span>
    </div>
  </div>
);

const SectionHeader = ({ title, first }: { title: string, first?: boolean }) => (
  <h3 className="text-mono" style={{ fontSize: '0.75rem', letterSpacing: '2px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '1rem', marginTop: first ? '0' : '2.5rem' }}>
    {title}
  </h3>
);

const SettingsCardHeader = ({ icon: Icon, title, level = 'h4', danger = false, size = 18, marginBottom }: {
  icon: React.ElementType,
  title: string,
  level?: 'h3' | 'h4',
  danger?: boolean,
  size?: number,
  marginBottom?: string
}) => {
  const Heading = level;

  return (
    <div
      className={`flex align-center ${danger ? 'text-danger' : ''}`}
      style={{
        gap: '0.75rem',
        borderBottom: '1px solid var(--border-color)',
        paddingBottom: level === 'h3' ? '1rem' : '0.75rem',
        marginBottom
      }}
    >
      <Icon size={size} className={danger ? undefined : 'text-accent'} style={{ flexShrink: 0 }} />
      <Heading style={{ margin: 0, color: danger ? '#ef4444' : undefined, textTransform: danger ? 'lowercase' : undefined }}>
        {title}
      </Heading>
    </div>
  );
};

const backupActionIconStyle = {
  flexShrink: 0,
  transform: 'translateX(-2px)'
};

import { SubviewWrapper } from './SubviewWrapper.tsx';

export default function Settings() {
  const { data, updateCategories, updateCustomAccountTypes, updateTags, updateTransaction, clearAllData, updateUser, setAuthenticated, setTheme } = useFinance();
  const [newCat, setNewCat] = useState('');
  const [newAccountType, setNewAccountType] = useState('');
  const [newTagEntry, setNewTagEntry] = useState('');
  const [activeView, setActiveView] = useState<'main' | 'categories' | 'accountTypes' | 'tags' | 'theme' | 'export' | 'import' | 'clear' | 'help' | 'about' | 'profile' | 'oem'>('main');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const reorderTimer = useRef<number | null>(null);
  const touchStartY = useRef<number>(0);
  const savedScrollPos = useRef<number>(0);

  const navigateTo = (view: 'categories' | 'accountTypes' | 'tags' | 'theme' | 'export' | 'import' | 'clear' | 'help' | 'about' | 'profile' | 'oem') => {
    const appRoot = document.querySelector('.app-root');
    if (appRoot) savedScrollPos.current = (appRoot as HTMLElement).scrollTop;
    setActiveView(view);
  };

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    
    const appRoot = document.querySelector('.app-root');
    if (draggedIdx !== null) {
      document.body.classList.add('no-scroll');
      appRoot?.classList.add('no-scroll');
    } else {
      document.body.classList.remove('no-scroll');
      appRoot?.classList.remove('no-scroll');
    }
    return () => {
      document.body.classList.remove('no-scroll');
      appRoot?.classList.remove('no-scroll');
    };
  }, [draggedIdx]);

  // Profile Form States
  const [profileForm, setProfileForm] = useState({
    name: data.user?.name || '',
    oldPin: '',
    pin: '',
    confirmPin: '',
    biometricsEnabled: data.user?.biometricsEnabled || false
  });

  const [showOldPin, setShowOldPin] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);

  const [setupStep, setSetupStep] = useState<'form' | 'recovery'>('form');
  const [generatedKey, setGeneratedKey] = useState('');
  const [hasConfirmedKey, setHasConfirmedKey] = useState(false);
  const [isOldPinVerified, setIsOldPinVerified] = useState(false);

  useEffect(() => {
    const handleGlobalBack = (e: Event) => {
      if (activeView !== 'main') {
        setActiveView('main');
        e.preventDefault();
      }
    };
    window.addEventListener('appBackButton', handleGlobalBack);
    
    // Save/restore scroll position when navigating between main and sub-views
    const appRoot = document.querySelector('.app-root');
    if (appRoot) {
      if (activeView === 'main') {
        const saved = savedScrollPos.current;
        requestAnimationFrame(() => requestAnimationFrame(() => { appRoot.scrollTop = saved; }));
      } else {
        appRoot.scrollTop = 0;
      }
    }
    
    return () => window.removeEventListener('appBackButton', handleGlobalBack);
  }, [activeView]);

  // States for Image Handling
  const [isCropperOpen, setIsCropperOpen] = useState(false);
  const [tempImage, setTempImage] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false);
  const [isViewModeOpen, setIsViewModeOpen] = useState(false);
  const [imgIsLandscape, setImgIsLandscape] = useState(false);
  
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
    confirmLabel?: string;
    cancelLabel?: string;
    isDanger?: boolean;
    isAlert?: boolean;
  } | null>(null);

  const showAlert = (message: string, title: string = 'Notice') => {
    setConfirmConfig({
      title,
      message,
      confirmLabel: 'OK',
      isAlert: true,
      onConfirm: () => setConfirmConfig(null)
    });
  };
  
  // Reset security state when navigating away from profile
  useEffect(() => {
    if (activeView !== 'profile') {
      setIsOldPinVerified(false);
      setShowOldPin(false);
      setShowPin(false);
      setShowConfirmPin(false);
      setProfileForm(prev => ({ ...prev, oldPin: '', pin: '', confirmPin: '' }));
    }
  }, [activeView]);

  useEffect(() => {
    setProfileForm(prev => ({
      ...prev,
      name: data.user?.name || '',
      biometricsEnabled: data.user?.biometricsEnabled || false
    }));
  }, [data.user?.name, data.user?.biometricsEnabled]);
  
  const touchStart = useRef({ x: 0, y: 0 });


  const hashString = async (str: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleUpdateProfile = async () => {
    if (profileForm.pin) {
      if (!isOldPinVerified) {
        if (data.user?.pinHash) {
          const legacyHash = await hashString(profileForm.oldPin);
          if (legacyHash !== data.user.pinHash) {
            showAlert("Current PIN is incorrect.", "Error");
            return;
          }
        } else if (data.user?.pin && profileForm.oldPin !== data.user.pin) {
          showAlert("Current PIN is incorrect.", "Error");
          return;
        }
      }

      if (profileForm.pin.length !== 4 || !/^\d+$/.test(profileForm.pin)) {
        showAlert("PIN must be exactly 4 digits.", "Error");
        return;
      }
      if (profileForm.pin !== profileForm.confirmPin) {
        showAlert("PINs do not match!", "Error");
        return;
      }

      if (!data.user?.recoveryKeyHash) {
        const randomKey = Array.from(crypto.getRandomValues(new Uint8Array(8)))
          .map(b => b.toString(16).padStart(2, '0').toUpperCase())
          .join('-');
        setGeneratedKey(randomKey);
        setSetupStep('recovery');
        return;
      }
    }

    const hashedPin = profileForm.pin ? await hashString(profileForm.pin) : data.user?.pinHash;
    const updatedUser = {
      ...data.user!,
      name: profileForm.name,
      pinHash: hashedPin,
      biometricsEnabled: profileForm.biometricsEnabled
    };

    if (updatedUser && 'pin' in updatedUser) delete (updatedUser as { pin?: string }).pin;
    updateUser(updatedUser);

    const hadPinChange = !!profileForm.pin;

    setProfileForm(prev => ({ ...prev, oldPin: '', pin: '', confirmPin: '' }));
    setIsOldPinVerified(false);
    setShowOldPin(false);
    setShowPin(false);
    setShowConfirmPin(false);

    if (hadPinChange) {
      setConfirmConfig({
        title: "Success",
        message: "Profile and Security settings updated. Please unlock with your new PIN.",
        confirmLabel: "OK",
        isAlert: true,
        onConfirm: () => {
          setConfirmConfig(null);
          setAuthenticated(false);
        }
      });
    } else {
      showAlert("Profile settings updated successfully.", "Success");
    }
  };

  const handleBiometricVerify = async () => {
    // If already verified, clicking again now acts as a 'reset/cancel'
    if (isOldPinVerified) {
      setIsOldPinVerified(false);
      setProfileForm(prev => ({ ...prev, oldPin: '', pin: '', confirmPin: '' }));
      return;
    }

    if (!data.user?.biometricsEnabled) return;

    if (Capacitor.isNativePlatform()) {
      try {
        const result = await NativeBiometric.isAvailable();
        if (result.isAvailable) {
          const verified = await NativeBiometric.verifyIdentity({
            reason: 'authorize PIN change',
            title: 'Security Verification',
            subtitle: 'Confirm identity to reset PIN',
            description: 'Use your fingerprint or FaceID to authorize this change.',
          }).then(() => true).catch(() => false);

          if (verified) {
            setIsOldPinVerified(true);
            return;
          }
        }
      } catch (err) {
        console.error('Biometric verification failed:', err);
      }
    } else {
      // Simulation for Browser
      setConfirmConfig({
        title: "Simulation",
        message: "Simulate Biometric Verification?",
        onConfirm: () => {
          setIsOldPinVerified(true);
          setConfirmConfig(null);
        }
      });
    }
  };

  const finalizeSetupWithKey = async () => {
    if (!hasConfirmedKey) {
      showAlert("Please confirm you have saved your recovery key.", "Warning");
      return;
    }

    const keyHash = await hashString(generatedKey);
    const pinHash = await hashString(profileForm.pin);

    updateUser({
      ...data.user!,
      name: profileForm.name,
      pinHash: pinHash,
      recoveryKeyHash: keyHash,
      biometricsEnabled: profileForm.biometricsEnabled
    });

    setSetupStep('form');
    setGeneratedKey('');
    setProfileForm(prev => ({ ...prev, oldPin: '', pin: '', confirmPin: '' }));
    
    setConfirmConfig({
      title: "Success",
      message: "Security setup complete! Please unlock with your new PIN.",
      confirmLabel: "OK",
      isAlert: true,
      onConfirm: () => {
        setConfirmConfig(null);
        setAuthenticated(false);
      }
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const url = reader.result as string;
        const img = new Image();
        img.onload = () => {
          setImgIsLandscape(img.width > img.height);
          setTempImage(url);
          setIsCropperOpen(true);
          setScale(1);
          setPosition({ x: 0, y: 0 });
        };
        img.src = url;
      };
      reader.readAsDataURL(file);
    }
  };


  const saveCroppedImage = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx || !tempImage) return;

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, 400, 400);
      const size = Math.min(img.width, img.height);
      const drawWidth = (img.width / size) * 400 * scale;
      const drawHeight = (img.height / size) * 400 * scale;
      const drawX = 200 - (drawWidth / 2) + (position.x * (400 / 300));
      const drawY = 200 - (drawHeight / 2) + (position.y * (400 / 300));

      ctx.save();
      ctx.beginPath();
      ctx.arc(200, 200, 200, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      ctx.restore();

      updateUser({
        ...data.user!,
        profileImage: canvas.toDataURL('image/jpeg', 0.8)
      });
      setIsCropperOpen(false);
      setTempImage(null);
    };
    img.src = tempImage;
  };

  const removeProfileImage = () => {
    setConfirmConfig({
      title: "Remove Photo?",
      message: "Are you sure you want to remove your profile picture?",
      confirmLabel: "Remove",
      onConfirm: () => {
        updateUser({
          ...data.user!,
          profileImage: undefined
        });
        setConfirmConfig(null);
      }
    });
  };

  const handleAdd = () => {
    const trimmed = newCat.trim();
    if (trimmed && !data.categories.includes(trimmed)) {
      // NOTE for future AI models: New categories must ALWAYS be added before 'Other/Misc'
      // so 'Other/Misc' remains at the very bottom of the list.
      const updatedCats = [...data.categories];
      const miscIndex = updatedCats.findIndex(c => c.toLowerCase() === 'other/misc');
      if (miscIndex !== -1) {
        updatedCats.splice(miscIndex, 0, trimmed);
      } else {
        updatedCats.push(trimmed);
      }
      updateCategories(updatedCats);
      setNewCat('');
    }
  };

  const handleRemove = (cat: string) => {
    setConfirmConfig({
      title: "Delete Category?",
      message: `Are you sure you want to delete the category "${cat}"?`,
      confirmLabel: "Delete",
      onConfirm: () => {
        updateCategories(data.categories.filter(c => c !== cat));
        setConfirmConfig(null);
      }
    });
  };

  const handleAddAccountType = () => {
    const trimmed = newAccountType.trim();
    const existingTypes = ['bank_account', 'credit_card', 'debit_card', 'e_wallet', 'stocks', 'sips', 'cash', ...(data.customAccountTypes || [])];
    if (trimmed && !existingTypes.some(type => type.toLowerCase() === trimmed.toLowerCase())) {
      updateCustomAccountTypes([...(data.customAccountTypes || []), trimmed]);
      setNewAccountType('');
    }
  };

  const handleRemoveAccountType = (accountType: string) => {
    const isInUse = data.accounts.some(acc => acc.type === accountType);
    if (isInUse) {
      showAlert(`"${accountType}" is already used by an account and cannot be deleted yet.`, "In Use");
      return;
    }
    setConfirmConfig({
      title: "Delete Account Type?",
      message: `Are you sure you want to delete the account type "${accountType}"?`,
      confirmLabel: "Delete",
      isDanger: true,
      onConfirm: () => {
        updateCustomAccountTypes((data.customAccountTypes || []).filter(type => type !== accountType));
        setConfirmConfig(null);
      }
    });
  };

  const handleAddTag = () => {
    const raw = newTagEntry.trim().replace(/^#/, '');
    if (raw && !(data.tags || []).includes(raw)) {
      updateTags([...(data.tags || []), raw]);
      setNewTagEntry('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    const usedByTxCount = data.transactions.filter(t => (t.tags || []).includes(tag)).length;
    setConfirmConfig({
      title: "Delete Tag?",
      message: usedByTxCount > 0
        ? `"#${tag}" is used on ${usedByTxCount} transaction${usedByTxCount > 1 ? 's' : ''}. It will be removed from those transactions too. Delete anyway?`
        : `Are you sure you want to delete the tag "#${tag}"?`,
      confirmLabel: "Delete",
      isDanger: usedByTxCount > 0,
      onConfirm: () => {
        updateTags((data.tags || []).filter(t => t !== tag));
        if (usedByTxCount > 0) {
          data.transactions
            .filter(t => (t.tags || []).includes(tag))
            .forEach(t => updateTransaction({ ...t, tags: (t.tags || []).filter(tg => tg !== tag) }));
        }
        setConfirmConfig(null);
      }
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (targetIdx: number) => {
    if (draggedIdx === null || draggedIdx === targetIdx) return;
    const newCategories = [...data.categories];
    const [moved] = newCategories.splice(draggedIdx, 1);
    newCategories.splice(targetIdx, 0, moved);
    
    // NOTE for future AI models: Ensure 'Other/Misc' is always at the end
    const miscIndex = newCategories.findIndex(c => c.toLowerCase() === 'other/misc');
    if (miscIndex !== -1 && miscIndex !== newCategories.length - 1) {
      const [misc] = newCategories.splice(miscIndex, 1);
      newCategories.push(misc);
    }

    updateCategories(newCategories);
    setDraggedIdx(null);
  };

  const handleTouchStart = (idx: number, e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    if (reorderTimer.current) clearTimeout(reorderTimer.current);
    reorderTimer.current = window.setTimeout(() => {
      setDraggedIdx(idx);
      if (navigator.vibrate) navigator.vibrate(40);
    }, 400);
  };

  const handleTouchMove = (idx: number, e: React.TouchEvent) => {
    if (draggedIdx === null) {
      if (Math.abs(e.touches[0].clientY - touchStartY.current) > 10) {
        if (reorderTimer.current) {
          clearTimeout(reorderTimer.current);
          reorderTimer.current = null;
        }
      }
      // If we're not dragging, don't preventDefault or update state for vertical moves
      return;
    }

    e.preventDefault();
    const currentY = e.touches[0].clientY;
    const diff = currentY - touchStartY.current;
    const rowHeight = 54;

    if (diff > rowHeight && idx < data.categories.length - 1) {
      const newArr = [...data.categories];
      const [m] = newArr.splice(idx, 1);
      newArr.splice(idx + 1, 0, m);
      updateCategories(newArr);
      setDraggedIdx(idx + 1);
      touchStartY.current = currentY;
    } else if (diff < -rowHeight && idx > 0) {
      const newArr = [...data.categories];
      const [m] = newArr.splice(idx, 1);
      newArr.splice(idx - 1, 0, m);
      updateCategories(newArr);
      setDraggedIdx(idx - 1);
      touchStartY.current = currentY;
    }
  };

  // ── Backup / Restore state ──────────────────────────────────────────────
  const importFileRef = useRef<HTMLInputElement>(null);
  const [exportStatus, setExportStatus] = useState<{ fileName: string; sizeKb: string } | null>(null);
  const [importPreview, setImportPreview] = useState<{ txCount: number; accountCount: number; sizeKb: string; raw: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const advancedSectionRef = useRef<HTMLDivElement>(null);

  // Commodity prices (Gemini, BYOK) — each user supplies their own key; stored in the OS keystore.
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [geminiVendorInput, setGeminiVendorInput] = useState('');
  const [geminiKeySaved, setGeminiKeySaved] = useState(false);
  const [geminiUsage, setGeminiUsage] = useState<{ count: number; cap: number }>({ count: 0, cap: 30 });

  useEffect(() => {
    (async () => {
      setGeminiVendorInput(getCommodityVendor());
      setGeminiKeySaved(await hasGeminiKey());
      setGeminiUsage(getGeminiUsageToday());
    })();
  }, []);

  const handleSaveGemini = async () => {
    try {
      setCommodityVendor(geminiVendorInput);
      if (geminiKeyInput.trim()) {
        await setGeminiKey(geminiKeyInput.trim());
        setGeminiKeyInput('');
      }
      setGeminiKeySaved(await hasGeminiKey());
      showAlert('Saved. Your Gemini key is stored in the device keystore, not in the app.', 'Commodity Prices');
    } catch {
      showAlert('Could not save the key to secure storage. Make sure your device has a screen lock (PIN/biometric) enabled.', 'Secure Storage Error');
    }
  };

  const handleClearGemini = async () => {
    await clearGeminiKey();
    setGeminiKeyInput('');
    setGeminiKeySaved(false);
    showAlert('Gemini key removed. Set a manual ₹/g on each commodity account, or re-add a key.', 'Commodity Prices');
  };

  const BACKUP_VERSION = 1;

  // ── Key Mapping for Minification ─────────────────────────────────────────
  const KEY_MAP: Record<string, string> = {
    // Root keys
    version: 'v', exportedAt: 't', user: 'u', accounts: 'A', transactions: 'T',
    categories: 'C', tags: 'tg', customAccountTypes: 'X', cashbackStatements: 'S',
    splitEvents: 'E', recurringBills: 'R', theme: 'm', debts: 'H',
    // User fields
    email: 'ue', profileImage: 'upi', pinHash: 'uph', recoveryKeyHash: 'urk',
    biometricsEnabled: 'ube', autoLogSms: 'uas', enablePassiveTransactions: 'uep',
    // Object keys (Accounts/Transactions/Debts)
    id: 'i', amount: 'a', date: 'd', description: 's', type: 'y',
    accountId: 'x', category: 'k', excludeFromStats: 'e', excludedAmount: 'ea', 
    rewardUsed: 'r', rewardUsedAccountId: 'w', isTravelTransaction: 'l', 
    rewardEarned: 're', rewardEarnedType: 'ret', rewardEarnedAccountId: 'rea',
    order: 'or', linkedTransactionId: 'lt', linkedTransactionIds: 'lts',
    cashbackLevelId: 'cl', linkedTxId: 'lx',
    appliedBillingCycleYearMonth: 'abc', recurringBillId: 'rbid',
    paymentSourceAccountId: 'psid', ccPaymentCycleTarget: 'ctar', isCCPaymentRecord: 'iscr',
    isRecurring: 'isrc', transactionId: 'txid', expectedCashback: 'exc',
    name: 'n', balance: 'b', color: 'c', icon: 'o', isNcmcEnabled: 'z', 
    openingBalances: 'ob', statementDay: 'sd', dueDay: 'dd',
    defaultCashbackRate: 'dr', cashbackRates: 'cr', roundOffCashback: 'ro',
    cashbackCreditCycle: 'cc', travelOpeningBalances: 'tob', statementRounding: 'sr',
    isCashbackEnabled: 'ice',
    cardDetails: 'D', cardholderName: 'ch', cardNumber: 'cn', rate: 'rt',
    expiryMonth: 'em', expiryYear: 'ey', cvv: 'cv', network: 'nt',
    // Hub / SplitEvent / SplitItem keys
    people: 'pp', items: 'it', involvedPeople: 'ip', includeMe: 'im',
    splitType: 'st', paidBy: 'pb', shares: 'sh', customDays: 'cd',
    personName: 'pn', frequency: 'fq', nextDueDate: 'nd',
    isActive: 'ia', status: 'ss', createdAt: 'ca', updatedAt: 'ua',
    billingCycleYearMonth: 'bc', expected: 'ex', realized: 'rl',
    confirmed: 'cf', realizedIntoAccountId: 'ri', paidPeople: 'pd',
    // RecurringBill keys
    lastPaidDate: 'lpd',
    // New fields for custom reward points and balances
    balanceAdjustments: 'ba', travelBalanceAdjustments: 'tba',
    balanceEditHistory: 'beh', editedAt: 'eat', monthKey: 'mk', previousBalance: 'prb', newBalance: 'nwb',
    rewardType: 'ryt', rewardUnit: 'ryu', pointsConversionRate: 'pcr',
    rewardOpeningBalances: 'rob', rewardBalanceAdjustments: 'rba',
    isRewardTransaction: 'irt', cashbackDestinationAccountId: 'cda',
    // New fields for tours, sips, recurring splits, and debts
    sipAllottedAmount: 'saa', sipCharges: 'sc',
    hasSeenTour: 'hst', hasSeenFeatureTours: 'hsft',
    cycles: 'cy', currentCycleId: 'cci', cycleStartDate: 'csd',
    cycleNumber: 'cnm', startDate: 'sdt', endDate: 'edt', carriedOverPeople: 'cop',
    markedDone: 'md', linkedSipAccountId: 'lsa',
    // Stocks / SIPs / Commodity investment fields
    numberOfShares: 'ns', marketSymbol: 'ms', investedValue: 'iv', commodityMetal: 'cm',
  };

  const minifyPayload = (obj: any): any => {
    if (Array.isArray(obj)) return obj.map(minifyPayload);
    if (obj !== null && typeof obj === 'object') {
      const minified: any = {};
      for (const key in obj) {
        const newKey = KEY_MAP[key] || key;
        minified[newKey] = minifyPayload(obj[key]);
      }
      return minified;
    }
    return obj;
  };

  const expandPayload = (obj: any): any => {
    const REVERSE_MAP = Object.fromEntries(Object.entries(KEY_MAP).map(([k, v]) => [v, k]));
    if (Array.isArray(obj)) return obj.map(expandPayload);
    if (obj !== null && typeof obj === 'object') {
      const expanded: any = {};
      for (const key in obj) {
        const originalKey = REVERSE_MAP[key] || key;
        expanded[originalKey] = expandPayload(obj[key]);
      }
      return expanded;
    }
    return obj;
  };

  const buildExportPayload = () => ({
    version: BACKUP_VERSION,
    exportedAt: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
    user: data.user,
    accounts: data.accounts,
    transactions: data.transactions,
    categories: data.categories || [],
    tags: data.tags || [],
    customAccountTypes: data.customAccountTypes || [],
    cashbackStatements: data.cashbackStatements || [],
    splitEvents: data.splitEvents || [],
    recurringBills: data.recurringBills || [],
    debts: data.debts || [],
    theme: data.theme,
  });

  const validateBackup = (parsed: any): string | null => {
    if (typeof parsed !== 'object' || parsed === null) return 'File is not a valid JSON object.';
    if (!Array.isArray(parsed.accounts)) return 'Missing or invalid \'accounts\' field.';
    if (!Array.isArray(parsed.transactions)) return 'Missing or invalid \'transactions\' field.';
    if (parsed.version !== undefined && typeof parsed.version !== 'number') return 'Invalid version field.';
    for (const tx of parsed.transactions) {
      if (!tx.id || typeof tx.amount !== 'number' || !tx.date || !tx.type) {
        return 'One or more transactions have missing required fields (id, amount, date, type).';
      }
    }
    return null;
  };

  // On Android we NEVER write to Directory.External (requires WRITE_EXTERNAL_STORAGE,
  // blocked by scoped storage on Android 10+). Instead we write to Directory.Cache
  // (no permissions needed) and open the OS Share sheet so the user can save to
  // Downloads, Google Drive, WhatsApp, etc. Web uses a plain <a download> trigger.
  const buildFileAndShare = async () => {
    const payload = buildExportPayload();
    const json = JSON.stringify(payload, null, 2);
    const today = format(new Date(), 'yyyy-MM-dd');
    const fileName = `spendvault_backup_${today}.json`;
    const sizeKb = (new Blob([json]).size / 1024).toFixed(1);
    return { json, fileName, sizeKb };
  };

  const exportBackup = async (isSharing: boolean = false) => {
    try {
      const { json, fileName, sizeKb } = await buildFileAndShare();

      if (Capacitor.isNativePlatform()) {
        // Request storage permissions explicitly
        const perm = await Filesystem.requestPermissions();
        
        if (perm.publicStorage === 'denied') {
          showAlert('Storage permission is permanently denied. Please enable it in App Settings to save files.', 'Permission Required');
          return;
        }
        
        if (!isSharing) {
          // Direct Save attempt (Documents folder)
          try {
            await Filesystem.writeFile({
              path: fileName,
              data: json,
              directory: Directory.Documents,
              encoding: Encoding.UTF8,
            });
            showAlert(`Backup successfully saved to your device's Documents folder:\n\n${fileName}`, 'Backup Saved');
            setExportStatus({ fileName, sizeKb });
            return;
          } catch (e) {
            console.warn('Direct save to Documents failed, falling back to share sheet', e);
          }
        }

        // Share Sheet flow (used for "Share Directly" or as fallback for "Save")
        const result = await Filesystem.writeFile({
          path: fileName,
          data: json,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });

        await Share.share({
          url: result.uri,
          // We provide ONLY the URL here to trigger the "File" handler in Android
          // instead of the "Social Share" handler.
        });
        setExportStatus({ fileName, sizeKb });
      } else {
        // Web: trigger browser download directly
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        setExportStatus({ fileName, sizeKb });
      }
    } catch (err: any) {
      // User cancelled the share sheet — not a real error
      if (err?.message?.includes('cancel') || err?.errorMessage?.includes('cancel')) return;
      console.error('Export failed:', err);
      showAlert('Export failed. Please try the clipboard fallback below.', 'Export Failed');
    }
  };

  // "Share Directly" re-uses the same flow


  const handleFileImportPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportPreview(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const sizeKb = (file.size / 1024).toFixed(1);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const parsed = JSON.parse(text);
        const err = validateBackup(parsed);
        if (err) { setImportError(err); return; }
        setImportPreview({
          txCount: parsed.transactions.length,
          accountCount: parsed.accounts.length,
          sizeKb,
          raw: text,
        });
      } catch {
        setImportError('Could not parse file. Make sure it is a valid SpendVault backup.');
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const confirmImport = () => {
    if (!importPreview) return;
    setConfirmConfig({
      title: "Confirm Restore",
      message: `This will replace ALL current data with ${importPreview.txCount} transactions across ${importPreview.accountCount} accounts. Continue?`,
      confirmLabel: "Restore Data",
      isDanger: true,
      onConfirm: () => {
        try {
          const parsed = JSON.parse(importPreview.raw);
          localStorage.setItem('minimalist_finance_data_v1', JSON.stringify(parsed));
          window.location.reload();
        } catch {
          showAlert('Restore failed. The file may be corrupted.', 'Error');
        }
        setConfirmConfig(null);
      }
    });
  };

  // Aggressive compression for clipboard fallback
  const handleCopyBackup = () => {
    const payload = buildExportPayload();
    
    // 1. First pass: Collect all unique IDs to map them to tiny tokens
    const idMap: Record<string, string> = {};
    let idCounter = 0;
    
    const getTinyId = (original: any) => {
      if (typeof original !== 'string' || original.length < 8) return original;
      if (!idMap[original]) {
        idMap[original] = (idCounter++).toString(36); // "0", "1", ... "a", "b", etc.
      }
      return idMap[original];
    };

    // 2. Process transactions aggressively
    const minifiedTxs = payload.transactions.map(t => {
      const min = minifyPayload(t);
      if (min.i) min.i = getTinyId(min.i);
      if (min.x) min.x = getTinyId(min.x);
      if (min.w) min.w = getTinyId(min.w);
      if (min.rea) min.rea = getTinyId(min.rea);
      if (min.ri) min.ri = getTinyId(min.ri);
      if (min.lts) min.lts = min.lts.map(getTinyId);
      if (min.lt) min.lt = getTinyId(min.lt);
      if (min.psid) min.psid = getTinyId(min.psid);
      if (min.rbid) min.rbid = getTinyId(min.rbid);
      if (min.d && min.d.length === 10) {
        min.d = min.d.replace(/-/g, '').substring(2);
      }
      return min;
    });

     // 3. Process accounts
    const minifiedAccs = payload.accounts.map(a => {
      const min = minifyPayload(a);
      if (min.i) min.i = getTinyId(min.i);
      if (min.cda) min.cda = getTinyId(min.cda);
      return min;
    });

    // 4. Process debts
    const minifiedDebts = (payload.debts || []).map(d => {
      const min = minifyPayload(d);
      if (min.i) min.i = getTinyId(min.i);
      if (min.T) { // Transactions array in Debt
        min.T = min.T.map((dt: any) => {
          if (dt.i) dt.i = getTinyId(dt.i);
          if (dt.lx) dt.lx = getTinyId(dt.lx);
          if (dt.d && dt.d.length === 10) {
            dt.d = dt.d.replace(/-/g, '').substring(2);
          }
          return dt;
        });
      }
      return min;
    });

    // 5. Process recurring bills
    const minifiedBills = (payload.recurringBills || []).map(b => {
      const min = minifyPayload(b);
      if (min.i) min.i = getTinyId(min.i);
      if (min.x) min.x = getTinyId(min.x);
      if (min.lsa) min.lsa = getTinyId(min.lsa);
      return min;
    });

    // 6. Process split events
    const minifiedSplits = (payload.splitEvents || []).map(se => {
      const min = minifyPayload(se);
      if (min.i) min.i = getTinyId(min.i);
      if (min.cci) min.cci = getTinyId(min.cci);
      if (min.cy) {
        min.cy = min.cy.map((c: any) => {
          if (c.i) c.i = getTinyId(c.i);
          return c;
        });
      }
      return min;
    });

    const finalMinified = {
      ...minifyPayload(payload),
      T: minifiedTxs,
      A: minifiedAccs,
      H: minifiedDebts,
      R: minifiedBills,
      E: minifiedSplits,
      _m: idMap // Include the map for reconstruction
    };

    const json = JSON.stringify(finalMinified);
    const base64Data = btoa(unescape(encodeURIComponent(json)));
    
    // Format: SV_ULTRA_[BASE64]_END
    const finalCode = `SV_ULTRA_${base64Data}_END`;
    
    navigator.clipboard.writeText(finalCode).then(() => {
      showAlert(`Ultra-compressed backup code copied (${(finalCode.length / 1024).toFixed(1)} KB).`, 'Success');
    }).catch(() => {
      navigator.clipboard.writeText(finalCode);
      showAlert('Data copied to clipboard.', 'Success');
    });
  };

  const handleClipboardImport = (text: string) => {
    let input = text.trim();
    if (!input) return;

    setConfirmConfig({
      title: "Restore from Clipboard",
      message: "This will overwrite your current data with the backup code provided. Continue?",
      confirmLabel: "Restore",
      onConfirm: () => {
        try {
          let jsonToParse = '';

          // Check if it's our new protocol
          if (input.startsWith('SV_ULTRA_')) {
            const parts = input.split('_');
            const base64 = parts[2];
            const marker = parts[3];
            if (marker !== 'END') {
              showAlert('Backup code is incomplete. The _END marker is missing.', 'Integrity Error');
              return;
            }
            const json = decodeURIComponent(escape(atob(base64)));
            const ultra = JSON.parse(json);
            
            // Reconstruction pass
            const revMap = Object.fromEntries(Object.entries(ultra._m || {}).map(([k, v]) => [v, k]));
            const expandId = (tiny: any) => (typeof tiny === 'string' && revMap[tiny]) ? revMap[tiny] : tiny;
            const expandDate = (d: any) => {
              if (typeof d === 'string' && d.length === 6) {
                return `20${d.substring(0, 2)}-${d.substring(2, 4)}-${d.substring(4, 6)}`;
              }
              return d;
            };
            
            const expanded = expandPayload(ultra);
            expanded.transactions = (expanded.transactions || []).map((t: any) => {
              if (t.id) t.id = expandId(t.id);
              if (t.accountId) t.accountId = expandId(t.accountId);
              if (t.rewardUsedAccountId) t.rewardUsedAccountId = expandId(t.rewardUsedAccountId);
              if (t.rewardEarnedAccountId) t.rewardEarnedAccountId = expandId(t.rewardEarnedAccountId);
              if (t.linkedTransactionIds) t.linkedTransactionIds = t.linkedTransactionIds.map(expandId);
              if (t.linkedTransactionId) t.linkedTransactionId = expandId(t.linkedTransactionId);
              if (t.paymentSourceAccountId) t.paymentSourceAccountId = expandId(t.paymentSourceAccountId);
              if (t.recurringBillId) t.recurringBillId = expandId(t.recurringBillId);
              if (t.date) t.date = expandDate(t.date);
              return t;
            });
            expanded.accounts = (expanded.accounts || []).map((a: any) => {
              if (a.id) a.id = expandId(a.id);
              if (a.cashbackDestinationAccountId) a.cashbackDestinationAccountId = expandId(a.cashbackDestinationAccountId);
              return a;
            });
            expanded.debts = (expanded.debts || []).map((d: any) => {
              if (d.id) d.id = expandId(d.id);
              if (d.transactions) {
                d.transactions = d.transactions.map((dt: any) => {
                  if (dt.id) dt.id = expandId(dt.id);
                  if (dt.linkedTxId) dt.linkedTxId = expandId(dt.linkedTxId);
                  if (dt.date) dt.date = expandDate(dt.date);
                  return dt;
                });
              }
              return d;
            });
            expanded.recurringBills = (expanded.recurringBills || []).map((b: any) => {
              if (b.id) b.id = expandId(b.id);
              if (b.accountId) b.accountId = expandId(b.accountId);
              if (b.linkedSipAccountId) b.linkedSipAccountId = expandId(b.linkedSipAccountId);
              return b;
            });
            expanded.splitEvents = (expanded.splitEvents || []).map((se: any) => {
              if (se.id) se.id = expandId(se.id);
              if (se.currentCycleId) se.currentCycleId = expandId(se.currentCycleId);
              if (se.cycles) {
                se.cycles = se.cycles.map((c: any) => {
                  if (c.id) c.id = expandId(c.id);
                  return c;
                });
              }
              return se;
            });
            delete (expanded as any)._m;
            jsonToParse = JSON.stringify(expanded);
          } else if (input.startsWith('SV_BKP_')) {
            const parts = input.split('_');
            const expectedLen = parseInt(parts[2]);
            const base64 = parts[3];
            const marker = parts[4];

            if (marker !== 'END' || base64.length !== expectedLen) {
              showAlert('Backup code is incomplete or corrupted. Make sure you copied the entire string including the _END at the end.', 'Integrity Error');
              return;
            }
            jsonToParse = decodeURIComponent(escape(atob(base64)));
            const minifiedObj = JSON.parse(jsonToParse);
            const expandedPayload = expandPayload(minifiedObj);
            jsonToParse = JSON.stringify(expandedPayload);
          } else {
            // Standard JSON or raw Base64 fallback
            if (!input.startsWith('{') && !input.startsWith('[')) {
              try { input = decodeURIComponent(escape(atob(input))); } catch { /* not base64 */ }
            }
            jsonToParse = input;
          }

          const parsed = JSON.parse(jsonToParse);
          const err = validateBackup(parsed);
          if (err) { showAlert(`Invalid backup: ${err}`, 'Import Failed'); return; }
          localStorage.setItem('minimalist_finance_data_v1', JSON.stringify(parsed));
          showAlert('Data imported successfully!', 'Success');
          setTimeout(() => window.location.reload(), 1500);
        } catch {
          showAlert('Import failed. Invalid data format.', 'Error');
        }
        setConfirmConfig(null);
      }
    });
  };

  const [clipboardText, setClipboardText] = useState('');

  const isEditingPin = profileForm.oldPin !== '' || profileForm.pin !== '' || profileForm.confirmPin !== '' || isOldPinVerified;
  const isPinFormComplete =
    (!isEditingPin) ||
    ((isOldPinVerified || profileForm.oldPin.length === 4) &&
     profileForm.pin.length === 4 &&
     profileForm.confirmPin.length === 4);

  const hasProfileChanges =
    isPinFormComplete && (
      profileForm.name !== (data.user?.name || '') ||
      profileForm.biometricsEnabled !== (data.user?.biometricsEnabled || false) ||
      (profileForm.pin !== '' && profileForm.pin.length === 4 && profileForm.confirmPin.length === 4)
    );

  let viewContent;

  if (activeView === 'categories') {
    viewContent = (
      <SubviewWrapper title="Categories" onBack={() => setActiveView('main')}>
        <div className="card card-static flex-col gap-4">
          <SettingsCardHeader icon={Tags} title="Transaction Categories" level="h3" size={20} marginBottom="0.5rem" />
          <p className="text-muted text-sm">Customize categorization for your spending tracking.</p>
          <div className="flex-col gap-2">
            {data.categories.map((c, idx) => (
              <div
                key={c}
                className="flex justify-between align-center"
                draggable={!Capacitor.isNativePlatform()}
                onDragStart={() => setDraggedIdx(idx)}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(idx)}
                onDragEnd={() => setDraggedIdx(null)}
                style={{
                  padding: '0.75rem 1rem',
                  background: 'var(--bg-color)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  cursor: 'move',
                  opacity: draggedIdx === idx ? 0.4 : 1,
                  transition: 'background 0.2s',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  width: '100%',
                  position: 'relative'
                }}
              >
                <div className="flex align-center gap-3" style={{ flex: 1 }}>
                  <div 
                    style={{ padding: '0.5rem', margin: '-0.5rem', cursor: 'grab', display: 'flex', alignItems: 'center' }}
                    onTouchStart={e => handleTouchStart(idx, e)}
                    onTouchMove={e => handleTouchMove(idx, e)}
                    onContextMenu={e => e.preventDefault()}
                    onTouchEnd={() => {
                      if (reorderTimer.current) clearTimeout(reorderTimer.current);
                      setDraggedIdx(null);
                    }}
                  >
                    <GripVertical size={18} className="text-muted" />
                  </div>
                  <span className="text-sm font-bold">{c}</span>
                </div>
                <button className="text-danger" style={{ background: 'none', border: 'none', padding: 0 }} onClick={() => handleRemove(c)}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2" style={{ marginTop: '0.5rem' }}>
            <input className="input-field" style={{ flex: 1 }} value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New Category" onKeyDown={e => e.key === 'Enter' && handleAdd()} />
            <button className="btn btn-primary" style={{ minWidth: '54px', padding: '0.75rem' }} onClick={handleAdd} aria-label="Add Category"><Plus size={20} /></button>
          </div>
        </div>
      </SubviewWrapper>
    );
  } else if (activeView === 'accountTypes') {
    viewContent = (
      <SubviewWrapper title="Account Types" onBack={() => setActiveView('main')}>
        <div className="card flex-col gap-4">
          <SettingsCardHeader icon={Database} title="Custom Account Types" level="h3" size={20} marginBottom="0.5rem" />
          <p className="text-muted text-sm">Add your own account type labels to use while creating accounts, like wallet or prepaid card.</p>
          <div className="flex-col gap-2">
            {(data.customAccountTypes || []).length === 0 ? (
              <div className="text-sm text-muted" style={{ padding: '0.75rem 0' }}>No custom account types yet.</div>
            ) : (
              (data.customAccountTypes || []).map(type => (
                <div
                  key={type}
                  className="flex justify-between align-center"
                  style={{
                    padding: '0.75rem 1rem',
                    background: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px'
                  }}
                >
                  <div className="flex align-center gap-3">
                    <span style={{ fontSize: '1rem' }}>💼</span>
                    <span className="text-sm font-bold">{type}</span>
                  </div>
                  <button className="text-danger" style={{ background: 'none', border: 'none', padding: 0 }} onClick={() => handleRemoveAccountType(type)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2" style={{ marginTop: '0.5rem' }}>
            <input className="input-field" style={{ flex: 1 }} value={newAccountType} onChange={e => setNewAccountType(e.target.value)} placeholder="New Account Type" onKeyDown={e => e.key === 'Enter' && handleAddAccountType()} />
            <button className="btn btn-primary" style={{ minWidth: '54px', padding: '0.75rem' }} onClick={handleAddAccountType} aria-label="Add Account Type"><Plus size={20} /></button>
          </div>
        </div>
      </SubviewWrapper>
    );
  } else if (activeView === 'tags') {
    viewContent = (
      <SubviewWrapper title="Tags" onBack={() => setActiveView('main')}>
        <div className="card flex-col gap-4">
          <SettingsCardHeader icon={Hash} title="Bucket Tags" level="h3" size={20} marginBottom="0.5rem" />
          <p className="text-muted text-sm">Tags let you group expenses across categories for buckets or events like #Vacation2024 or #WeddingDec.</p>
          <div className="flex-col gap-2">
            {(data.tags || []).length === 0 ? (
              <div className="text-sm text-muted" style={{ padding: '0.75rem 0' }}>No tags yet. Create your first tag below.</div>
            ) : (
              (data.tags || []).map(tag => {
                const useCount = data.transactions.filter(t => (t.tags || []).includes(tag)).length;
                return (
                  <div
                    key={tag}
                    className="flex justify-between align-center"
                    style={{ padding: '0.75rem 1rem', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                  >
                    <div className="flex align-center gap-3">
                      <span className="tag-pill" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>#{tag}</span>
                      {useCount > 0 && <span className="text-xs text-muted">{useCount} transaction{useCount !== 1 ? 's' : ''}</span>}
                    </div>
                    <button className="text-danger" style={{ background: 'none', border: 'none', padding: 0 }} onClick={() => handleRemoveTag(tag)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex gap-2" style={{ marginTop: '0.5rem' }}>
            <input
              className="input-field"
              style={{ flex: 1 }}
              value={newTagEntry}
              onChange={e => setNewTagEntry(e.target.value)}
              placeholder="New tag (e.g. Vacation2024)"
              onKeyDown={e => e.key === 'Enter' && handleAddTag()}
            />
            <button className="btn btn-primary" style={{ minWidth: '54px', padding: '0.75rem' }} onClick={handleAddTag} aria-label="Add Tag"><Plus size={20} /></button>
          </div>
        </div>
      </SubviewWrapper>
    );
  } else if (activeView === 'theme') {
    viewContent = (
      <SubviewWrapper title="Theme Settings" onBack={() => setActiveView('main')}>
        <div className="flex-col gap-6">
          <div className="card flex-col gap-4">
            <SettingsCardHeader icon={Moon} title="Appearance" />
            <p className="text-muted text-sm">choose how spendvault looks on your device.</p>

            <div className="flex-col gap-3">
              <div
                className="flex justify-between align-center"
                onClick={() => setTheme('dark')}
                style={{
                  padding: '1rem', background: data.theme === 'dark' ? 'var(--bg-hover)' : 'var(--bg-color)',
                  borderRadius: '12px', border: `1px solid ${data.theme === 'dark' ? 'var(--accent)' : 'var(--border-color)'}`,
                  cursor: 'pointer', transition: '0.2s'
                }}
              >
                <div className="flex align-center gap-3">
                  <Moon size={20} className={data.theme === 'dark' ? "text-accent" : "text-muted"} />
                  <div className="flex-col">
                    <span style={{ fontSize: '1rem', fontWeight: 600 }}>Dark Slate</span>
                    <span className="text-xs text-muted">Premium night experience</span>
                  </div>
                </div>
                {data.theme === 'dark' && <Check size={20} className="text-accent" />}
              </div>

              <div
                className="flex justify-between align-center"
                onClick={() => setTheme('light')}
                style={{
                  padding: '1rem', background: data.theme === 'light' ? 'var(--bg-hover)' : 'var(--bg-color)',
                  borderRadius: '12px', border: `1px solid ${data.theme === 'light' ? 'var(--accent)' : 'var(--border-color)'}`,
                  cursor: 'pointer', transition: '0.2s'
                }}
              >
                <div className="flex align-center gap-3">
                  <Sun size={20} className={data.theme === 'light' ? "text-accent" : "text-muted"} />
                  <div className="flex-col">
                    <span style={{ fontSize: '1rem', fontWeight: 600 }}>Light Mist</span>
                    <span className="text-xs text-muted">Crisp and clean design</span>
                  </div>
                </div>
                {data.theme === 'light' && <Check size={20} className="text-accent" />}
              </div>
            </div>
          </div>

          <div className="card flex-col gap-2" style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}>
            <div className="flex align-center" style={{ gap: '0.75rem' }}>
              <Info size={18} />
              <span className="font-bold">Pro Tip</span>
            </div>
            <p className="text-xs" style={{ opacity: 0.9 }}>Light mode is optimized for daylight usage and high-contrast accessibility.</p>
          </div>
        </div>
      </SubviewWrapper>
    );
  } else if (activeView === 'export') {
    viewContent = (
      <SubviewWrapper title="Export Backup" onBack={() => { setActiveView('main'); setExportStatus(null); }}>
        <div className="flex-col gap-4">

          {/* Primary: Download file */}
          <div className="card flex-col gap-4">
            <SettingsCardHeader icon={FileJson} title="Download Backup File" />
            <p className="text-muted text-sm">Saves a <code>.json</code> file to your device's Downloads folder. Import it anytime to restore.</p>

            {exportStatus ? (
              <div className="flex-col gap-3">
                <div style={{ padding: '1rem', background: 'var(--bg-color)', borderRadius: '12px', border: '1px solid var(--success)' }}>
                  <div className="flex align-center gap-2" style={{ marginBottom: '0.4rem' }}>
                    <Check size={16} className="text-success" />
                    <span className="font-bold text-sm" style={{ color: 'var(--success)' }}>Backup saved!</span>
                  </div>
                  <span className="text-xs text-muted" style={{ fontFamily: 'monospace' }}>{exportStatus.fileName}</span>
                  <span className="text-xs text-muted" style={{ display: 'block', marginTop: '0.2rem' }}>{exportStatus.sizeKb} KB</span>
                </div>
                <button className="btn btn-secondary flex align-center justify-center" style={{ padding: '0.9rem' }} onClick={() => exportBackup(true)}>
                  <Share2 size={18} style={backupActionIconStyle} /> Share File
                </button>
                <button className="btn btn-secondary flex align-center justify-center gap-2" style={{ padding: '0.9rem' }} onClick={() => setExportStatus(null)}>
                  Export Again
                </button>
              </div>
            ) : (
              <div className="flex-col gap-3">
                <button className="btn btn-primary flex align-center justify-center" style={{ padding: '1rem' }} onClick={() => exportBackup(false)}>
                  <Download size={20} style={backupActionIconStyle} /> Save to Downloads
                </button>
                <button className="btn btn-secondary flex align-center justify-center" style={{ padding: '0.9rem' }} onClick={() => exportBackup(true)}>
                  <Share2 size={18} style={backupActionIconStyle} /> Share Directly
                </button>
              </div>
            )}
          </div>

          {/* Advanced: Clipboard fallback */}
          <div ref={advancedSectionRef} className="card flex-col gap-3">
            <button
              className="flex justify-between align-center w-100"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
              onClick={() => {
                const willShow = !showAdvanced;
                setShowAdvanced(willShow);
                if (willShow) {
                  setTimeout(() => {
                    advancedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }, 100);
                }
              }}
            >
              <span className="text-xs font-bold uppercase" style={{ letterSpacing: '1px' }}>Advanced (Clipboard)</span>
              <ChevronDown size={16} style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
            </button>
            {showAdvanced && (
              <div className="flex-col gap-2">
                <p className="text-xs text-muted">Legacy option: copies a Base64 backup code to clipboard. Use only if file export is unavailable.</p>
                <button className="btn btn-secondary flex align-center justify-center" style={{ padding: '0.8rem' }} onClick={handleCopyBackup}>
                  <Clipboard size={16} style={backupActionIconStyle} /> Copy to Clipboard
                </button>
              </div>
            )}
          </div>
        </div>
      </SubviewWrapper>
    );
  } else if (activeView === 'import') {
    viewContent = (
      <SubviewWrapper title="Import Data" onBack={() => { setActiveView('main'); setImportPreview(null); setImportError(null); }}>
        <div className="flex-col gap-4">

          {/* Primary: File picker */}
          <div className="card flex-col gap-4">
            <SettingsCardHeader icon={Upload} title="Restore from File" />
            <p className="text-muted text-sm">Select the <code>.json</code> backup file from your device to preview and restore your data.</p>
            <p className="text-xs text-danger font-bold flex align-center" style={{ gap: '0.5rem' }}>
              <AlertTriangle size={14} /> This will replace all current data on this device.
            </p>

            <input
              ref={importFileRef}
              type="file"
              accept="*/*"
              style={{ display: 'none' }}
              onChange={handleFileImportPick}
            />

            {importError && (
              <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.1)', borderRadius: '10px', border: '1px solid #ef4444' }}>
                <span className="text-xs font-bold" style={{ color: '#ef4444' }}>⚠ {importError}</span>
              </div>
            )}

            {importPreview ? (
              <div className="flex-col gap-3">
                <div style={{ padding: '1rem', background: 'var(--bg-color)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                  <span className="text-xs font-bold uppercase text-muted" style={{ letterSpacing: '1px', display: 'block', marginBottom: '0.75rem' }}>Backup Preview</span>
                  <div className="flex-col gap-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">Transactions</span>
                      <span className="font-bold">{importPreview.txCount}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">Accounts</span>
                      <span className="font-bold">{importPreview.accountCount}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">File Size</span>
                      <span className="font-bold">{importPreview.sizeKb} KB</span>
                    </div>
                  </div>
                </div>
                <button className="btn btn-primary flex align-center justify-center" style={{ padding: '1rem', background: 'var(--success)' }} onClick={confirmImport}>
                  <Check size={20} style={backupActionIconStyle} /> Restore This Backup
                </button>
                <button className="btn btn-secondary" style={{ padding: '0.8rem' }} onClick={() => { setImportPreview(null); setImportError(null); }}>
                  Choose Different File
                </button>
              </div>
            ) : (
              <button className="btn btn-primary flex align-center justify-center" style={{ padding: '1rem' }} onClick={() => importFileRef.current?.click()}>
                <Upload size={20} style={backupActionIconStyle} /> Choose Backup File
              </button>
            )}
          </div>

          {/* Advanced: Clipboard paste fallback */}
          <div className="card flex-col gap-3">
            <button
              className="flex justify-between align-center w-100"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
              onClick={() => setShowAdvanced(v => !v)}
            >
              <span className="text-xs font-bold uppercase" style={{ letterSpacing: '1px' }}>Advanced (Paste Code)</span>
              <ChevronDown size={16} style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
            </button>
            {showAdvanced && (
              <div className="flex-col gap-2">
                <p className="text-xs text-muted">Paste a Base64 or JSON backup code if you don't have a file.</p>
                <textarea
                  className="input-field text-xs"
                  style={{ minHeight: '140px', fontFamily: 'monospace', fontSize: '11px', background: 'var(--bg-color)', color: 'var(--text-primary)', padding: '0.75rem' }}
                  placeholder="Paste backup code here..."
                  value={clipboardText}
                  onChange={e => setClipboardText(e.target.value)}
                />
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.8rem' }}
                  onClick={() => handleClipboardImport(clipboardText)}
                  disabled={!clipboardText.trim()}
                >
                  Restore from Code
                </button>
              </div>
            )}
          </div>
        </div>
      </SubviewWrapper>
    );
  } else if (activeView === 'clear') {
    viewContent = (
      <SubviewWrapper title="clear" onBack={() => setActiveView('main')}>
        <div className="card flex-col gap-6" style={{ border: '1px solid #ef4444' }}>
          <SettingsCardHeader icon={AlertTriangle} title="wipe data" level="h3" danger size={24} />
          <button className="btn btn-danger" style={{ background: '#ef4444', color: '#fff', textTransform: 'lowercase' }} onClick={() => {
            setConfirmConfig({
              title: "Delete Everything?",
              message: "Final warning: This will permanently wipe ALL your accounts, transactions, and settings. This cannot be undone.",
              confirmLabel: "Delete Forever",
              onConfirm: () => {
                clearAllData();
                setConfirmConfig(null);
                setActiveView('main');
              }
            });
          }}>delete forever</button>
        </div>
      </SubviewWrapper>
    );
  } else if (activeView === 'help') {
    viewContent = (
      <SubviewWrapper title="help" onBack={() => setActiveView('main')}>
        <div className="card flex-col gap-6">
          <p className="text-sm text-muted">spendvault is an offline-first finance tracker. your data is stored locally on this device.</p>
          <div className="flex-col gap-2">
            <span className="text-xs text-muted font-bold uppercase">support contact</span>
            <a href="mailto:tribhuvankomarla@gmail.com" className="btn btn-secondary flex align-center justify-center gap-2" style={{ textDecoration: 'none' }}>
              <Mail size={16} /> tribhuvankomarla@gmail.com
            </a>
          </div>
        </div>
      </SubviewWrapper>
    );
  } else if (activeView === 'about') {
    viewContent = (
      <SubviewWrapper title="about" onBack={() => setActiveView('main')}>
        <div className="card flex-col align-center gap-6 text-center">
          <div className="flex-col align-center gap-3">
            <div
              className="logo-container"
              style={{ cursor: 'pointer', transition: 'transform 0.2s' }}
              onClick={() => showAlert(`SpendVault ${APP_VERSION}\nRunning on ${Capacitor.getPlatform()}`, 'App Information')}
              onPointerDown={(e) => e.currentTarget.style.transform = 'scale(0.92)'}
              onPointerUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              <TransparentLogo src="/logo.png" style={{ width: '80px', height: '80px', borderRadius: '50%', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
            </div>
            <div className="flex-col">
              <h3 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '-0.5px' }}>spendvault</h3>
              <span className="text-accent font-bold text-xs uppercase" style={{ letterSpacing: '2px' }}>Personal Finance Oracle</span>
              <span className="text-muted text-xs" style={{ marginTop: '4px' }}>Build {APP_VERSION} (Stable)</span>
            </div>
          </div>

          <div className="flex-col gap-4 w-100" style={{ textAlign: 'left', marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
            <span className="text-xs text-muted font-bold uppercase" style={{ letterSpacing: '1px' }}>Technical Infrastructure</span>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
              <div className="flex align-center gap-3 text-sm" style={{ padding: '0.6rem', background: 'var(--bg-hover)', borderRadius: '8px' }}>
                <span style={{ opacity: 0.7, fontSize: '1.1rem' }}>⚛️</span> React 18
              </div>
              <div className="flex align-center gap-3 text-sm" style={{ padding: '0.6rem', background: 'var(--bg-hover)', borderRadius: '8px' }}>
                <span style={{ opacity: 0.7, fontSize: '1.1rem' }}>📂</span> TypeScript
              </div>
              <div className="flex align-center gap-3 text-sm" style={{ padding: '0.6rem', background: 'var(--bg-hover)', borderRadius: '8px' }}>
                <span style={{ opacity: 0.7, fontSize: '1.1rem' }}>⚡</span> Capacitor
              </div>
              <div className="flex align-center gap-3 text-sm" style={{ padding: '0.6rem', background: 'var(--bg-hover)', borderRadius: '8px' }}>
                <span style={{ opacity: 0.7, fontSize: '1.1rem' }}>🎨</span> Lucide Icons
              </div>
              <div className="flex align-center gap-3 text-sm" style={{ padding: '0.6rem', background: 'var(--bg-hover)', borderRadius: '8px' }}>
                <span style={{ opacity: 0.7, fontSize: '1.1rem' }}>📊</span> Recharts
              </div>
              <div className="flex align-center gap-3 text-sm" style={{ padding: '0.6rem', background: 'var(--bg-hover)', borderRadius: '8px' }}>
                <span style={{ opacity: 0.7, fontSize: '1.1rem' }}>📦</span> Context API
              </div>
            </div>
          </div>



          <div className="flex-col gap-2 w-100" style={{ textAlign: 'left', marginTop: '0.5rem' }}>
            <span className="text-xs text-muted font-bold uppercase" style={{ letterSpacing: '1px' }}>Developer</span>
            <a
              href="mailto:tribhuvankomarla@gmail.com"
              className="flex justify-between align-center"
              style={{
                padding: '0.75rem',
                background: 'var(--bg-hover)',
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                textDecoration: 'none',
                color: 'inherit',
                cursor: 'pointer',
                transition: '0.2s'
              }}
              onPointerDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
              onPointerUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              <span style={{ fontWeight: 600 }}>Tribhuvan Komarla</span>
              <Mail size={16} className="text-accent" />
            </a>
          </div>

          <p className="text-xs text-muted" style={{ marginTop: '1rem', fontStyle: 'italic', opacity: 0.6 }}>
            "Control your capital, secure your future."
          </p>
        </div>
      </SubviewWrapper>
    );
  } else if (activeView === 'profile') {
    if (setupStep === 'recovery') {
      viewContent = (
        <SubviewWrapper title="recovery key" onBack={() => setSetupStep('form')}>
          <div className="card flex-col gap-4 text-center">
            <AlertTriangle size={32} className="text-accent" style={{ margin: '0 auto' }} />
            <h2 style={{ margin: 0, textTransform: 'lowercase' }}>save recovery key</h2>
            <p className="text-muted text-sm">crucial for data recovery if you forget your pin.</p>
            <div style={{ padding: '1.5rem', background: 'var(--bg-color)', borderRadius: '12px', border: '2px dashed var(--accent)', fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent)' }}>
              {generatedKey}
            </div>
            <button className="btn btn-secondary" onClick={() => { navigator.clipboard.writeText(generatedKey); showAlert("Recovery Key copied to clipboard!", "Success"); }}>copy key</button>
            <label className="flex align-center gap-3 cursor-pointer">
              <input type="checkbox" checked={hasConfirmedKey} onChange={e => setHasConfirmedKey(e.target.checked)} />
              <span className="text-sm">I have saved my key</span>
            </label>
            <button className="btn btn-primary" onClick={finalizeSetupWithKey} disabled={!hasConfirmedKey}>Complete Setup</button>
          </div>
        </SubviewWrapper>
      );
    } else {
      viewContent = (
        <SubviewWrapper title="User Details" onBack={() => setActiveView('main')}>
          <div className="flex-col gap-6">
            <div className="card flex-col align-center gap-4" style={{ padding: '1rem 0' }}>
              <div
                style={{ position: 'relative', cursor: 'pointer' }}
                onClick={() => {
                  if (data.user?.profileImage) {
                    setIsActionSheetOpen(true);
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
              >
                <ProfileAvatar size={100} />
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  accept="image/*"
                  onChange={handleImageUpload}
                />
              </div>
              <div className="text-center">
                <h3 style={{ margin: 0 }}>{data.user?.name}</h3>
                <p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>
                  {data.user?.profileImage ? 'Tap to manage photo' : 'Tap to set photo'}
                </p>
              </div>
            </div>

            <div className="card flex-col gap-4">
              <SettingsCardHeader icon={UserIcon} title="Profile" />
              <div className="flex-col gap-1">
                <span className="text-xs text-muted font-bold">FULL NAME</span>
                <input className="input-field" value={profileForm.name} onChange={e => setProfileForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Full Name" />
              </div>
            </div>

            <div className="card flex-col gap-4">
              <SettingsCardHeader icon={Fingerprint} title="Security" />
              <div className="flex-col gap-3">
                {(data.user?.pinHash || data.user?.pin) && (
                  <div className="flex-col gap-1">
                    <span className="text-xs text-muted font-bold">CURRENT PIN</span>
                    <div className="flex gap-2 align-center">
                      <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                        <input
                          type={showOldPin ? "text" : "password"}
                          maxLength={4}
                          className={`input-field ${isOldPinVerified ? 'border-success' : ''}`}
                          style={{ flex: 1, paddingRight: '2.5rem' }}
                          value={isOldPinVerified ? '••••' : profileForm.oldPin}
                          onChange={e => setProfileForm(prev => ({ ...prev, oldPin: e.target.value.replace(/\D/g, '') }))}
                          placeholder={isOldPinVerified ? "VERIFIED" : "••••"}
                          disabled={isOldPinVerified}
                        />
                        {!isOldPinVerified && profileForm.oldPin && (
                          <button
                            type="button"
                            onClick={() => setShowOldPin(!showOldPin)}
                            style={{
                              position: 'absolute',
                              right: '10px',
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              padding: '0.25rem'
                            }}
                          >
                            <span style={{ fontSize: '1rem', lineHeight: 1 }}>{showOldPin ? '🙈' : '👁️'}</span>
                          </button>
                        )}
                      </div>
                      {data.user?.biometricsEnabled && (
                        <button
                          onClick={handleBiometricVerify}
                          className={`btn ${isOldPinVerified ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ padding: '0.75rem', borderRadius: '12px', minWidth: '54px' }}
                          title={isOldPinVerified ? "Reset / Cancel Verification" : "Verify with Biometrics"}
                        >
                          {isOldPinVerified ? <RotateCcw size={20} /> : <Fingerprint size={20} />}
                        </button>
                      )}
                    </div>
                    {isOldPinVerified && <span className="text-xs text-success font-bold" style={{ marginTop: '0.2rem' }}>AUTHORIZED VIA BIOMETRICS</span>}
                  </div>
                )}
                <div className="flex-col gap-1">
                  <span className="text-xs text-muted font-bold">{(data.user?.pinHash || data.user?.pin) ? 'CHANGE PIN' : 'SET PIN'}</span>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input
                      type={showPin ? "text" : "password"}
                      maxLength={4}
                      className="input-field"
                      style={{ flex: 1, paddingRight: '2.5rem' }}
                      value={profileForm.pin}
                      onChange={e => setProfileForm(prev => ({ ...prev, pin: e.target.value.replace(/\D/g, '') }))}
                      placeholder="••••"
                    />
                    {profileForm.pin && (
                      <button
                        type="button"
                        onClick={() => setShowPin(!showPin)}
                        style={{
                          position: 'absolute',
                          right: '10px',
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0.25rem'
                        }}
                      >
                        <span style={{ fontSize: '1rem', lineHeight: 1 }}>{showPin ? '🙈' : '👁️'}</span>
                      </button>
                    )}
                  </div>
                </div>
                {profileForm.pin && (
                  <div className="flex-col gap-1">
                    <span className="text-xs text-muted font-bold">CONFIRM PIN</span>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input
                        type={showConfirmPin ? "text" : "password"}
                        maxLength={4}
                        className="input-field"
                        style={{ flex: 1, paddingRight: '2.5rem' }}
                        value={profileForm.confirmPin}
                        onChange={e => setProfileForm(prev => ({ ...prev, confirmPin: e.target.value.replace(/\D/g, '') }))}
                        placeholder="••••"
                      />
                      {profileForm.confirmPin && (
                        <button
                          type="button"
                          onClick={() => setShowConfirmPin(!showConfirmPin)}
                          style={{
                            position: 'absolute',
                            right: '10px',
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0.25rem'
                          }}
                        >
                          <span style={{ fontSize: '1rem', lineHeight: 1 }}>{showConfirmPin ? '🙈' : '👁️'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex justify-between align-center" style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'var(--bg-color)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div className="flex align-center gap-3">
                    <Fingerprint size={20} className={profileForm.biometricsEnabled ? "text-success" : "text-muted"} />
                    <div className="flex-col">
                      <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Biometric Unlock</span>
                      <span className="text-xs text-muted">FaceID / Fingerprint</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setProfileForm(prev => ({ ...prev, biometricsEnabled: !prev.biometricsEnabled }))}
                    style={{
                      width: '44px', height: '24px', borderRadius: '12px',
                      background: profileForm.biometricsEnabled ? 'var(--accent)' : 'var(--border-color)',
                      position: 'relative', transition: '0.3s'
                    }}
                  >
                    <div style={{
                      position: 'absolute', top: '2px',
                      left: profileForm.biometricsEnabled ? '22px' : '2px',
                      width: '20px', height: '20px', borderRadius: '50%',
                      background: '#fff', transition: '0.3s'
                    }} />
                  </button>
                </div>
              </div>
            </div>
            {hasProfileChanges && (
              <button className="btn btn-primary" style={{ padding: '1rem', fontWeight: 700 }} onClick={handleUpdateProfile}><Check size={20} /> Save Changes</button>
            )}
          </div>
        </SubviewWrapper>
      );
    }
  } else if (activeView === 'oem') {
    viewContent = (
      <SubviewWrapper title="Background Protection" onBack={() => setActiveView('main')}>
        <div className="flex-col gap-4">
          <div className="card flex-col gap-4">
            <SettingsCardHeader icon={ShieldAlert} title="OEM Background Guide" level="h3" size={20} marginBottom="0.5rem" />
            <p className="text-muted text-sm">
              Some device manufacturers (Xiaomi, OnePlus, Oppo, Vivo, Samsung) apply aggressive battery optimizations that stop background SMS detection.
            </p>
            <p className="text-muted text-sm font-bold">
              To ensure 100% reliable transaction detection, please follow these simple steps:
            </p>

            <div className="flex-col gap-4" style={{ marginTop: '0.5rem' }}>
              <div style={{ padding: '1rem', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
                <span className="font-bold text-sm block" style={{ color: 'var(--accent)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '1px' }}>⚡ All Devices (General)</span>
                <p className="text-xs text-muted" style={{ margin: 0 }}>
                  Go to <strong>Settings &gt; Apps &gt; SpendVault &gt; Battery</strong> &gt; Set to <strong>"Unrestricted"</strong> or "No Restrictions".
                </p>
              </div>

              <div style={{ padding: '1rem', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
                <span className="font-bold text-sm block" style={{ color: 'var(--accent)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '1px' }}>📱 Xiaomi / Redmi / Poco</span>
                <p className="text-xs text-muted" style={{ margin: 0 }}>
                  Enable <strong>Autostart</strong> in App Settings. In Battery Saver, select "No Restrictions". Lock SpendVault in your Recents menu.
                </p>
              </div>

              <div style={{ padding: '1rem', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
                <span className="font-bold text-sm block" style={{ color: 'var(--accent)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '1px' }}>📱 OnePlus / Oppo / Realme</span>
                <p className="text-xs text-muted" style={{ margin: 0 }}>
                  Go to App Info &gt; Battery Usage &gt; Enable <strong>"Allow background activity"</strong> and <strong>"Allow auto-launch"</strong>.
                </p>
              </div>

              <div style={{ padding: '1rem', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
                <span className="font-bold text-sm block" style={{ color: 'var(--accent)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '1px' }}>📱 Vivo / iQOO</span>
                <p className="text-xs text-muted" style={{ margin: 0 }}>
                  Go to Settings &gt; Battery &gt; Background Power Consumption Management &gt; Select SpendVault &gt; Allow <strong>High Background Power Consumption</strong>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </SubviewWrapper>
    );
  } else {
    viewContent = (
      <div className="flex-col">
        <div className="flex justify-between align-center" style={{ marginBottom: '1.5rem' }}>
          <h2 className="text-mono" style={{ fontSize: '1.5rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>control panel</h2>
        </div>

        <div className="flex justify-between align-center" style={{ background: 'var(--bg-card)', padding: '1rem', marginBottom: '2rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div className="flex align-center gap-3">
            <ProfileAvatar size={44} onClick={() => navigateTo('profile')} />
            <div className="flex-col gap-0" onClick={() => navigateTo('profile')} style={{ cursor: 'pointer' }}>
              <span style={{ fontWeight: 600 }}>{data.user?.name}</span>
            </div>
          </div>
          <button className="btn btn-secondary text-xs" style={{ borderRadius: '20px' }} onClick={() => navigateTo('profile')}>details</button>
        </div>

        <div style={{ paddingBottom: '2rem' }} className="tour-profile-features">
          <SectionHeader title="preferences" first={true} />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
            <GridButton icon={Tags} label="Categories" onClick={() => navigateTo('categories')} />
            <GridButton icon={Briefcase} label="Account Types" onClick={() => navigateTo('accountTypes')} />
            <GridButton icon={Hash} label="Tags" onClick={() => navigateTo('tags')} />
            <GridButton icon={Moon} label="App Theme" onClick={() => navigateTo('theme')} />
            {/* tour-passive-logs: spotlight target in the union rect */}
            <div className="tour-passive-logs">
              <GridToggleButton 
                icon={RotateCcw} 
                label="Passive Logs" 
                active={!!data.user?.enablePassiveTransactions} 
                onClick={() => {
                  if (!data.user?.enablePassiveTransactions) {
                    setConfirmConfig({
                      title: "Enable Passive Logs?",
                      message: "Passive Logs allow you to flag specific transactions to be excluded from your main Spends and Income analytics. This is perfect for tracking passive movements, investments, or pass-through expenses without distorting your actual budget statistics.",
                      confirmLabel: "Enable",
                      onConfirm: () => {
                        updateUser({ ...data.user!, enablePassiveTransactions: true });
                        setConfirmConfig(null);
                      }
                    });
                  } else {
                    updateUser({ ...data.user!, enablePassiveTransactions: false });
                  }
                }} 
              />
            </div>
          </div>

          {/* Android-only: Auto-Log SMS + Background Guide (tour-smart-features-android for union rect) */}
          {Capacitor.getPlatform() === 'android' && (
            <>
              <SectionHeader title="Smart Features" />
              <div className="grid tour-smart-features-android" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                <GridToggleButton 
                  icon={Sparkles} 
                  label="Auto-Log SMS" 
                  active={!!data.user?.autoLogSms} 
                  onClick={async () => {
                    if (!data.user?.autoLogSms) {
                      setConfirmConfig({
                        title: "SMS Permissions",
                        message: "SpendVault only reads financial SMS from banks to help you log spends offline. No personal messages are ever accessed or uploaded. Grant SMS permission?",
                        confirmLabel: "Grant Permission",
                        onConfirm: async () => {
                          try {
                            const status = await SmsReader.checkPermissions();
                            if (status.sms === 'denied') {
                              showAlert("SMS permission is permanently denied. Please enable it in your phone's App Settings to use this feature.", "Permission Required");
                              setConfirmConfig(null);
                              return;
                            }
                            
                            // 1. Request SMS permission first
                            const result = await SmsReader.requestPermissions();
                            if (result.sms === 'granted') {
                              // SMS granted! Immediately enable SMS auto-logging
                              updateUser({ ...data.user!, autoLogSms: true });

                              // 2. Show background notification rationale
                              setConfirmConfig({
                                title: "Notification Alerts",
                                message: "Would you also like to receive push-style local alerts when new transactions are auto-detected in the background?",
                                confirmLabel: "Enable Alerts",
                                cancelLabel: "Skip",
                                onConfirm: async () => {
                                  try {
                                    if (Capacitor.isNativePlatform()) {
                                      await SmsReader.requestPermissions({ permissions: ['notifications'] });
                                    }
                                  } catch (e) {
                                    console.error("Notification permission skipped/failed:", e);
                                  }
                                  setConfirmConfig(null);
                                }
                              });
                            } else {
                              showAlert("Permission denied. Auto-logging cannot be enabled.", "Permission Denied");
                              setConfirmConfig(null);
                            }
                          } catch (e) {
                            console.error("SMS permission flow failed:", e);
                            updateUser({ ...data.user!, autoLogSms: true });
                            setConfirmConfig(null);
                          }
                        }
                      });
                    } else {
                      updateUser({ ...data.user!, autoLogSms: false });
                    }
                  }} 
                />
                {Capacitor.isNativePlatform() && (
                  <GridButton icon={ShieldAlert} label="Background Guide" onClick={() => navigateTo('oem')} />
                )}
              </div>
            </>
          )}

          <SectionHeader title="Commodity Prices (AI)" />
          <div className="card flex-col gap-3" style={{ padding: '1rem' }}>
            <span className="text-xs text-muted">
              Optional. Auto-fetches an approximate gold/silver ₹/g for your holdings using your own Google Gemini key (BYOK) — get a free one at aistudio.google.com. Your key is stored in the device keystore, never bundled or shared. Without a key, set a manual ₹/g per commodity account.
            </span>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label>Gemini API Key {geminiKeySaved && <span style={{ color: 'var(--success)' }}>· saved</span>}</label>
              <input
                type="password"
                className="input-field"
                value={geminiKeyInput}
                onChange={e => setGeminiKeyInput(e.target.value)}
                placeholder={geminiKeySaved ? '•••••••• (saved — type to replace)' : 'Paste your Gemini API key'}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label>Vendor (price reference)</label>
              <input
                className="input-field"
                value={geminiVendorInput}
                onChange={e => setGeminiVendorInput(e.target.value)}
                placeholder="MMTC-PAMP"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <span className="text-xs text-muted">
              Prices are approximate AI estimates (may lag the live rate). Set a manual ₹/g on any commodity account for exact valuation.
            </span>
            {geminiKeySaved && (
              <span className="text-xs" style={{ color: geminiUsage.count >= geminiUsage.cap ? 'var(--danger)' : 'var(--text-muted)' }}>
                AI fetches today: {geminiUsage.count} / {geminiUsage.cap}
                {geminiUsage.count >= geminiUsage.cap ? ' — daily cap reached, using cached/manual until tomorrow' : ' (safety cap; prices refresh at most every 6h)'}
              </span>
            )}
            <div className="flex gap-3">
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSaveGemini}>Save</button>
              {geminiKeySaved && <button className="btn btn-secondary" onClick={handleClearGemini}>Remove Key</button>}
            </div>
          </div>

          <SectionHeader title="data management" />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
            <GridButton icon={Download} label="Export Backup" onClick={() => navigateTo('export')} />
            <GridButton icon={Upload} label="Import Data" onClick={() => navigateTo('import')} />
            <GridButton icon={Database} label="Wipe Data" onClick={() => navigateTo('clear')} />
          </div>
          <SectionHeader title="support & info" />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
            <GridButton icon={HelpCircle} label="Help Center" onClick={() => navigateTo('help')} />
            <GridButton icon={Info} label="App About" onClick={() => navigateTo('about')} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-col">
      {viewContent}

      {isActionSheetOpen && (
        <div className="modal-overlay" style={{ alignItems: 'flex-end' }} onClick={() => setIsActionSheetOpen(false)}>
          <div className="action-sheet fade-in-up" onClick={e => e.stopPropagation()}>
            <div style={{ width: '40px', height: '4px', background: 'var(--border-color)', borderRadius: '2px', margin: '0.5rem auto 1.5rem' }} />
            <SectionHeader title="Profile Photo" first={true} />
            <div className="flex-col gap-2">
              <button className="action-sheet-btn" onClick={() => { setIsViewModeOpen(true); setIsActionSheetOpen(false); }}>
                <Eye size={20} /> View Photo
              </button>
              <button className="action-sheet-btn" onClick={() => { fileInputRef.current?.click(); setIsActionSheetOpen(false); }}>
                <Camera size={20} /> Change Photo
              </button>
              <button className="action-sheet-btn text-danger" onClick={() => { removeProfileImage(); setIsActionSheetOpen(false); }}>
                <Trash2 size={20} /> Remove Photo
              </button>
            </div>
            <button className="btn btn-secondary w-100" style={{ marginTop: '1rem', padding: '1rem' }} onClick={() => setIsActionSheetOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {isViewModeOpen && data.user?.profileImage && (
        <div className="modal-overlay" style={{ background: '#000' }} onClick={() => setIsViewModeOpen(false)}>
          <button
            style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top) + 1rem)', right: '1rem', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', zIndex: 100 }}
            onClick={() => setIsViewModeOpen(false)}
          >
            <CloseIcon size={24} />
          </button>
          <img
            src={data.user?.profileImage}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            alt="Profile Full"
          />
        </div>
      )}

      {isCropperOpen && tempImage && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Crop Profile Picture</h3>
              <button onClick={() => setIsCropperOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)' }}><CloseIcon size={20} /></button>
            </div>
            <div className="modal-body flex-col align-center gap-6">
              <div
                className="crop-viewport"
                onMouseDown={() => setIsDragging(true)}
                onMouseMove={(e) => { if (isDragging) setPosition(prev => ({ x: prev.x + e.movementX, y: prev.y + e.movementY })); }}
                onMouseUp={() => setIsDragging(false)}
                onMouseLeave={() => setIsDragging(false)}
                onTouchStart={(e) => { touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; setIsDragging(true); }}
                onTouchMove={(e) => {
                  if (isDragging) {
                    const dx = e.touches[0].clientX - touchStart.current.x;
                    const dy = e.touches[0].clientY - touchStart.current.y;
                    setPosition(prev => ({ x: prev.x + dx, y: prev.y + dy }));
                    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                  }
                }}
                onTouchEnd={() => setIsDragging(false)}
              >
                <img
                  src={tempImage || undefined}
                  style={{
                    transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                    cursor: isDragging ? 'grabbing' : 'grab',
                    width: imgIsLandscape ? 'auto' : '100%',
                    height: imgIsLandscape ? '100%' : 'auto'
                  }}
                  onDragStart={e => e.preventDefault()}
                  alt="Temp"
                />
              </div>
              <div className="w-100 flex-col gap-2">
                <div className="flex justify-between text-xs text-muted"><ZoomIn size={14} /><span>ZOOM LEVEL</span></div>
                <input type="range" min="1" max="4" step="0.01" value={scale} onChange={e => setScale(parseFloat(e.target.value))} className="w-100" style={{ accentColor: 'var(--accent)' }} />
              </div>

              <p className="text-xs text-muted text-center"><Move size={12} /> Drag photo to reposition</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setIsCropperOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCroppedImage}>Set Photo</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .crop-viewport { width: 300px; height: 300px; border-radius: 50%; overflow: hidden; background: #000; border: 4px solid var(--border-color); position: relative; display: flex; align-items: center; justify-content: center; touch-action: none; }
        .crop-viewport img { max-width: none; flex-shrink: 0; }
        
        .action-sheet {
          background: var(--bg-card);
          border: 1px solid var(--border-color);
          border-radius: 24px 24px 0 0;
          border-bottom: none;
          padding: 1rem 1.5rem calc(1.5rem + env(safe-area-inset-bottom, 0px));
          width: 100%;
          max-width: 100%;
          box-shadow: 0 -10px 40px rgba(0,0,0,0.5);
        }
        .action-sheet-btn {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1.25rem;
          background: var(--bg-color);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          color: var(--text-primary);
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        .action-sheet-btn:active {
          transform: scale(0.98);
          background: var(--bg-hover);
        }
        .fade-in-up {
          animation: fadeInUp 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        @keyframes fadeInUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
      {/* Custom Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!confirmConfig}
        title={confirmConfig?.title}
        message={confirmConfig?.message || ''}
        confirmLabel={confirmConfig?.confirmLabel}
        isDanger={confirmConfig?.isDanger}
        isAlert={confirmConfig?.isAlert}
        onConfirm={() => confirmConfig?.onConfirm()}
        onCancel={() => setConfirmConfig(null)}
      />
    </div>
  );
}

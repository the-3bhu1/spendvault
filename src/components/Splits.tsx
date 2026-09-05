import { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { Plus, Users, ChevronRight, Trash2, Check, Search, ChevronDown, Calendar, Edit2, ChevronLeft, ArrowRight, ImageDown, ReceiptIndianRupee, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import ConfirmDialog from './ConfirmDialog';
import { useFinance } from '../FinanceContext';
import type { SplitEvent, SplitItem } from '../types';
import { generateId, computeSplitNetBalances, simplifyDebts, splitDisplayName, shareSelfName, formatDateString, errorMessage } from '../utils';
import { scrollToFirstError } from '../utils/formErrors';
import { buildSplitShareImages } from '../services/splitImage';
import { blobToBase64 } from '../services/shareCanvas';
import { SubviewWrapper } from './SubviewWrapper.tsx';

export default function Splits() {
  const { data, addSplitEvent, updateSplitEvent, deleteSplitEvent } = useFinance();
  const [activeView, setActiveView] = useState<'main' | 'detail' | 'create_event'>('main');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  // Guards against a double-tap / synthetic touch+click firing the image share twice.
  const sharingImageRef = useRef(false);

  const [newEvent, setNewEvent] = useState({ name: '', people: [] as string[] });
  const [newPerson, setNewPerson] = useState('');
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const createEventFormRef = useRef<HTMLDivElement>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  // Suggest names seen in previous split events (and their carried-over people) as you type, so you
  // don't have to retype recurring participants. Excludes names already added to the current event.
  const pastSplitPeople = Array.from(new Set((data.splitEvents || []).flatMap(e => e.people || [])));
  const personSuggestions = newPerson.trim()
    ? pastSplitPeople.filter(p => p.toLowerCase().includes(newPerson.trim().toLowerCase()) && !newEvent.people.includes(p)).slice(0, 6)
    : [];

  const selectedEvent = data.splitEvents?.find(e => e.id === selectedEventId);

  useEffect(() => {
    const openTourSplitDetail = () => {
      const demoEvent = data.splitEvents?.find(event => event.id === 'demo_split_1') || data.splitEvents?.[0];
      if (!demoEvent) return;
      setSelectedEventId(demoEvent.id);
      setActiveView('detail');
    };
    const closeTourSplitDetail = () => {
      setSelectedEventId(null);
      setActiveView('main');
    };

    window.addEventListener('tour-open-split-detail', openTourSplitDetail);
    window.addEventListener('tour-close-split-detail', closeTourSplitDetail);
    return () => {
      window.removeEventListener('tour-open-split-detail', openTourSplitDetail);
      window.removeEventListener('tour-close-split-detail', closeTourSplitDetail);
    };
  }, [data.splitEvents]);

  const handleCreateEvent = () => {
    // Was a bare return, and unlike the other Split forms this button isn't disabled when invalid —
    // so pressing "Create Event" with a blank name or nobody added did nothing at all.
    const newErrors: Record<string, string> = {};
    if (!newEvent.name?.trim()) newErrors.eventName = 'Event Name is required';
    if (newEvent.people.length === 0) newErrors.eventPeople = 'Add at least one person';
    setCreateErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      scrollToFirstError(createEventFormRef.current);
      return;
    }

    const event: SplitEvent = {
      id: generateId(),
      name: newEvent.name.trim(),
      people: newEvent.people.map(p => p.trim()),
      items: [],
      createdAt: Date.now(),
    };
    addSplitEvent(event);
    setNewEvent({ name: '', people: [] });
    setCreateErrors({});
    setActiveView('main');
  };

  const getShareData = (event: SplitEvent) => {
    const shareItems = event.items || [];
    const settlements = simplifyDebts(computeSplitNetBalances(shareItems));
    const totalSpent = shareItems.reduce((s, it) => s + it.amount, 0);
    return { shareItems, settlements, totalSpent, subtitle: undefined };
  };

  const buildSummaryMessage = (event: SplitEvent) => {
    const { shareItems, settlements } = getShareData(event);
    /* The user's own name, for the copy that leaves the device — see splitDisplayName. Read here
       rather than threaded through, so the message and the image cannot disagree about it. */
    const selfName = shareSelfName(data.user?.name);

    let message = `💰 *Split Summary: ${event.name}*\n\n`;

    // 1. Deep Itemized Breakdown
    if (shareItems.length > 0) {
      message += `📋 *Itemized Expense Breakdown:*\n`;
      shareItems.forEach(item => {
        const splitCount = item.involvedPeople.length + (item.includeMe ? 1 : 0);
        if (splitCount === 0) return;
        const isUnequal = item.splitType === 'unequal';
        const payerName = splitDisplayName(item.paidBy || 'me', selfName);

        message += `\n🔹 *${item.description}* (₹${item.amount.toFixed(2)}) - Paid by: *${payerName}*\n`;

        if (item.includeMe) {
          const myShare = isUnequal ? (item.shares?.['me'] ?? 0) : (item.amount / splitCount);
          message += `  • ${splitDisplayName('me', selfName)}: ₹${myShare.toFixed(2)}\n`;
        }
        item.involvedPeople.forEach(p => {
          const friendShare = isUnequal ? (item.shares?.[p] ?? 0) : (item.amount / splitCount);
          message += `  • ${p}: ₹${friendShare.toFixed(2)}\n`;
        });
      });
      message += `\n`;
    }

    // 2. Settle Up — minimal set of payments across EVERYONE (not just me), so friend↔friend
    // debts are included and the numbers actually balance.
    message += `💳 *Settle Up (who pays whom):*\n`;
    if (settlements.length === 0) {
      message += `✅ All settled up! No active debts.\n`;
    } else {
      settlements.forEach(s => {
        message += `➡️ *${splitDisplayName(s.from, selfName)}* pays *${splitDisplayName(s.to, selfName)}*: ₹${s.amount.toFixed(2)}\n`;
      });
    }

    message += `\nGenerated via SpendVault`;
    return message;
  };

  // Renders the summary to PNG(s) and shares them together with the text message. A short split
  // produces one combined image; a large one produces a Settle-Up image + paginated Expenses images.
  const handleShareImage = async (event: SplitEvent) => {
    if (sharingImageRef.current) return; // ignore a second tap while a share is already in flight
    sharingImageRef.current = true;
    try {
      const { shareItems, settlements, totalSpent, subtitle } = getShareData(event);
      const message = buildSummaryMessage(event);
      const selfName = shareSelfName(data.user?.name);
      const blobs = await buildSplitShareImages({
        title: event.name,
        subtitle,
        totalSpent,
        settlements: settlements.map(s => ({ from: splitDisplayName(s.from, selfName), to: splitDisplayName(s.to, selfName), amount: s.amount })),
        items: shareItems.map(it => {
          const parts = it.includeMe ? [...it.involvedPeople, 'me'] : [...it.involvedPeople];
          return {
            description: it.description,
            amount: it.amount,
            paidBy: splitDisplayName(it.paidBy || 'me', selfName),
            // Point-free `.map(splitDisplayName)` would hand map's index through as selfName.
            participantNames: parts.map(n => splitDisplayName(n, selfName)),
          };
        }),
      });

      const safeName = (event.name || 'summary').replace(/[^a-z0-9]+/gi, '-');
      const fileName = (i: number) => blobs.length > 1
        ? `SpendVault-Split-${safeName}-${i + 1}.png`
        : `SpendVault-Split-${safeName}.png`;

      if (Capacitor.isNativePlatform()) {
        const uris: string[] = [];
        for (let i = 0; i < blobs.length; i++) {
          const base64 = await blobToBase64(blobs[i]);
          const res = await Filesystem.writeFile({ path: fileName(i), data: base64, directory: Directory.Cache });
          uris.push(res.uri);
        }
        await Share.share({ text: message, files: uris });
      } else {
        const files = blobs.map((b, i) => new File([b], fileName(i), { type: 'image/png' }));
        const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
        if (nav.canShare && nav.canShare({ files })) {
          await nav.share({ text: message, files });
        } else {
          // Desktop browsers can't share files — download the PNG(s) so they can be attached manually.
          files.forEach(file => {
            const url = URL.createObjectURL(file);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            a.click();
            URL.revokeObjectURL(url);
          });
        }
      }
    } catch (err) {
      if (String(errorMessage(err) ?? err).toLowerCase().includes('cancel')) return;
      console.error('Share image failed', err);
    } finally {
      sharingImageRef.current = false;
    }
  };

  return (
    <div className="flex-col gap-6 animate-in splits-tab-root">
      {activeView === 'main' && (
        <>
          <div className="flex justify-between align-center">
            <h2 className="text-mono" style={{ fontSize: '1.5rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>group splits</h2>
            <button className="btn btn-primary flex align-center gap-2" onClick={() => setActiveView('create_event')}>
              <Plus size={18} strokeWidth={3} /> New Event
            </button>
          </div>

          <div className="flex-col gap-4">
            {(!data.splitEvents || data.splitEvents.length === 0) ? (
              <div className="card flex-col align-center justify-center gap-4 text-center" style={{ padding: '3rem 1rem', opacity: 0.6 }}>
                <div className="flex-center" style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'var(--bg-hover)' }}>
                  <Users size={32} />
                </div>
                <div className="flex-col gap-1">
                  <p className="font-bold">No split events yet</p>
                  <p className="text-xs">Create a trip or outing to start splitting expenses.</p>
                </div>
              </div>
            ) : (
              data.splitEvents.sort((a, b) => {
                if (a.status !== b.status) return a.status === 'settled' ? 1 : -1;
                return b.createdAt - a.createdAt;
              }).map(event => {
                const itemsCount = (event.items || []).length;

                return (
                  <div key={event.id} className="card flex-col gap-4 clickable tour-split-event-card" onClick={() => {
                    setSelectedEventId(event.id);
                    setActiveView('detail');
                  }}>
                    <div className="flex justify-between align-center">
                      <div className="flex align-center gap-3">
                        <div className="flex-center" style={{ 
                          width: '40px', 
                          height: '40px', 
                          borderRadius: '12px', 
                          background: event.status === 'settled' ? 'var(--bg-hover)' : 'var(--primary-color)', 
                          color: event.status === 'settled' ? 'var(--text-muted)' : 'white' 
                        }}>
                          <Users size={20} />
                        </div>
                        <div className="flex-col">
                          <div className="flex align-center gap-2">
                            <span className="font-bold" style={{ opacity: event.status === 'settled' ? 0.6 : 1 }}>{event.name}</span>
                            {event.status === 'settled' && (
                              /* asymmetric vertical padding: Overpass Mono's baseline rides ~1px high in a
                                 line-height:1 box, so even padding leaves the word optically above the title */
                              <span className="text-mono font-bold uppercase" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', lineHeight: 1, padding: '3px 6px 1px', background: 'var(--bg-hover)', color: 'var(--text-muted)', borderRadius: '4px', border: '1px solid var(--border-color)', letterSpacing: '0.5px' }}>Settled</span>
                            )}
                          </div>
                          <span className="text-muted text-xs">{event.people.length} people • {itemsCount} items</span>
                        </div>
                      </div>
                      <ChevronRight size={20} className="text-muted" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {activeView === 'create_event' && (
        <SubviewWrapper 
          title="Create Split Event" 
          onBack={() => { setActiveView('main'); setCreateErrors({}); }}
          footer={
            <button className="btn btn-primary w-100" style={{ padding: '0.9rem' }} onClick={handleCreateEvent}>
              Create Event
            </button>
          }
        >
          <div className="flex-col gap-6" ref={createEventFormRef}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label>Event Name</label>
              <input
                type="text"
                className={`input-field ${createErrors.eventName ? 'border-danger' : ''}`}
                placeholder="e.g. Goa Trip 2024"
                value={newEvent.name}
                onChange={e => {
                  setNewEvent({ ...newEvent, name: e.target.value });
                  if (createErrors.eventName) setCreateErrors(prev => ({ ...prev, eventName: '' }));
                }}
              />
              {createErrors.eventName && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{createErrors.eventName}</span>}
            </div>


            <div className="input-group" style={{ marginBottom: 0 }}>
              <label>People Involved</label>
              <div className="flex gap-2" style={{ marginBottom: '0.75rem' }}>
                <input
                  type="text"
                  className={`input-field ${createErrors.eventPeople ? 'border-danger' : ''}`}
                  style={{ flex: 7 }}
                  placeholder="Person name"
                  value={newPerson}
                  onChange={e => setNewPerson(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), newPerson && (setNewEvent({ ...newEvent, people: [...newEvent.people, newPerson] }), setNewPerson(''), setCreateErrors(prev => ({ ...prev, eventPeople: '' }))))}
                />
                <button className="btn btn-primary" style={{ flex: 3, padding: 0 }} onClick={() => newPerson && (setNewEvent({ ...newEvent, people: [...newEvent.people, newPerson] }), setNewPerson(''), setCreateErrors(prev => ({ ...prev, eventPeople: '' })))}>
                  <Plus size={24} strokeWidth={3} />
                </button>
              </div>
              {personSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-2" style={{ marginBottom: '0.75rem' }}>
                  {personSuggestions.map(p => (
                    <button
                      key={p}
                      type="button"
                      className="metric-pill clickable flex align-center gap-1"
                      style={{ padding: '0.4rem 0.7rem', cursor: 'pointer', background: 'var(--bg-hover)' }}
                      onClick={() => { setNewEvent({ ...newEvent, people: [...newEvent.people, p] }); setNewPerson(''); setCreateErrors(prev => ({ ...prev, eventPeople: '' })); }}
                    >
                      <Plus size={12} strokeWidth={3} />{p}
                    </button>
                  ))}
                </div>
              )}
              {createErrors.eventPeople && <span className="text-xs text-danger" style={{ marginBottom: '0.5rem', display: 'block' }}>{createErrors.eventPeople}</span>}
              <div className="flex flex-wrap gap-2">
                {newEvent.people.map((p, i) => (
                  <div key={i} className="metric-pill flex align-center gap-2" style={{ padding: '0.5rem 0.75rem' }}>
                    {p}
                    <Trash2 size={14} className="clickable" onClick={() => { setNewEvent({ ...newEvent, people: [...newEvent.people].filter((_, idx) => idx !== i) }); }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </SubviewWrapper>
      )}

      {activeView === 'detail' && selectedEvent && (
        <SplitDetail
          event={selectedEvent}
          onBack={() => setActiveView('main')}
          onUpdate={updateSplitEvent}
          onDelete={() => setIsDeleteConfirmOpen(true)}
          onShareImage={() => handleShareImage(selectedEvent)}
        />
      )}
      {/* Custom Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isDeleteConfirmOpen}
        title="Delete Event?"
        message="Are you sure you want to remove this event? This will permanently delete all associated items and split history."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (selectedEventId) {
            deleteSplitEvent(selectedEventId);
            setSelectedEventId(null);
            setActiveView('main');
          }
          setIsDeleteConfirmOpen(false);
        }}
        onCancel={() => setIsDeleteConfirmOpen(false)}
      />
    </div>
  );
}

function SplitDetail({ event, onBack, onUpdate, onDelete, onShareImage }: {
  event: SplitEvent,
  onBack: () => void,
  onUpdate: (e: SplitEvent) => void,
  onDelete: () => void,
  onShareImage: () => void
}) {
  const { data } = useFinance();
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [involvedPeople, setInvolvedPeople] = useState<string[]>(event.people);
  const [includeMe, setIncludeMe] = useState(true);
  
  const [editingEvent, setEditingEvent] = useState(false);
  const [editEventName, setEditEventName] = useState(event.name);
  const [editEventPeople, setEditEventPeople] = useState<string[]>(event.people);
  const [editNewPerson, setEditNewPerson] = useState('');

  const effectiveItems = event.items || [];

  const [selectorSearch, setSelectorSearch] = useState('');
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({
    [format(new Date(), 'yyyy-MM')]: true
  });

  const [customDescription, setCustomDescription] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [paidBy, setPaidBy] = useState<string>('me');

  const [splitType, setSplitType] = useState<'equal' | 'unequal'>('equal');
  const [customShares, setCustomShares] = useState<Record<string, string>>({});

  const resetForm = () => {
    setSelectedTxId(null);
    setEditingItemId(null);
    setSelectorSearch('');
    setInvolvedPeople(event.people);
    setIncludeMe(true);
    setPaidBy('me');
    setCustomDescription('');
    setCustomAmount('');
    setSplitType('equal');
    setCustomShares({});
  };

  const selectedTx = selectedTxId === 'custom'
    ? { id: 'custom', description: customDescription, amount: parseFloat(customAmount) || 0 }
    : data.transactions.find(t => t.id === selectedTxId);

  const handleSaveItem = () => {
    const finalAmount = selectedTxId === 'custom' ? (parseFloat(customAmount) || 0) : (selectedTx?.amount || 0);
    const finalDesc = selectedTxId === 'custom' ? (customDescription.trim() || 'Custom Expense') : (selectedTx?.description || '');
    if (finalAmount <= 0 || (involvedPeople.length === 0 && !includeMe)) return;

    let finalShares: Record<string, number> | undefined = undefined;
    if (splitType === 'unequal') {
      finalShares = {};
      finalShares['me'] = parseFloat(customShares['me']) || 0;
      event.people.forEach(p => {
        finalShares![p] = parseFloat(customShares[p]) || 0;
      });
    }

    const buildUpdatedItems = (currentItems: SplitItem[]) => {
      if (editingItemId) {
        return currentItems.map(item => item.id === editingItemId ? {
          ...item, transactionId: selectedTxId || '', amount: finalAmount,
          description: finalDesc, involvedPeople, includeMe, paidBy, splitType, shares: finalShares
        } : item);
      }
      const newItem: SplitItem = {
        id: generateId(), transactionId: selectedTxId || '',
        amount: finalAmount, description: finalDesc,
        involvedPeople, includeMe, splitType, shares: finalShares, paidBy
      };
      return [...currentItems, newItem];
    };

    onUpdate({ ...event, items: buildUpdatedItems(event.items || []) });
    setIsItemModalOpen(false);
    resetForm();
  };

  const calculateTotals = () => {
    const balances: Record<string, { owesMe: number; iOweThem: number; net: number }> = {};
    event.people.forEach(p => {
      balances[p] = { owesMe: 0, iOweThem: 0, net: 0 };
    });

    let totalSpent = 0;
    let myTotalShare = 0;

    effectiveItems.forEach(item => {
      totalSpent += item.amount;
      const splitCount = item.involvedPeople.length + (item.includeMe ? 1 : 0);
      if (splitCount === 0) return;
      
      const isUnequal = item.splitType === 'unequal';
      const payer = item.paidBy || 'me';

      if (payer === 'me') {
        item.involvedPeople.forEach(p => {
          if (balances[p]) {
            const friendShare = isUnequal ? (item.shares?.[p] ?? 0) : (item.amount / splitCount);
            balances[p].owesMe += friendShare;
          }
        });
        if (item.includeMe) {
          const myShare = isUnequal ? (item.shares?.['me'] ?? 0) : (item.amount / splitCount);
          myTotalShare += myShare;
        }
      } else {
        if (item.includeMe) {
          const myShare = isUnequal ? (item.shares?.['me'] ?? 0) : (item.amount / splitCount);
          myTotalShare += myShare;
          if (balances[payer]) {
            balances[payer].iOweThem += myShare;
          }
        }
      }
    });

    event.people.forEach(p => {
      balances[p].net = balances[p].owesMe - balances[p].iOweThem;
    });

    return { balances, totalSpent, myTotalShare };
  };

  const { balances, totalSpent, myTotalShare } = calculateTotals();
  
  const totalYouAreOwed = Object.values(balances).reduce((sum, b) => sum + (b.net > 0 ? b.net : 0), 0);
  const totalYouOwe = Object.values(balances).reduce((sum, b) => sum + (b.net < 0 ? Math.abs(b.net) : 0), 0);
  const netBalance = totalYouAreOwed - totalYouOwe;

  const handleSaveEvent = () => {
    if (!editEventName.trim() || editEventPeople.length === 0) return;
    // Trimmed once up front, then used for every comparison below — the removed/paid diffs must
    // compare against the same cleaned-up values that end up in the saved event, or a stray trailing
    // space picked up while editing would make an untouched name look "removed".
    const trimmedPeople = editEventPeople.map(p => p.trim());
    const removedPeople = event.people.filter(p => !trimmedPeople.includes(p));
    const updatedItems = (event.items || []).map(item => ({
      ...item,
      involvedPeople: item.involvedPeople.filter(p => !removedPeople.includes(p))
    }));

    const updatedPaid = (event.paidPeople || []).filter(p => trimmedPeople.includes(p));

    onUpdate({
      ...event,
      name: editEventName.trim(),
      people: trimmedPeople,
      paidPeople: updatedPaid,
      items: updatedItems,
    });
    setEditingEvent(false);
  };

  const handleTogglePaid = (person: string) => {
    const isActuallySettled = event.status === 'settled' && (event.paidPeople || []).length === 0;
    if (isActuallySettled) return;
    const currentPaid = event.paidPeople || [];
    const isPaid = currentPaid.includes(person);
    const newPaid = isPaid ? currentPaid.filter(p => p !== person) : [...currentPaid, person];
    const allPaid = event.people.every(p => newPaid.includes(p));
    onUpdate({ ...event, paidPeople: newPaid, status: allPaid ? 'settled' : 'active' });
  };

  const handleDeleteItem = (itemId: string) => {
    onUpdate({ ...event, items: (event.items || []).filter(i => i.id !== itemId) });
  };

  return (
    <SubviewWrapper 
      title={
        <div className="flex align-center gap-2">
          <h2 style={{ margin: 0, textTransform: 'lowercase' }}>{event.name}</h2>
          {event.status === 'settled' && (
            /* asymmetric vertical padding — see the list-card badge above */
            <span className="text-mono font-bold uppercase" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', lineHeight: 1, padding: '3px 6px 1px', background: 'var(--success-soft)', color: 'var(--success)', borderRadius: '4px', border: '1px solid var(--success)', letterSpacing: '0.5px' }}>Settled</span>
          )}
        </div>
      } 
      onBack={onBack}
    >
      <div className="flex-col gap-6">

        <div className="flex justify-between align-center tour-split-detail-header">
          <div className="flex-col">
            <span className="text-xs text-muted uppercase font-bold" style={{ letterSpacing: '1px' }}>Consolidated Summary</span>
            <span className="text-xl font-bold">₹{totalSpent.toFixed(2)}</span>
          </div>
          <div className="flex gap-3">
            <button
              className="btn btn-secondary"
              style={{ width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}
              onClick={() => {
                setEditEventName(event.name);
                setEditEventPeople(event.people);
                setEditNewPerson('');
                setEditingEvent(true);
              }}
              title="Edit Event"
            >
              <Edit2 size={16} />
            </button>
            <button
              className="btn btn-secondary"
              style={{ 
                width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: event.status === 'settled' ? 'var(--success)' : 'var(--text-muted)',
                borderColor: event.status === 'settled' ? 'var(--success)' : undefined,
                background: event.status === 'settled' ? 'var(--success-soft)' : undefined
              }}
              onClick={() => onUpdate({ ...event, status: event.status === 'settled' ? 'active' : 'settled' })}
              title={event.status === 'settled' ? "Re-open Split" : "Mark as Settled"}
            >
              <Check size={18} strokeWidth={3} />
            </button>
            <button
              className="btn btn-secondary tour-split-share-btn"
              style={{ width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}
              onClick={onShareImage}
              title="Share Split Summary"
            >
              <ImageDown size={18} />
            </button>
            <button
              className="btn btn-secondary"
              style={{ width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)' }}
              onClick={onDelete}
              title="Delete Event"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
 

        <div className="card grid grid-cols-2 gap-4 tour-split-detail-summary" style={{ background: 'var(--bg-hover)', border: 'none' }}>
          <div className="flex-col gap-1">
            <span className="text-xs text-muted">My Share</span>
            <span className="font-bold">₹{myTotalShare.toFixed(2)}</span>
          </div>
          <div className="flex-col gap-1">
            <span className="text-xs text-muted">Net Balance</span>
            {netBalance > 0 ? (
              <span className="font-bold" style={{ color: 'var(--success)' }}>
                Owed ₹{netBalance.toFixed(2)}
              </span>
            ) : netBalance < 0 ? (
              <span className="font-bold" style={{ color: 'var(--danger)' }}>
                Owe ₹{Math.abs(netBalance).toFixed(2)}
              </span>
            ) : (
              <span className="font-bold text-muted">Even</span>
            )}
          </div>
        </div>
 
        {(() => {
          // Minimal set of payments to square everyone up, across ALL participants (incl. friend↔friend).
          const settlements = simplifyDebts(computeSplitNetBalances(effectiveItems));
          return (
            <div className="flex-col">
              <span className="text-xs text-muted uppercase font-bold" style={{ letterSpacing: '1px', marginBottom: '0.5rem', padding: '0 0.5rem' }}>Settle Up · Who Pays Whom</span>
              {settlements.length === 0 ? (
                <p className="text-center text-sm text-muted" style={{ padding: '1rem 0' }}>All settled up — no payments needed.</p>
              ) : (
                settlements.map((s, i) => (
                  <div key={`${s.from}-${s.to}-${i}`} className="flex justify-between align-center" style={{
                    padding: '0.75rem 0.5rem',
                    borderBottom: i === settlements.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)'
                  }}>
                    <div className="flex align-center gap-2" style={{ minWidth: 0 }}>
                      <span className="text-mono font-bold truncate" style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--danger)' }}>{splitDisplayName(s.from)}</span>
                      <ArrowRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      <span className="text-mono font-bold truncate" style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--success)' }}>{splitDisplayName(s.to)}</span>
                    </div>
                    <span className="font-bold text-sm" style={{ color: 'var(--text-primary)', flexShrink: 0 }}>₹{s.amount.toFixed(2)}</span>
                  </div>
                ))
              )}
            </div>
          );
        })()}

        <div className="flex-col tour-split-per-person">
          <span className="text-xs text-muted uppercase font-bold" style={{ letterSpacing: '1px', marginBottom: '0.5rem', padding: '0 0.5rem' }}>Your Balance Per Person</span>
          {event.people.map((person, idx) => {
            const isPaid = event.paidPeople?.includes(person);
            const isSettled = event.status === 'settled';
            const netVal = balances[person]?.net ?? 0;
            
            return (
              <div key={person} className="flex justify-between align-center clickable" 
                onClick={() => handleTogglePaid(person)}
                style={{
                  padding: '0.75rem 0.5rem',
                  borderBottom: idx === event.people.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                  opacity: (isPaid || isSettled) ? 0.6 : 1,
                  transition: 'all 0.2s ease'
                }}
              >
                <div className="flex align-center gap-3">
                  <div className="flex-center" style={{ 
                    width: '24px', 
                    height: '24px', 
                    borderRadius: '8px', 
                    border: `2px solid ${(isPaid || isSettled) ? 'var(--success)' : 'var(--border-color)'}`,
                    background: (isPaid || isSettled) ? 'var(--success)' : 'transparent',
                    transition: 'all 0.2s ease'
                  }}>
                    {(isPaid || isSettled) && <Check size={14} color="white" strokeWidth={4} />}
                  </div>
                  <span className="text-mono font-bold" style={{ 
                    fontSize: '0.85rem', 
                    textTransform: 'uppercase', 
                    letterSpacing: '1px', 
                    color: (isPaid || isSettled) ? 'var(--text-muted)' : 'var(--text-primary)',
                    textDecoration: (isPaid || isSettled) ? 'line-through' : 'none'
                  }}>{person}</span>
                </div>
                <div className="flex-col align-end">
                  {isPaid ? (
                    <span className="font-bold text-sm" style={{ color: 'var(--success)' }}>
                      paid
                    </span>
                  ) : netVal > 0 ? (
                    <span className="font-bold text-sm" style={{ color: 'var(--success)' }}>
                      owes you ₹{netVal.toFixed(2)}
                    </span>
                  ) : netVal < 0 ? (
                    <span className="font-bold text-sm" style={{ color: 'var(--danger)' }}>
                      you owe ₹{Math.abs(netVal).toFixed(2)}
                    </span>
                  ) : (
                    <span className="font-bold text-sm text-muted">settled</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex-col gap-4">
          <div className="flex justify-between align-center">
            <span className="text-xs text-muted uppercase font-bold" style={{ letterSpacing: '1px' }}>Expenses ({effectiveItems.length})</span>
            {event.status !== 'settled' && (
              <button
                className="btn btn-primary flex align-center gap-2"
                onClick={() => {
                  resetForm();
                  setIsItemModalOpen(true);
                }}
              >
                <Plus size={16} /> Add Expense
              </button>
            )}
          </div>

          <div className="flex-col gap-2">
            {effectiveItems.length === 0 ? (
              <p className="text-center text-sm text-muted py-6">No expenses added to this split yet.</p>
            ) : (
              effectiveItems.map((item) => (
                <div key={item.id} className="card flex-col gap-2" style={{ padding: '0.75rem' }}>
                  <div className="flex justify-between align-start">
                    <div className="flex-col" style={{ minWidth: 0, flex: 1 }}>
                      <span className="font-bold text-sm" style={{ 
                        whiteSpace: 'nowrap', 
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis' 
                      }}>{item.description}</span>
                      <span className="text-xs text-muted">₹{item.amount.toFixed(2)} • {item.involvedPeople.length + (item.includeMe ? 1 : 0)} people • Paid by: {item.paidBy === 'me' || !item.paidBy ? 'Me' : item.paidBy}</span>
                    </div>
                    {event.status !== 'settled' && (
                      <div className="flex gap-3" style={{ flexShrink: 0, marginLeft: '0.5rem' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ width: '32px', height: '32px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onClick={() => {
                            setSelectedTxId(item.transactionId || 'custom');
                            setEditingItemId(item.id);
                            setCustomDescription(item.description);
                            setCustomAmount(item.amount.toString());
                            setPaidBy(item.paidBy || 'me');
                            setSplitType(item.splitType || 'equal');
                            const initialShares: Record<string, string> = {};
                            initialShares['me'] = "0";
                            event.people.forEach(p => {
                              initialShares[p] = "0";
                            });
                            if (item.shares) {
                              Object.entries(item.shares).forEach(([k, v]) => {
                                initialShares[k] = v.toString();
                              });
                            }
                            setCustomShares(initialShares);
                            setInvolvedPeople(item.involvedPeople);
                            setIncludeMe(item.includeMe);
                            setIsItemModalOpen(true);
                          }}
                        >
                          <Edit2 size={14} className="text-muted" />
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ width: '32px', height: '32px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onClick={() => handleDeleteItem(item.id)}
                        >
                          <Trash2 size={14} className="text-danger" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {item.includeMe && <span className="metric-pill" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>Me</span>}
                    {item.involvedPeople.map(p => (
                      <span key={p} className="metric-pill" style={{ fontSize: '0.65rem', padding: '2px 6px', opacity: 0.8 }}>{p}</span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        {isItemModalOpen && (
          <div className="modal-overlay flex-center" style={{ zIndex: 2000 }}>
            <div className="modal-content animate-in full-screen flex-col" style={{ padding: 0 }}>
              {/* Header: Changes based on state */}
              {!selectedTxId && !editingItemId ? (
                /* Select Transaction: original layout — left title + close (X) */
                <div className="modal-header" style={{ padding: 'calc(0.75rem + var(--safe-area-inset-top)) 1.5rem 1rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.85rem', fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>
                    Select Transaction
                  </h3>
                  <button onClick={() => { setIsItemModalOpen(false); resetForm(); }}>
                    <X />
                  </button>
                </div>
              ) : (
                /* Split Details / Edit Split: back button + centered title */
                <div className="align-center" style={{ display: 'flex', position: 'relative', padding: 'calc(0.75rem + var(--safe-area-inset-top)) 0.5rem 1rem 0.5rem', borderBottom: '2px solid #000', width: '100%' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '0.5rem', flexShrink: 0 }}
                    onClick={() => {
                      if (selectedTxId && !editingItemId) {
                        setSelectedTxId(null); setSplitType('equal'); setCustomShares({});
                      } else {
                        setIsItemModalOpen(false); resetForm();
                      }
                    }}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <h3 style={{ position: 'absolute', left: '3.5rem', right: '3.5rem', textAlign: 'center', margin: 0, fontSize: '1.85rem', fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text-primary)', pointerEvents: 'none' }}>
                    {editingItemId ? 'Edit Split' : 'Split Details'}
                  </h3>
                </div>
              )}

              {/* View 1: Transaction Selector */}
              {!selectedTxId ? (
                <div className="flex-col flex-1" style={{ overflow: 'hidden', minHeight: 0 }}>
                  <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ position: 'relative', width: '100%' }}>
                      <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
                      <input
                        type="text"
                        className="input-field"
                        placeholder="Search ledger..."
                        value={selectorSearch}
                        onChange={e => setSelectorSearch(e.target.value)}
                        style={{ paddingLeft: '3rem', borderRadius: '12px', width: '100%' }}
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y no-scrollbar" style={{ background: 'var(--bg-color)', overflowY: 'auto' }}>
                    <div
                      className="flex justify-between align-center clickable"
                      onClick={() => {
                        setSelectedTxId('custom');
                        setCustomDescription('');
                        setCustomAmount('');
                        setPaidBy('me');
                      }}
                      style={{
                        padding: '1.25rem 1.5rem',
                        borderBottom: '1px solid var(--border-color)',
                        background: 'var(--bg-hover)',
                        marginBottom: '0.5rem'
                      }}
                    >
                      <div className="flex align-center gap-3">
                        <div className="flex-center" style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--primary-color)', color: 'white' }}>
                          <Plus size={20} />
                        </div>
                        <div className="flex-col">
                          <span className="font-bold" style={{ fontSize: '0.95rem' }}>Add Custom / Manual Expense</span>
                          <span className="text-xs text-muted">Expense paid by you or a friend directly</span>
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-muted" style={{ transform: 'rotate(0deg)' }} />
                    </div>
                    {(() => {
                      const filtered = data.transactions
                        .filter(t => t.type === 'debit')
                        .filter(t =>
                          (t.description || '').toLowerCase().includes(selectorSearch.toLowerCase()) ||
                          (t.category || '').toLowerCase().includes(selectorSearch.toLowerCase())
                        )
                        .sort((a, b) => b.date.localeCompare(a.date));

                      const months = Array.from(new Set(filtered.map(t => t.date.substring(0, 7))))
                        .sort((a, b) => b.localeCompare(a));

                      if (filtered.length === 0) {
                        return <div className="flex-col align-center justify-center gap-4" style={{ padding: '4rem 2rem', opacity: 0.5 }}>
                          <Search size={40} />
                          <p>No transactions found</p>
                        </div>;
                      }

                      return months.map(m => {
                        const txsInMonth = filtered.filter(t => t.date.substring(0, 7) === m);
                        const isExpanded = expandedMonths[m];
                        const monthDate = new Date(`${m}-01`);
                        const monthLabel = monthDate.toLocaleString('default', { month: 'long', year: 'numeric' });

                        return (
                          <div key={m} className="flex-col">
                            <div
                              className="flex justify-between align-center clickable"
                              onClick={() => setExpandedMonths(prev => ({ ...prev, [m]: !prev[m] }))}
                              style={{ padding: '0.75rem 1.5rem', background: 'var(--bg-hover)', borderBottom: '1px solid var(--border-color)' }}
                            >
                              <div className="flex align-center gap-3 text-mono font-bold" style={{ fontSize: '0.8rem', letterSpacing: '1px' }}>
                                <Calendar size={14} className="text-primary" />
                                {/* Optical centring: Overpass Mono's ascent and descent are asymmetric, so an all-caps
                                    label draws ~0.2em above the middle of its own line box. Flexbox centres that box, not
                                    the glyphs, and line-height cannot move them — the half-leading cancels out. A nudge of
                                    the measured difference is the only lever. */}
                                <span style={{ position: 'relative', top: '0.2em' }}>{monthLabel.toUpperCase()}</span>
                              </div>
                              <div className="flex align-center gap-2 text-muted" style={{ fontSize: '0.7rem' }}>
                                {txsInMonth.length} items
                                <ChevronDown size={14} style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="flex-col fade-in">
                                {(() => {
                                  const groupedByDate = txsInMonth.reduce((acc, tx) => {
                                    if (!acc[tx.date]) acc[tx.date] = [];
                                    acc[tx.date].push(tx);
                                    return acc;
                                  }, {} as Record<string, typeof data.transactions>);

                                  return Object.entries(groupedByDate)
                                    .sort((a, b) => b[0].localeCompare(a[0]))
                                    .map(([date, txs]) => {
                                      const sortedTxs = [...txs].sort((a, b) => {
                                        const orderA = a.order !== undefined ? a.order : txs.indexOf(a);
                                        const orderB = b.order !== undefined ? b.order : txs.indexOf(b);
                                        return orderA - orderB;
                                      });
                                      return (
                                      <div key={date} className="flex-col">
                                        <div style={{ padding: '0.4rem 1.5rem', background: 'var(--bg-color)', borderBottom: '1px solid var(--border-color)', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
                                          {formatDateString(date)}
                                        </div>
                                        {sortedTxs.map(t => (
                                          <div
                                            key={t.id}
                                            className="flex justify-between align-center clickable"
                                            onClick={() => setSelectedTxId(t.id)}
                                            style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', flexWrap: 'nowrap' }}
                                          >
                                            <div className="flex align-center gap-3 flex-1" style={{ minWidth: 0 }}>
                                              <div className="flex-center" style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', flexShrink: 0 }}>
                                                <ReceiptIndianRupee size={18} className="text-primary" />
                                              </div>
                                              <div className="flex-col" style={{ minWidth: 0, flex: 1 }}>
                                                <span className="font-bold truncate" style={{ fontSize: '0.9rem', display: 'block' }}>{t.description}</span>
                                                {(() => {
                                                  const acctName = data.accounts.find(a => a.id === t.accountId)?.name || '';
                                                  return (
                                                    <span className="text-xs text-muted truncate" style={{ display: 'block' }}>
                                                      {acctName ? `${t.category} · ${acctName}` : t.category}
                                                    </span>
                                                  );
                                                })()}
                                              </div>
                                            </div>
                                            <div className="flex-col align-end" style={{ flexShrink: 0, marginLeft: '1rem' }}>
                                              <span className="text-mono font-bold" style={{ color: '#ef4444' }}>
                                                -₹{t.amount}
                                              </span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                      );
                                    });
                                })()}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              ) : (() => {
                const totalAmount = selectedTxId === 'custom' ? (parseFloat(customAmount) || 0) : (selectedTx?.amount || 0);
                const sumOfShares = (parseFloat(customShares['me']) || 0) + event.people.reduce((sum, p) => sum + (parseFloat(customShares[p]) || 0), 0);
                const remainingAmount = totalAmount - sumOfShares;
                return (
                  /* View 2: Split Details */
                  <div className="flex-col flex-1 overflow-y no-scrollbar" style={{ padding: '1.5rem', overflowY: 'auto' }}>
                    <div className="card text-center flex-col align-center gap-2" style={{ background: 'var(--bg-hover)', border: 'none', marginBottom: '1.5rem' }}>
                      <span className="text-xs text-muted uppercase font-bold" style={{ letterSpacing: '1px' }}>Split Result</span>
                      {selectedTxId === 'custom' ? (
                        <div className="flex-col gap-3 w-100" style={{ padding: '0.5rem' }}>
                          <div className="input-group text-left" style={{ width: '100%' }}>
                            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Description</label>
                            <input
                              type="text"
                              className="input-field"
                              placeholder="e.g. Dinner, Cab, Tickets"
                              value={customDescription}
                              onChange={e => setCustomDescription(e.target.value)}
                              style={{ background: 'var(--bg-color)', width: '100%', borderRadius: '8px' }}
                            />
                          </div>
                          <div className="input-group text-left" style={{ width: '100%' }}>
                            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Amount (₹)</label>
                            <input
                              type="number"
                              className="input-field"
                              placeholder="0.00"
                              value={customAmount}
                              onChange={e => setCustomAmount(e.target.value)}
                              style={{ background: 'var(--bg-color)', width: '100%', borderRadius: '8px' }}
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="text-center">
                            <ReceiptIndianRupee size={16} className="text-primary" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.4rem' }} />
                            <span className="font-medium" style={{ verticalAlign: 'middle' }}>{selectedTx?.description}</span>
                          </div>
                          <span className="text-2xl font-bold text-primary">
                            ₹{selectedTx?.amount.toFixed(2)}
                          </span>
                        </>
                      )}
                      {splitType === 'equal' && (
                        <>
                          <span className="text-2xl font-bold text-accent" style={{ marginTop: '0.5rem' }}>
                            ₹{(totalAmount / (involvedPeople.length + (includeMe ? 1 : 0)) || 0).toFixed(2)}
                          </span>
                          <span className="text-xs text-muted">per person</span>
                        </>
                      )}
                    </div>

                    <div className="input-group" style={{ marginBottom: '1.5rem' }}>
                      <label>Who Paid?</label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginTop: '0.5rem', width: '100%' }}>
                        <button
                          type="button"
                          className={`btn ${paidBy === 'me' ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ borderRadius: '0px', padding: '0.5rem 0', fontSize: '0.85rem', width: '100%', display: 'block', textAlign: 'center' }}
                          onClick={() => setPaidBy('me')}
                        >
                          Me
                        </button>
                        {event.people.map(person => (
                          <button
                            key={person}
                            type="button"
                            className={`btn ${paidBy === person ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ borderRadius: '0px', padding: '0.5rem 0', fontSize: '0.85rem', width: '100%', display: 'block', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                            onClick={() => setPaidBy(person)}
                            title={person}
                          >
                            {person}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="input-group" style={{ marginBottom: '1.5rem', width: '100%' }}>
                      <label>Split Type</label>
                      <div className="flex gap-2" style={{ marginTop: '0.5rem', width: '100%' }}>
                        <button
                          type="button"
                          className={`btn ${splitType === 'equal' ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ borderRadius: '0px', padding: '0.6rem 0.5rem', fontSize: '0.85rem', flex: 1, width: '100%', textTransform: 'uppercase', letterSpacing: '0.5px' }}
                        onClick={() => { setSplitType('equal'); setCustomShares({}); }}
                        >
                          Split Equally
                        </button>
                        <button
                          type="button"
                          className={`btn ${splitType === 'unequal' ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ borderRadius: '0px', padding: '0.6rem 0.5rem', fontSize: '0.85rem', flex: 1, width: '100%', textTransform: 'uppercase', letterSpacing: '0.5px' }}
                          onClick={() => setSplitType('unequal')}
                        >
                          Split Unequally
                        </button>
                      </div>
                    </div>

                    <div className="input-group">
                      <label>{splitType === 'equal' ? "Who's involved?" : "Enter individual shares"}</label>
                    <div className="flex flex-col gap-2" style={{ marginTop: '0.5rem' }}>
                        {splitType === 'equal' ? (
                          <>
                            <div
                              className={`flex justify-between align-center clickable ${includeMe ? 'bg-primary-soft' : ''}`}
                              style={{
                                padding: '1.25rem 1rem',
                                borderRadius: '0px',
                                border: `1px solid ${includeMe ? 'var(--primary-color)' : 'var(--border-color)'}`,
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                marginBottom: '0.5rem'
                              }}
                              onClick={() => setIncludeMe(!includeMe)}
                            >
                              <span className="font-bold" style={{ fontSize: '1rem' }}>Me (Include myself)</span>
                              <div className="flex-center" style={{ width: '24px', height: '24px', borderRadius: '0px', border: '2px solid var(--primary-color)', background: includeMe ? 'var(--primary-color)' : 'transparent' }}>
                                {includeMe && <Check size={16} color="white" strokeWidth={4} />}
                              </div>
                            </div>

                            {event.people.map(person => (
                              <div
                                key={person}
                                className={`flex justify-between align-center clickable ${involvedPeople.includes(person) ? 'bg-primary-soft' : ''}`}
                                style={{
                                  padding: '1.25rem 1rem',
                                  borderRadius: '0px',
                                  border: `1px solid ${involvedPeople.includes(person) ? 'var(--primary-color)' : 'var(--border-color)'}`,
                                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                  marginBottom: '0.5rem'
                                }}
                                onClick={() => {
                                  if (involvedPeople.includes(person)) {
                                    setInvolvedPeople(involvedPeople.filter(p => p !== person));
                                  } else {
                                    setInvolvedPeople([...involvedPeople, person]);
                                  }
                                }}
                              >
                                <span className="font-bold" style={{ fontSize: '1rem' }}>{person}</span>
                                <div className="flex-center" style={{ width: '24px', height: '24px', borderRadius: '0px', border: '2px solid var(--primary-color)', background: involvedPeople.includes(person) ? 'var(--primary-color)' : 'transparent' }}>
                                  {involvedPeople.includes(person) && <Check size={16} color="white" strokeWidth={4} />}
                                </div>
                              </div>
                            ))}
                          </>
                        ) : (
                          <>
                            <div
                              className="flex justify-between align-center"
                              style={{
                                padding: '0.75rem 1rem',
                                borderRadius: '0px',
                                border: '1px solid var(--border-color)',
                                background: 'var(--bg-hover)',
                                marginBottom: '0.5rem',
                                gap: '1rem'
                              }}
                            >
                              <span className="font-bold" style={{ fontSize: '1rem' }}>Me (Include myself)</span>
                              <div style={{ position: 'relative', width: '120px' }}>
                                <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>₹</span>
                                <input
                                  type="number"
                                  className="input-field"
                                  placeholder="0.00"
                                  value={customShares['me'] || ''}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setCustomShares(prev => ({ ...prev, me: val }));
                                    setIncludeMe((parseFloat(val) || 0) > 0);
                                  }}
                                  style={{ paddingLeft: '1.75rem', borderRadius: '0px', textAlign: 'right', width: '100%', height: '36px', background: 'var(--bg-color)' }}
                                />
                              </div>
                            </div>

                            {event.people.map(person => (
                              <div
                                key={person}
                                className="flex justify-between align-center"
                                style={{
                                  padding: '0.75rem 1rem',
                                  borderRadius: '0px',
                                  border: '1px solid var(--border-color)',
                                  background: 'var(--bg-hover)',
                                  marginBottom: '0.5rem',
                                  gap: '1rem'
                                }}
                              >
                                <span className="font-bold" style={{ fontSize: '1rem' }}>{person}</span>
                                <div style={{ position: 'relative', width: '120px' }}>
                                  <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>₹</span>
                                  <input
                                    type="number"
                                    className="input-field"
                                    placeholder="0.00"
                                    value={customShares[person] || ''}
                                    onChange={e => {
                                      const val = e.target.value;
                                      setCustomShares(prev => ({ ...prev, [person]: val }));
                                      const floatVal = parseFloat(val) || 0;
                                      if (floatVal > 0) {
                                        if (!involvedPeople.includes(person)) {
                                          setInvolvedPeople(prev => [...prev, person]);
                                        }
                                      } else {
                                        setInvolvedPeople(prev => prev.filter(p => p !== person));
                                      }
                                    }}
                                    style={{ paddingLeft: '1.75rem', borderRadius: '0px', textAlign: 'right', width: '100%', height: '36px', background: 'var(--bg-color)' }}
                                  />
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    </div>

                    {(() => {
                      // Must mirror handleSaveItem's own guard exactly, amount included: with only the
                      // participant check here, a custom expense of ₹0 left the button enabled and the
                      // save silently returned.
                      const splitAmount = selectedTxId === 'custom' ? (parseFloat(customAmount) || 0) : (selectedTx?.amount || 0);
                      const isSplitValid = splitAmount > 0 && (splitType === 'equal'
                        ? (includeMe || involvedPeople.length > 0)
                        : (sumOfShares > 0));
                      const isSumMatched = Math.abs(remainingAmount) < 0.01;

                      return (
                        <>
                          {splitType === 'unequal' && (
                            <div 
                              className="card flex-col gap-2" 
                              style={{ 
                                background: isSumMatched ? 'rgba(34, 197, 94, 0.1)' : 'rgba(245, 158, 11, 0.1)', 
                                borderColor: isSumMatched ? 'var(--success)' : 'var(--accent-color)', 
                                marginTop: '1rem',
                                padding: '0.75rem 1rem',
                                borderRadius: '0px',
                                border: '1px solid',
                                alignItems: 'stretch'
                              }}
                            >
                              <span className="text-xs font-bold" style={{ color: isSumMatched ? 'var(--success)' : 'var(--accent-color)' }}>
                                {isSumMatched 
                                  ? '✅\u00A0\u00A0All split shares match the total perfectly!' 
                                  : `⚠️\u00A0\u00A0Sum adjusted: ₹${sumOfShares.toFixed(2)} / ₹${totalAmount.toFixed(2)} (${remainingAmount > 0 ? `₹${remainingAmount.toFixed(2)} remaining` : `₹${Math.abs(remainingAmount).toFixed(2)} over`})`
                                }
                              </span>
                              {!isSumMatched && remainingAmount > 0.01 && (
                                <button
                                  type="button"
                                  className="btn btn-secondary text-xs"
                                  style={{
                                    padding: '8px 10px',
                                    fontSize: '9px',
                                    borderRadius: '0px',
                                    border: '1px solid var(--accent)',
                                    boxShadow: 'none',
                                    width: '100%',
                                    cursor: 'pointer',
                                    fontFamily: 'var(--font-mono)',
                                    fontWeight: 800,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px',
                                    textAlign: 'center'
                                  }}
                                  onClick={() => {
                                    const allCandidates = ['me', ...event.people];
                                    const emptyCandidates = allCandidates.filter(p => customShares[p] === undefined || customShares[p].trim() === '');
                                    if (emptyCandidates.length > 0) {
                                      const count = emptyCandidates.length;
                                      const baseShare = Math.round(remainingAmount / count);

                                      const updatedShares = { ...customShares };
                                      emptyCandidates.forEach(p => {
                                        updatedShares[p] = baseShare.toString();
                                      });
                                      setCustomShares(updatedShares);
                                      
                                      const newInvolved = [...involvedPeople];
                                      emptyCandidates.forEach(p => {
                                        if (p !== 'me' && !newInvolved.includes(p)) {
                                          newInvolved.push(p);
                                        }
                                      });
                                      setInvolvedPeople(newInvolved);
                                      if (emptyCandidates.includes('me')) {
                                        setIncludeMe(true);
                                      }
                                    }
                                  }}
                                >
                                  Auto-Split Remaining
                                </button>
                              )}
                            </div>
                          )}

                          <div className="modal-footer" style={{ marginTop: 'auto', paddingTop: '2rem' }}>
                            <button
                               className="btn btn-primary w-100"
                              style={{ padding: '1rem', borderRadius: '0px' }}
                              onClick={handleSaveItem}
                              disabled={!isSplitValid}
                            >
                              {editingItemId ? 'Save Split' : 'Confirm Split'}
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {editingEvent && (
          <div className="modal-overlay flex-center" style={{ zIndex: 2000 }}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ padding: 0 }}>
              <div className="modal-header" style={{ marginBottom: '0.5rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.85rem', fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>Edit Event</h3>
                <button onClick={() => setEditingEvent(false)}>
                  <X />
                </button>
              </div>
              <div className="flex-col gap-6" style={{ padding: '1rem 1.5rem 2rem' }}>
              
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label>Event Name</label>
                <input
                  className="input-field"
                  value={editEventName}
                  onChange={e => setEditEventName(e.target.value)}
                />
              </div>

              <div className="input-group" style={{ marginBottom: 0 }}>
                <label>People Involved</label>
                <div className="flex gap-2" style={{ marginBottom: '0.75rem' }}>
                  <input
                    type="text"
                    className="input-field"
                    style={{ flex: 7 }}
                    placeholder="Person name"
                    value={editNewPerson}
                    onChange={e => setEditNewPerson(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && editNewPerson) {
                        e.preventDefault();
                        if (!editEventPeople.includes(editNewPerson)) {
                          setEditEventPeople([...editEventPeople, editNewPerson]);
                        }
                        setEditNewPerson('');
                      }
                    }}
                  />
                  <button className="btn btn-primary" style={{ flex: 3, padding: 0 }} onClick={() => {
                    if (editNewPerson && !editEventPeople.includes(editNewPerson)) {
                      setEditEventPeople([...editEventPeople, editNewPerson]);
                      setEditNewPerson('');
                    }
                  }}>
                    <Plus size={24} strokeWidth={3} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {editEventPeople.map((p, i) => (
                    <div key={i} className="metric-pill flex align-center gap-2" style={{ padding: '0.5rem 0.75rem' }}>
                      {p}
                      <Trash2 size={14} className="clickable" onClick={() => setEditEventPeople(editEventPeople.filter((_, idx) => idx !== i))} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="modal-footer" style={{ marginTop: '1rem' }}>
                <button className="btn btn-secondary" onClick={() => setEditingEvent(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSaveEvent} disabled={editEventPeople.length === 0 || !editEventName.trim()}>
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
        )}

      </div>
    </SubviewWrapper>
  );
}

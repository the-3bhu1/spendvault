import React, { useRef, useState } from 'react';
import { X, CornerDownRight, Share2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import type { Account } from '../types';
import { CardNetworkLogo } from './CardNetworkLogo';
import { CardSurface, CARD_ASPECT_RATIO } from './CardSurface';
import { CardChip } from './CardChip';
import { CardBrandLogo } from './CardBrandLogo';
import { getCardGradients } from '../utils';
import { useFinance } from '../FinanceContext';

interface ViewCardOverlayProps {
  account: Account;
  onClose: () => void;
}

export function ViewCardOverlay({ account, onClose }: ViewCardOverlayProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const context = useFinance();
  // Guards against a double-tap / synthetic touch+click firing the share sheet twice.
  const sharingRef = useRef(false);

  // Stop propagation on overlay click so it only closes when clicking outside the card
  const handleBackdropClick = () => {
    onClose();
  };

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFlipped(!isFlipped);
  };

  const { cardDetails, name, id } = account;
  
  // Find index in sorted accounts list to guarantee uniqueness
  const allAccounts = context ? [...context.data.accounts].sort((a, b) => a.id.localeCompare(b.id)) : [];
  const accountIndex = allAccounts.findIndex(acc => acc.id === id);
  const gradients = getCardGradients(accountIndex >= 0 ? accountIndex : 0, cardDetails?.network, name);

  const expiryFormatted = cardDetails?.expiryMonth && cardDetails?.expiryYear
    ? `${String(cardDetails.expiryMonth).padStart(2, '0')}/${String(cardDetails.expiryYear).slice(-2)}`
    : 'MM/YY';

  // Simple temporary notification
  const showToast = (message: string) => {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = 'rgba(20, 184, 166, 0.9)';
    toast.style.color = 'white';
    toast.style.padding = '8px 16px';
    toast.style.borderRadius = '20px';
    toast.style.fontSize = '12px';
    toast.style.zIndex = '10000';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Older WebViews / insecure contexts have no async clipboard API.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  };

  const handleCopy = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    void copyToClipboard(text);
    showToast('Copied to clipboard');
  };

  // Copies the details AND opens the OS share sheet. On native the Web Share API is unavailable in
  // the Capacitor WebView, so we go through the Share plugin — same flow as the split image share.
  const handleShareAll = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (sharingRef.current) return; // ignore a second tap while a share is already in flight
    sharingRef.current = true;
    try {
      const formattedCardNumber = cardDetails?.cardNumber?.match(/.{1,4}/g)?.join(' ') || 'N/A';
      const cardholder = cardDetails?.cardholderName || 'N/A';
      const cardName = name || 'N/A';
      const expiry = expiryFormatted;
      const cvv = cardDetails?.cvv || 'N/A';

      const shareText = `Card Name: ${cardName}\nCardholder Name: ${cardholder}\nCard Number: ${formattedCardNumber}\nExpiry Date: ${expiry}\nCVV: ${cvv}`;

      // Clipboard copy always happens, regardless of whether the share sheet opens.
      const copied = await copyToClipboard(shareText);
      if (copied) showToast('All card details copied to clipboard');

      if (Capacitor.isNativePlatform()) {
        await Share.share({
          title: `${cardName} Details`,
          text: shareText,
          dialogTitle: 'Share card details',
        });
      } else if (navigator.share) {
        await navigator.share({ title: `${cardName} Details`, text: shareText });
      } else if (!copied) {
        showToast('Could not share or copy card details');
      }
    } catch (err) {
      // User dismissed the share sheet — not a real error
      const error = err as Error;
      const msg = String(error?.message ?? err).toLowerCase();
      if (error?.name === 'AbortError' || msg.includes('cancel') || msg.includes('abort')) return;
      console.error('Share card details failed', err);
    } finally {
      sharingRef.current = false;
    }
  };

  return (
    <div 
      className="view-card-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '2rem',
        animation: 'overlayFadeIn 0.3s ease'
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '360px',
          // Height follows the card ratio instead of a fixed 230px, which was
          // only correct at exactly 360px wide — on a narrower phone the card
          // was stretching.
          aspectRatio: String(CARD_ASPECT_RATIO),
          perspective: '1000px',
          position: 'relative'
        }}
      >
        <div 
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            transition: 'transform 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
            transformStyle: 'preserve-3d',
            transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            cursor: 'pointer'
          }}
          onClick={handleCardClick}
        >
          {/* Front of Card */}
          <CardSurface
            skin={gradients}
            face="front"
            style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              border: '1px solid rgba(var(--card-ink), 0.1)',
              // Two shadows, not one: a tight contact shadow for edge definition
              // plus a wide ambient one for lift. A single blur reads as a UI card.
              boxShadow: '0 2px 4px rgba(0,0,0,0.35), 0 24px 48px -12px rgba(0,0,0,0.65)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}
          >
            {/* Top Section: SIM Chip & issuing bank */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <CardChip width={42} />
              {gradients.issuer && <CardBrandLogo brand={gradients.issuer} height={20} />}
            </div>

            {/* Network logo bottom-right, Names bottom-left */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 'auto' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {name && (
                  <span style={{ 
                    fontFamily: 'var(--font-family)', 
                    fontSize: '10px', 
                    color: 'rgba(var(--card-ink), 0.5)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    {name}
                  </span>
                )}
                <span style={{ 
                  fontFamily: '"Courier New", Courier, monospace', 
                  fontSize: '14px', 
                  color: 'rgba(var(--card-ink), 0.9)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em',
                  // Embossed, not drop-shadowed: a highlight on the upper edge and
                  // a shadow under the lower one, as if the letters are raised out
                  // of the plastic under the same top-left light as the sheen.
                  textShadow: '0 -1px 0 rgba(255,255,255,0.14), 0 1px 1px rgba(0,0,0,0.55)',
                }}>
                  {cardDetails?.cardholderName || 'CARDHOLDER NAME'}
                </span>
              </div>
              <div style={{ overflow: 'visible' }}>
                {cardDetails?.network && <CardNetworkLogo network={cardDetails.network} size="md" />}
              </div>
            </div>
          </CardSurface>

          {/* Back of Card */}
          <CardSurface
            skin={gradients}
            face="back"
            style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              border: '1px solid rgba(var(--card-ink), 0.1)',
              // Two shadows, not one: a tight contact shadow for edge definition
              // plus a wide ambient one for lift. A single blur reads as a UI card.
              boxShadow: '0 2px 4px rgba(0,0,0,0.35), 0 24px 48px -12px rgba(0,0,0,0.65)',
              transform: 'rotateY(180deg)',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Magnetic Stripe */}
            <div style={{ width: '100%', height: '45px', minHeight: '45px', flexShrink: 0, background: '#111', marginTop: '15px' }} />

            {/* Back Details Container */}
            <div style={{ padding: '16px 24px 24px 24px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
              
              {/* Hologram & CVV Row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {/* Hologram Area */}
                <div style={{ 
                  width: '45px', 
                  height: '35px', 
                  borderRadius: '6px',
                  background: 'linear-gradient(135deg, #a8caba 0%, #5d4157 25%, #a8caba 50%, #5d4157 75%, #a8caba 100%)',
                  backgroundSize: '200% 200%',
                  animation: 'hologramShine 3s infinite linear',
                  boxShadow: 'inset 0 0 5px rgba(255,255,255,0.5), 0 1px 3px rgba(0,0,0,0.4)',
                  position: 'relative',
                  overflow: 'hidden'
                }}>
                  {/* Subtle pattern overlay for hologram */}
                  <div style={{ 
                    position: 'absolute', 
                    top: 0, left: 0, right: 0, bottom: 0, 
                    backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.4) 1px, transparent 1px)',
                    backgroundSize: '4px 4px',
                    opacity: 0.5
                  }} />
                </div>

                {/* CVV Box */}
                <div 
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'copy', width: 'fit-content' }}
                  onClick={(e) => handleCopy(cardDetails?.cvv || '', e)}
                >
                  <span style={{ fontSize: '10px', color: 'rgba(var(--card-ink), 0.6)', textTransform: 'uppercase', fontWeight: 600 }}>CVV</span>
                  <div style={{ 
                    background: 'white', 
                    height: '30px', 
                    padding: '0 12px', 
                    borderRadius: '4px',
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    fontFamily: '"Courier New", Courier, monospace',
                    fontSize: '14px',
                    fontWeight: 700,
                    color: '#111',
                    letterSpacing: '2px',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)'
                  }}>
                    {cardDetails?.cvv || '•••'}
                  </div>
                </div>
              </div>

              {/* Full Number & Expiry, with the co-brand mark filling the empty
                  block to their right — the one genuinely free region on the back. */}
              <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div 
                  style={{ display: 'flex', flexDirection: 'column', gap: '2px', cursor: 'copy', width: 'fit-content' }}
                  onClick={(e) => handleCopy(cardDetails?.cardNumber || '', e)}
                >
                  <span style={{ fontSize: '9px', color: 'rgba(var(--card-ink), 0.5)', textTransform: 'uppercase', fontWeight: 600 }}>Card Number</span>
                  <span style={{ fontFamily: '"Courier New", Courier, monospace', fontSize: '15px', color: 'rgb(var(--card-ink))', fontWeight: 700, letterSpacing: '2px', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                    {cardDetails?.cardNumber?.match(/.{1,4}/g)?.join(' ') || '•••• •••• •••• ••••'}
                  </span>
                </div>
                
                <div 
                  style={{ display: 'flex', flexDirection: 'column', gap: '2px', cursor: 'copy', width: 'fit-content' }}
                  onClick={(e) => handleCopy(expiryFormatted, e)}
                >
                  <span style={{ fontSize: '9px', color: 'rgba(var(--card-ink), 0.5)', textTransform: 'uppercase', fontWeight: 600 }}>Expiry Date</span>
                  <span style={{ fontFamily: '"Courier New", Courier, monospace', fontSize: '14px', color: 'rgb(var(--card-ink))', fontWeight: 700, letterSpacing: '1px', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                    {expiryFormatted}
                  </span>
                </div>
              </div>

                {cardDetails && gradients.coBrand && (
                  <CardBrandLogo brand={gradients.coBrand} height={20} />
                )}
              </div>
            </div>
          </CardSurface>
        </div>
        
        {/* Helper text */}
        <div style={{ 
          position: 'absolute', 
          bottom: '-40px', 
          left: 0, 
          right: 0, 
          textAlign: 'center', 
          color: 'rgba(255,255,255,0.6)', 
          fontSize: '14px',
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px'
        }}>
          Tap card to flip <CornerDownRight size={14} />
        </div>
      </div>

      <div style={{ marginTop: '55px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button 
          className="btn-icon" 
          onClick={handleShareAll}
          title="Share all card details"
          style={{ 
            width: '48px', 
            height: '48px', 
            borderRadius: '50%', 
            background: 'rgba(255,255,255,0.12)', 
            color: 'white',
            border: '1px solid rgba(255,255,255,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
          }}
        >
          <Share2 size={22} />
        </button>

        <button 
          className="btn-icon" 
          onClick={handleBackdropClick}
          title="Close"
          style={{ 
            width: '48px', 
            height: '48px', 
            borderRadius: '50%', 
            background: 'rgba(255,255,255,0.12)', 
            color: 'white',
            border: '1px solid rgba(255,255,255,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
          }}
        >
          <X size={24} />
        </button>
      </div>

      <style>
        {`
          @keyframes overlayFadeIn {
            from { opacity: 0; backdrop-filter: blur(0px); }
            to { opacity: 1; backdrop-filter: blur(10px); }
          }
        `}
      </style>
    </div>
  );
}

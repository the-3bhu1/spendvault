import React, { useState } from 'react';
import { X, CornerDownRight } from 'lucide-react';
import type { Account } from '../types';
import { CardNetworkLogo } from './CardNetworkLogo';
import { getCardGradients } from '../utils';
import { useFinance } from '../FinanceContext';

interface ViewCardOverlayProps {
  account: Account;
  onClose: () => void;
}

export function ViewCardOverlay({ account, onClose }: ViewCardOverlayProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const context = useFinance();

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
  const gradients = getCardGradients(accountIndex >= 0 ? accountIndex : 0, cardDetails?.network);

  const expiryFormatted = cardDetails?.expiryMonth && cardDetails?.expiryYear
    ? `${String(cardDetails.expiryMonth).padStart(2, '0')}/${String(cardDetails.expiryYear).slice(-2)}`
    : 'MM/YY';

  const handleCopy = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    // Simple temporary notification
    const toast = document.createElement('div');
    toast.textContent = 'Copied to clipboard';
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
    toast.style.animation = 'fadeOut 2s forwards';
    document.body.appendChild(toast);
    setTimeout(() => document.body.removeChild(toast), 2000);
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
          height: '230px',
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
          <div 
            style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              background: gradients.front,
              borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
              overflow: 'hidden',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}
          >
            {/* Top Section: SIM Chip & Network Logo */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              {/* SIM Chip */}
              <div style={{ position: 'relative', width: '42px', height: '30px', background: 'linear-gradient(135deg, #ffd700 0%, #ca8a04 100%)', borderRadius: '4px', overflow: 'hidden' }}>
                <svg width="42" height="30" viewBox="0 0 42 30" style={{ position: 'absolute', top: 0, left: 0 }}>
                  <line x1="0" y1="15" x2="42" y2="15" stroke="rgba(139,90,0,0.4)" strokeWidth="0.8" />
                  <line x1="21" y1="0" x2="21" y2="30" stroke="rgba(139,90,0,0.4)" strokeWidth="0.8" />
                  <line x1="14" y1="0" x2="14" y2="30" stroke="rgba(139,90,0,0.3)" strokeWidth="0.5" />
                  <line x1="28" y1="0" x2="28" y2="30" stroke="rgba(139,90,0,0.3)" strokeWidth="0.5" />
                  <line x1="0" y1="8" x2="14" y2="8" stroke="rgba(139,90,0,0.3)" strokeWidth="0.5" />
                  <line x1="0" y1="22" x2="14" y2="22" stroke="rgba(139,90,0,0.3)" strokeWidth="0.5" />
                  <line x1="28" y1="8" x2="42" y2="8" stroke="rgba(139,90,0,0.3)" strokeWidth="0.5" />
                  <line x1="28" y1="22" x2="42" y2="22" stroke="rgba(139,90,0,0.3)" strokeWidth="0.5" />
                  <rect x="14" y="5" width="14" height="20" rx="2" fill="none" stroke="rgba(139,90,0,0.35)" strokeWidth="0.8" />
                </svg>
              </div>
            </div>

            {/* Network logo bottom-right, Names bottom-left */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 'auto' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {name && (
                  <span style={{ 
                    fontFamily: 'var(--font-family)', 
                    fontSize: '10px', 
                    color: 'rgba(255,255,255,0.5)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    {name}
                  </span>
                )}
                <span style={{ 
                  fontFamily: '"Courier New", Courier, monospace', 
                  fontSize: '14px', 
                  color: 'rgba(255,255,255,0.9)',
                  textTransform: 'uppercase',
                  letterSpacing: '1.5px',
                  textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                }}>
                  {cardDetails?.cardholderName || 'CARDHOLDER NAME'}
                </span>
              </div>
              <div style={{ overflow: 'visible' }}>
                {cardDetails?.network && <CardNetworkLogo network={cardDetails.network} size="md" />}
              </div>
            </div>
          </div>

          {/* Back of Card */}
          <div 
            style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              background: gradients.back,
              borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
              transform: 'rotateY(180deg)',
              overflow: 'hidden',
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
                  <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', fontWeight: 600 }}>CVV</span>
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

              {/* Full Number & Expiry */}
              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div 
                  style={{ display: 'flex', flexDirection: 'column', gap: '2px', cursor: 'copy', width: 'fit-content' }}
                  onClick={(e) => handleCopy(cardDetails?.cardNumber || '', e)}
                >
                  <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', fontWeight: 600 }}>Card Number</span>
                  <span style={{ fontFamily: '"Courier New", Courier, monospace', fontSize: '15px', color: 'white', fontWeight: 700, letterSpacing: '2px', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                    {cardDetails?.cardNumber?.match(/.{1,4}/g)?.join(' ') || '•••• •••• •••• ••••'}
                  </span>
                </div>
                
                <div 
                  style={{ display: 'flex', flexDirection: 'column', gap: '2px', cursor: 'copy', width: 'fit-content' }}
                  onClick={(e) => handleCopy(expiryFormatted, e)}
                >
                  <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', fontWeight: 600 }}>Expiry Date</span>
                  <span style={{ fontFamily: '"Courier New", Courier, monospace', fontSize: '14px', color: 'white', fontWeight: 700, letterSpacing: '1px', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                    {expiryFormatted}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Tiny contact text at bottom */}
            <div style={{ padding: '8px 20px', fontSize: '7px', color: 'rgba(255,255,255,0.3)', textAlign: 'center', lineHeight: 1.2 }}>
              This card is non-transferable. Use of this card is subject to the terms and conditions of the issuer. Found cards should be destroyed immediately.
            </div>
          </div>
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

      <button 
        className="btn-icon" 
        onClick={handleBackdropClick}
        style={{ 
          marginTop: '60px',
          width: '48px', 
          height: '48px', 
          borderRadius: '50%', 
          background: 'rgba(255,255,255,0.1)', 
          color: 'white',
          border: '1px solid rgba(255,255,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <X size={24} />
      </button>

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

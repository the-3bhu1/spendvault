import React from 'react';
import { ChevronLeft } from 'lucide-react';

interface SubviewWrapperProps {
  title: React.ReactNode;
  children: React.ReactNode;
  onBack: () => void;
  footer?: React.ReactNode;
}

export const SubviewWrapper = ({ title, children, onBack, footer }: SubviewWrapperProps) => (
  <div className="flex-col gap-6 animate-opacity" style={{ 
    position: 'relative', 
    paddingBottom: footer ? '96px' : '40px',
    overflowX: 'hidden',
    /* Only bites where the parent is a flex column WITH a height to give away — the splits tab is
       the one that is, and there it lets an empty list centre itself in what is left of the screen
       instead of hugging its heading. Everywhere else the parent is auto-height or not a flex
       container at all, and this is inert. The inner div below already carries flex:1, so where it
       does bite, the body stretches with it. Grow only: no basis or shrink, so nothing that is
       already taller than the screen gets squeezed. */
    flexGrow: 1
  }}>
    <div className="flex align-center gap-4">
      <button className="btn btn-secondary" style={{ padding: '0.5rem' }} onClick={onBack}>
        <ChevronLeft size={20} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        {typeof title === 'string' ? (
          <h2 style={{ margin: 0, textTransform: 'lowercase' }}>{title}</h2>
        ) : (
          title
        )}
      </div>
    </div>
    <div className="flex-col gap-6" style={{ flex: 1 }}>
      {children}
    </div>
    {footer && (
      <div className="animate-opacity" style={{ 
        position: 'fixed', 
        bottom: 'calc(80px + var(--safe-area-inset-bottom))', 
        left: '1.5rem', 
        right: '1.5rem', 
        zIndex: 100,
        background: 'transparent'
      }}>
        {footer}
      </div>
    )}
  </div>
);

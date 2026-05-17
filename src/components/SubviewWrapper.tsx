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
    overflowX: 'hidden'
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
        bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))', 
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

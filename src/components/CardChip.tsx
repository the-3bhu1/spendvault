import React from 'react';

/**
 * EMV contact chip. Content, not material — it sits *on* a <CardSurface> rather
 * than being part of one, which is why it lives in its own component instead of
 * inside the surface primitive.
 *
 * The artwork is authored at 42×30 (the real chip's ~1.4:1 module ratio) and
 * scaled from `width`, so the pad grid keeps its proportions at any size.
 */
export function CardChip({ width = 42, style }: { width?: number; style?: React.CSSProperties }) {
  const height = Math.round((width * 30) / 42);
  // Corner radius tracks chip size — 4px at w=42, 3px at w=34, which is what the
  // two call sites were each hardcoding before.
  const radius = Math.max(2, Math.round(width * 0.095));

  return (
    <div
      style={{
        position: 'relative',
        width: `${width}px`,
        height: `${height}px`,
        background: 'linear-gradient(135deg, #ffd700 0%, #ca8a04 100%)',
        borderRadius: `${radius}px`,
        overflow: 'hidden',
        ...style,
      }}
    >
      <svg width={width} height={height} viewBox="0 0 42 30" style={{ position: 'absolute', top: 0, left: 0 }}>
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
  );
}

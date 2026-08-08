import React from 'react';
import type { CardSkin, CardTexture } from '../utils';

/**
 * The card *material* — base gradient, texture, geometry, sheen, edge highlight.
 * Everything printed on the card (chip, network mark, names, copy buttons) is
 * passed as children and stays owned by the consumer.
 *
 * Layer order matters, and it is not "material then content":
 *
 *   1. base gradient        ─┐
 *   2. texture               ├─ below content
 *   3. geometry             ─┘
 *   -- children --
 *   4. sheen + edge highlight — ABOVE content
 *
 * On a real card the specular highlight passes over the embossed number and the
 * printed logo. Rendering it under the content makes the text read as floating on
 * a lit surface rather than being part of the card, which is exactly the tell this
 * component exists to remove. The overlay is pointer-events:none so the copy-to-
 * clipboard handlers underneath it still receive taps.
 *
 * Sizing, radius and shadow come from `style` — each call site sizes its own card.
 */

const FILL: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  pointerEvents: 'none',
};

/**
 * Procedural surface textures. Hairline repeats at low alpha are what separate a
 * card face from a plain gradient div; no assets involved.
 */
const TEXTURES: Record<Exclude<CardTexture, 'none'>, { image: string; size?: string }> = {
  weave: {
    image: 'repeating-linear-gradient(115deg, rgba(255,255,255,.038) 0 1px, transparent 1px 6px)',
  },
  hairline: {
    image: 'repeating-linear-gradient(45deg, rgba(255,255,255,.030) 0 1px, transparent 1px 14px)',
  },
  guilloche: {
    image: 'repeating-radial-gradient(circle at 30% 20%, rgba(255,255,255,.025) 0 1px, transparent 1px 9px)',
  },
  dots: {
    image: 'radial-gradient(circle, rgba(255,255,255,.05) 1px, transparent 1px)',
    size: '7px 7px',
  },
};

const SHEEN =
  'linear-gradient(118deg, rgba(255,255,255,.14) 0%, rgba(255,255,255,.04) 34%, transparent 58%)';

const EDGE_HIGHLIGHT =
  'inset 0 1px 0 rgba(255,255,255,.22), inset 0 -1px 0 rgba(0,0,0,.25)';

interface CardSurfaceProps {
  /** Omit for the no-card placeholder — renders flat, with no texture or sheen. */
  skin?: CardSkin;
  face?: 'front' | 'back';
  style?: React.CSSProperties;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}

export function CardSurface({
  skin,
  face = 'front',
  style,
  className,
  onClick,
  children,
}: CardSurfaceProps) {
  const texture = skin && skin.texture !== 'none' ? TEXTURES[skin.texture] : undefined;
  const sheen = skin?.sheen ?? 0;

  // The only knowledge that crosses the material/content boundary: content reads
  // this as rgba(var(--card-ink), α) instead of hardcoding white.
  const ink = skin?.ink === 'dark' ? '17, 17, 17' : '255, 255, 255';

  const surfaceStyle = {
    position: 'relative',
    overflow: 'hidden',
    background: skin ? skin[face] : 'var(--bg-card)',
    '--card-ink': ink,
    ...style,
  } as React.CSSProperties;

  return (
    <div className={className} style={surfaceStyle} onClick={onClick}>
      {texture && (
        <div style={{ ...FILL, backgroundImage: texture.image, backgroundSize: texture.size }} />
      )}

      {/* geometry layer — the large low-opacity shapes that break up the gradient */}
      {/* TODO(phase 2): render skin.geometry here, still below content. */}

      {children}

      {sheen > 0 && (
        <div style={{ ...FILL, background: SHEEN, opacity: sheen, boxShadow: EDGE_HIGHLIGHT }} />
      )}
    </div>
  );
}

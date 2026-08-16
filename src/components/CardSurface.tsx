import React from 'react';
import type { CardSkin, CardTexture, CardGeometry } from '../utils';
import { CardBrandWatermark } from './CardBrandLogo';

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

/**
 * The large, low-opacity shapes that stop a gradient reading as a flat div. Drawn
 * at the card's own 1.586 ratio and stretched with preserveAspectRatio="none", so
 * one shape set works at every card size.
 *
 * Filled with currentColor, and the <svg> takes its color from --card-ink, so the
 * shapes lighten a dark card and darken a light one without a second shape set.
 */
const GEOMETRY: Record<Exclude<CardGeometry, 'none'>, React.ReactNode> = {
  // Faceted planes sweeping in from the right — the Axis/Flipkart family.
  chevron: (
    <>
      <polygon points="100,0 100,63 52,63 79,31.5 52,0" fill="currentColor" opacity="0.06" />
      <polygon points="74,0 99,31.5 74,63 58,63 83,31.5 58,0" fill="currentColor" opacity="0.04" />
    </>
  ),
  // Thin diagonal cuts across the whole face — the CSB/Jupiter look.
  slash: (
    <>
      <polygon points="2,63 34,0 41,0 9,63" fill="currentColor" opacity="0.05" />
      <polygon points="48,63 84,0 88,0 52,63" fill="currentColor" opacity="0.035" />
      <polygon points="88,63 100,40 100,52 95,63" fill="currentColor" opacity="0.05" />
    </>
  ),
  // Two broad folded planes — reads like light breaking across a flat surface.
  facet: (
    <>
      <polygon points="0,0 100,0 100,18 0,46" fill="currentColor" opacity="0.05" />
      <polygon points="0,63 100,33 100,63" fill="currentColor" opacity="0.035" />
    </>
  ),
  // Soft circles bleeding off the corners. Absorbs the radial blob the statement
  // header used to draw by hand.
  arc: (
    <>
      <circle cx="88" cy="-6" r="42" fill="currentColor" opacity="0.05" />
      <circle cx="10" cy="72" r="30" fill="currentColor" opacity="0.03" />
    </>
  ),
};

const SHEEN =
  'linear-gradient(118deg, rgba(255,255,255,.14) 0%, rgba(255,255,255,.04) 34%, transparent 58%)';

const EDGE_HIGHLIGHT =
  'inset 0 1px 0 rgba(255,255,255,.22), inset 0 -1px 0 rgba(0,0,0,.25)';

/**
 * ISO/IEC 7810 ID-1 — the ratio every physical payment card is cut to. Exported
 * because the flip card sets it on its perspective wrapper rather than on the
 * surface itself, and both need to agree.
 */
export const CARD_ASPECT_RATIO = 1.586;

/**
 * Corner radius as a share of the card's width (~3.7% is the real ID-1 radius),
 * so it scales instead of staying 16px on every size.
 *
 * The two values are deliberate: a single percentage resolves horizontally
 * against width and vertically against height, which on a 1.586 box gives
 * *elliptical* corners. Scaling the vertical figure by the aspect ratio
 * (3.7 x 1.586) makes them circular again at any width.
 */
export const CARD_RADIUS = '3.7% / 5.87%';

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
  const geometry = skin && skin.geometry !== 'none' ? GEOMETRY[skin.geometry] : undefined;
  const sheen = skin?.sheen ?? 0;

  // The only knowledge that crosses the material/content boundary: content reads
  // this as rgba(var(--card-ink), α) instead of hardcoding white.
  const ink = skin?.ink === 'dark' ? '17, 17, 17' : '255, 255, 255';

  const surfaceStyle = {
    position: 'relative',
    overflow: 'hidden',
    aspectRatio: String(CARD_ASPECT_RATIO),
    borderRadius: CARD_RADIUS,
    background: skin ? skin[face] : 'var(--bg-card)',
    '--card-ink': ink,
    ...style,
  } as React.CSSProperties;

  return (
    <div className={className} style={surfaceStyle} onClick={onClick}>
      {texture && (
        <div style={{ ...FILL, backgroundImage: texture.image, backgroundSize: texture.size }} />
      )}

      {geometry && (
        <svg
          viewBox="0 0 100 63"
          preserveAspectRatio="none"
          style={{ ...FILL, width: '100%', height: '100%', color: 'rgb(var(--card-ink))' }}
        >
          {geometry}
        </svg>
      )}

      {/* The issuer's own symbol standing in for the geometry layer. Same slot,
          same job — below content, above texture. */}
      {skin?.watermark && face === 'front' && (
        <div
          style={{
            ...FILL,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            overflow: 'hidden',
            color: 'rgb(var(--card-ink))',
            opacity: 0.09,
          }}
        >
          <CardBrandWatermark brand={skin.watermark} />
        </div>
      )}

      {children}

      {sheen > 0 && <div style={{ ...FILL, background: SHEEN, opacity: sheen }} />}

      {/* Kept off the sheen layer so per-skin sheen opacity doesn't dim the edge:
          the lit top edge is the card's geometry catching light, not the gloss. */}
      {skin && <div style={{ ...FILL, boxShadow: EDGE_HIGHLIGHT }} />}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Cuboid } from 'lucide-react';

// Circular avatar for an investment holding. Renders the real brand logo when a URL resolves and
// loads; otherwise (no URL, or the image 404s / a registry domain is wrong) it falls back to the
// app's colored-initials circle — so coverage gaps never show a broken image.

const PALETTE = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7', '#a29bfe'];

// logo.dev (with fallback=404) has no logo for plenty of real domains — e.g. nmdcsteel.com — so a
// correctly-resolved domain still 404s into initials. Before giving up, try that same domain's
// favicon via Google, which covers many of those gaps. Only applies to img.logo.dev *domain* URLs
// (not the /ticker/ guess endpoint, which has no domain to fall back to).
function faviconFallback(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'img.logo.dev') return null;
    const path = u.pathname.replace(/^\//, '');
    if (!path || path.startsWith('ticker/')) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(path)}&sz=128`;
  } catch {
    return null;
  }
}

export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash = hash & hash;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function LogoAvatar({ name, logoUrl, size, metal }: { name: string; logoUrl: string | null; size: number; metal?: 'gold' | 'silver' }) {
  // Ordered logo sources to try before initials: the resolved logo URL, then (for logo.dev domain
  // URLs) that domain's favicon. `srcIdx` advances on each <img> error; when it runs past the end
  // we render initials.
  const sources = logoUrl ? [logoUrl, faviconFallback(logoUrl)].filter((s): s is string => !!s) : [];
  const [srcIdx, setSrcIdx] = useState(0);
  // Reset to the first source if the URL changes (e.g. user adds a logo.dev token).
  useEffect(() => { setSrcIdx(0); }, [logoUrl]);

  // Commodities aren't a brand — render a metallic gold/silver bullion bar instead of a logo or
  // initials. The bar is a small inline SVG ingot (lucide has no bullion icon).
  if (metal) {
    const isGold = metal === 'gold';
    const MetalIcon = Cuboid;
    return (
      <div
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isGold
            ? 'linear-gradient(135deg, #f9e08a 0%, #e6b800 45%, #b8860b 100%)'
            : 'linear-gradient(135deg, #f5f5f5 0%, #cacaca 45%, #9a9a9a 100%)'
        }}
      >
        <MetalIcon size={Math.round(size * 0.52)} color={isGold ? '#7a5600' : '#4f4f4f'} strokeWidth={2} />
      </div>
    );
  }

  const showImg = srcIdx < sources.length;

  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        flexShrink: 0,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: showImg ? '#ffffff' : getAvatarColor(name),
        color: 'white',
        fontWeight: 700,
        fontSize: `${size * 0.32}px`
      }}
    >
      {showImg ? (
        <img
          src={sources[srcIdx]}
          alt={name}
          loading="lazy"
          onError={() => setSrcIdx(i => i + 1)}
          // cover (not contain) so a brand icon's own square background fills the circle and gets
          // clipped round, instead of floating as a square inside it. These logo/favicon sources
          // are square icons, so nothing meaningful is cropped.
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block'
          }}
        />
      ) : (
        getInitials(name)
      )}
    </div>
  );
}

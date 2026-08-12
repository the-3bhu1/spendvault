import { useState, useEffect, useMemo } from 'react';
import { Cuboid, ShieldUser, WalletMinimal } from 'lucide-react';
import { getCachedLogo, cacheLogoImage, getLogoShape, ensureLogoShape } from '../services/LogoService';

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

export function LogoAvatar({ name, logoUrl, size, metal, isEpf, isWallet, accountType }: { name: string; logoUrl: string | null; size: number; metal?: 'gold' | 'silver'; isEpf?: boolean; isWallet?: boolean; accountType?: string }) {
  // Ordered logo sources to try before initials: the resolved logo URL, then (for logo.dev domain
  // URLs) that domain's favicon. `srcIdx` advances on each <img> error; when it runs past the end
  // we render initials. Each remote source is transparently swapped for its cached base64 data:
  // URL when one exists, so real logos render instantly and work with no network (see LogoService).
  // Resolved once per URL rather than on every render: caching a source mid-life would otherwise swap
  // a painted <img>'s src from the remote URL to its freshly-cached data: URL and flash it for a
  // frame. The cache is meant to be consumed on the NEXT mount, and this pins it to that.
  const { remoteSources, sources } = useMemo(() => {
    const remote = logoUrl ? [logoUrl, faviconFallback(logoUrl)].filter((s): s is string => !!s) : [];
    return { remoteSources: remote, sources: remote.map(s => getCachedLogo(s) || s) };
  }, [logoUrl]);
  const [srcIdx, setSrcIdx] = useState(0);
  // Reset to the first source if the URL changes (e.g. user adds a logo.dev token).
  useEffect(() => { setSrcIdx(0); }, [logoUrl]);

  // How the chosen source's own pixels sit in their canvas, which decides the plate colour behind it
  // and whether it needs zooming to fill the circle — see the shape-analysis block in LogoService.
  // Read straight from the measurement cache rather than mirrored into state, so a source measured in
  // any earlier session (or by a sibling avatar of the same brand) is already right on FIRST paint —
  // which is the whole point, since the flicker being fixed came from the presentation changing
  // between mounts. `tick` exists only to re-render once a fresh measurement lands.
  const activeSrc = remoteSources[srcIdx] || '';
  const [, bumpShape] = useState(0);
  const shape = getLogoShape(activeSrc);

  if (isEpf) {
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
          background: 'linear-gradient(135deg, #e0f2fe 0%, #93c5fd 50%, #60a5fa 100%)'
        }}
      >
        {/* ShieldUser, matching getAccountTypeIcon('epf'): the avatar and the picker icon are the same
            account type, so they mustn't disagree. Landmark here also collided with bank accounts. */}
        <ShieldUser size={Math.round(size * 0.52)} color="#1e3a8a" strokeWidth={2} />
      </div>
    );
  }

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
  const isPhysicalCash = isWallet || accountType === 'cash';

  // Zoom a padded mark until its farthest ink just touches the circle, and centre it there. All of
  // this is in fractions of the avatar's own size, so one calculation serves every call site's size.
  //
  // `objectFit: contain` maps a natural pixel p to the container fraction 0.5 + (p - n/2) * u, where
  // u = min(1/nw, 1/nh) is the fitted scale. That puts the ink radius at `r * u` and the box's centre
  // at some offset from the middle; scaling by `k` about the centre and translating by -k*(offset)
  // lands the mark dead centre at the largest size that still clears the clip edge (0.5 - a hair).
  // Capped at 2.5x, past which a mark occupying a sliver of its canvas would upscale to mush.
  const fit = (() => {
    const box = shape?.box;
    if (!box) return null;
    const u = Math.min(1 / box.nw, 1 / box.nh);
    const rInk = box.r * u;
    if (rInk <= 0) return null;
    const k = Math.min(2.5, 0.48 / rInk);
    const dx = ((box.x + box.w / 2) - box.nw / 2) * u;
    const dy = ((box.y + box.h / 2) - box.nh / 2) * u;
    return `translate(${(-k * dx * 100).toFixed(3)}%, ${(-k * dy * 100).toFixed(3)}%) scale(${k.toFixed(4)})`;
  })();

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
        // The artwork's own edge colour once measured, so nothing behind a logo can read as a rim —
        // not leftover transparent padding, and not the antialiased boundary of the border-radius.
        // White until then (and for marks that float on transparency), since brand logos are drawn
        // for light backgrounds and a dark mark on the card colour would vanish on the dark theme.
        background: showImg ? (shape?.plate || '#ffffff') : getAvatarColor(name),
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
          // Once a remote source paints successfully, persist its bytes so the next open (and any
          // offline render) shows the real logo instead of falling back to initials. No-op when the
          // source is already a cached data: URL.
          //
          // A successful paint is also proof the source is reachable, which makes this the right
          // moment to measure its shape — and the reason the measurement hangs off onLoad rather than
          // an effect: a measurement that fails (offline, CORS) is deliberately not cached so a later
          // load can retry, and an effect keyed on "still unmeasured" would spin on that forever.
          onLoad={() => {
            cacheLogoImage(sources[srcIdx]);
            if (activeSrc && getLogoShape(activeSrc) === undefined) {
              void ensureLogoShape(activeSrc).then(() => bumpShape(n => n + 1));
            }
          }}
          onError={() => setSrcIdx(i => i + 1)}
          // Full-bleed artwork uses cover, so a brand icon's own square background fills the circle
          // and gets clipped round instead of floating as a square inside it. A padded mark switches
          // to contain — the zoom above is expressed in the fitted coordinate space, and contain is
          // the only fit that doesn't crop first and invalidate it.
          style={{
            width: '100%',
            height: '100%',
            objectFit: fit ? 'contain' : 'cover',
            display: 'block',
            transform: fit || undefined
          }}
        />
      ) : isPhysicalCash ? (
        <WalletMinimal size={Math.round(size * 0.48)} strokeWidth={2.2} />
      ) : (
        getInitials(name)
      )}
    </div>
  );
}

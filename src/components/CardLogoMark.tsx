import { useEffect, useState } from 'react';
import type { Account } from '../types';
import { LogoAvatar, type LogoStatus } from './LogoAvatar';
import { getCardLogoUrl, getCardIssuerLogoUrl, isCoBrandedCard, LOGOS_UPDATED_EVENT } from '../services/LogoService';

/* A credit card's mark, everywhere it is shown — the tiles, the rows, the detail hero.

   A CO-BRANDED card carries two identities and the plastic shows both: the programme the card is
   named for (IndianOil, Marriott, Swiggy) and the bank that issues it (HDFC). The programme leads —
   it is what the card is called and the mark printed biggest — so it fills the circle. The bank sits
   on its lower-right rim as a smaller round stamp, overlapping the edge: a countersign, the way an
   issuer's mark sits in the corner of a co-brand lockup. It reads as "an IndianOil card, issued by
   HDFC" without a word, and keeps the one-circle footprint every list here is laid out around.

   A plain bank card has one identity and keeps one mark. The stamp also stays away when no bank logo
   can be found: a monogram in that spot would be a second guess sitting on top of the first. */
export function CardLogoMark({ account, size }: { account: Account; size: number }) {
  const issuerUrl = isCoBrandedCard(account) ? getCardIssuerLogoUrl(account) : null;
  const [issuerStatus, setIssuerStatus] = useState<LogoStatus>('loading');
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!isCoBrandedCard(account)) return;
    const onLogos = () => rerender(n => n + 1);
    window.addEventListener(LOGOS_UPDATED_EVENT, onLogos);
    return () => window.removeEventListener(LOGOS_UPDATED_EVENT, onLogos);
  }, [account]);
  const stamp = Math.round(size * 0.44);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <LogoAvatar name={account.name} logoUrl={getCardLogoUrl(account)} size={size} accountType={account.type} />
      {issuerUrl && (
        <div
          title="Issuing bank"
          style={{
            display: issuerStatus === 'none' ? 'none' : 'block',
            position: 'absolute',
            right: -Math.round(size * 0.22),
            bottom: -Math.round(size * 0.12),
            width: stamp,
            height: stamp,
            borderRadius: '50%',
            // A dark ring parts the stamp from the circle under it on any background — a tile's
            // gradient, the hero's wax — and a soft drop lifts it, so it reads as laid ON the mark.
            boxShadow: '0 0 0 2px rgba(0,0,0,0.6), 0 2px 5px rgba(0,0,0,0.45)',
            overflow: 'hidden',
            zIndex: 2,
          }}
        >
          <LogoAvatar name="" logoUrl={issuerUrl} size={stamp} accountType={account.type} onStatus={setIssuerStatus} />
        </div>
      )}
    </div>
  );
}

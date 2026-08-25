import React, { useEffect, useState } from 'react';

interface RollingNumberProps {
  value: number;
  fontSize?: string;
  fontFamily?: string;
  /** Drop the paise. Summary surfaces — the Wealth tree's total, the Dashboard hero — show whole
   *  rupees, because two decimal places on a figure nobody reconciles at this level is noise. Every
   *  detail screen keeps them, so its figures still match Accounts digit for digit. */
  whole?: boolean;
}

const RollingNumber: React.FC<RollingNumberProps> = ({ 
  value, 
  fontSize = '3.5rem',
  fontFamily = '"Playfair Display", serif',
  whole = false
}) => {
  // Starts already landed when the viewer has asked for less motion: twenty digit-heights of travel
  // per column is exactly the kind of animation that setting exists to refuse. Read once, in state,
  // rather than through a media query in CSS — the roll is a transform on inline styles, so there is
  // no rule for a @media block to override.
  const [reduceMotion] = useState(() =>
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [animate, setAnimate] = useState(reduceMotion);

  useEffect(() => {
    if (reduceMotion) return;
    // Small delay to trigger animation after mount
    const timer = setTimeout(() => setAnimate(true), 100);
    return () => clearTimeout(timer);
  }, [reduceMotion]);

  // Format the number to Indian currency style
  const formatted = Math.abs(value).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });

  const prefix = value < 0 ? '-' : '';
  // Split into main and decimal: "₹21,153.00" -> ["₹21,153", "00"]
  const [mainPart, decimalPart] = formatted.split('.');

  const chars = (prefix + mainPart).split('');

  return (
    <div style={{ 
      display: 'inline-flex', 
      alignItems: 'baseline', 
      fontFamily,
      fontWeight: 700,
      fontSize,
      letterSpacing: '-0.02em',
      fontVariantNumeric: 'tabular-nums lining-nums',
      overflow: 'hidden',
    }}>
      {chars.map((char, i) => {
        const isDigit = /[0-9]/.test(char);
        if (!isDigit) {
          // Static character (₹, comma, minus)
          return (
            <span 
              key={`s-${i}`} 
              style={{ 
                display: 'inline-block',
                opacity: animate ? 1 : 0,
                transition: reduceMotion ? 'none' : `opacity 0.4s ease ${i * 0.04}s`
              }}
            >
              {char}
            </span>
          );
        }

        const targetDigit = parseInt(char);
        // Each digit rolls through 0-9 twice then lands on target
        // Total positions: 20 + targetDigit (two full cycles + final position)
        const totalRoll = 20 + targetDigit;

        return (
          <span
            key={`d-${i}`}
            style={{
              display: 'inline-block',
              height: '1em',
              lineHeight: '1em',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                transform: animate
                  ? `translateY(-${totalRoll}em)`
                  : 'translateY(0)',
                transition: reduceMotion ? 'none' : `transform ${0.8 + i * 0.06}s cubic-bezier(0.2, 0.8, 0.2, 1) ${i * 0.04}s`,
              }}
            >
              {/* Generate digits: 0,1,2,...9,0,1,...9,0,1,...targetDigit */}
              {Array.from({ length: totalRoll + 1 }, (_, idx) => (
                <span
                  key={idx}
                  style={{
                    display: 'block',
                    height: '1em',
                    lineHeight: '1em',
                  }}
                >
                  {idx % 10}
                </span>
              ))}
            </span>
          </span>
        );
      })}
      {/* Decimal dot. Absent in whole mode — `decimalPart` is undefined there, so a bare dot would
          otherwise trail the figure. */}
      {decimalPart !== undefined && (
        <span 
          style={{ 
            display: 'inline-block',
            opacity: animate ? 0.5 : 0,
            transition: reduceMotion ? 'none' : `opacity 0.4s ease ${chars.length * 0.04}s`
          }}
        >.</span>
      )}
      {/* Decimal digits — same level as main digits */}
      {decimalPart?.split('').map((char, i) => {
        const globalIdx = chars.length + 1 + i;
        const targetDigit = parseInt(char);
        const totalRoll = 20 + targetDigit;

        return (
          <span
            key={`dec-${i}`}
            style={{
              display: 'inline-block',
              height: '1em',
              lineHeight: '1em',
              overflow: 'hidden',
              position: 'relative',
              opacity: 0.5,
            }}
          >
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                transform: animate
                  ? `translateY(-${totalRoll}em)`
                  : 'translateY(0)',
                transition: reduceMotion ? 'none' : `transform ${0.8 + globalIdx * 0.06}s cubic-bezier(0.2, 0.8, 0.2, 1) ${globalIdx * 0.04}s`,
              }}
            >
              {Array.from({ length: totalRoll + 1 }, (_, idx) => (
                <span
                  key={idx}
                  style={{
                    display: 'block',
                    height: '1em',
                    lineHeight: '1em',
                  }}
                >
                  {idx % 10}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </div>
  );
};

export default RollingNumber;

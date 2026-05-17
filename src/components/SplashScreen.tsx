import React, { useEffect, useState } from 'react';
import TransparentLogo from './TransparentLogo';

const SplashScreen: React.FC = () => {
  const [fade, setFade] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setFade(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`splash-screen ${fade ? 'fade-out' : ''}`}>
      <div className="splash-content">
        <TransparentLogo src="/logo.png" className="splash-logo" />
        <h1 className="splash-title" style={{ textTransform: 'lowercase' }}>spendvault</h1>
      </div>
    </div>
  );
};

export default SplashScreen;

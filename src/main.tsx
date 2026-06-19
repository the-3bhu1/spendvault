import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { FinanceProvider } from './FinanceContext.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FinanceProvider>
      <App />
    </FinanceProvider>
  </StrictMode>
);

// FOUT guard: #root starts hidden (see index.css). We reveal it only once every custom font is
// loaded, so no screen ever paints with the fallback font and then swaps — the flash users saw on
// first launch (numbers in Overpass Mono especially). Fonts are bundled locally so this resolves
// in a few ms; the timeout guarantees we never keep the UI hidden if the Font Loading API is
// missing or a file fails to load.
const revealApp = () => document.documentElement.classList.add('fonts-loaded');

if ('fonts' in document) {
  const fontsToLoad = [
    '400 1em Inter', '500 1em Inter', '600 1em Inter', '700 1em Inter', '800 1em Inter',
    '400 1em "Overpass Mono"', '600 1em "Overpass Mono"', '700 1em "Overpass Mono"',
    '700 1em "Playfair Display"', '800 1em "Playfair Display"',
  ];
  Promise.all(fontsToLoad.map(f => document.fonts.load(f)))
    .then(() => document.fonts.ready)
    .then(revealApp)
    .catch(revealApp);
  // Safety net — never block the UI for more than 1.5s.
  setTimeout(revealApp, 1500);
} else {
  revealApp();
}

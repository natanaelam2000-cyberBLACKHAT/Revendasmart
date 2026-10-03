import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import './launch-intro.css';

let launchClaimed = false;
export function claimColdLaunch(storage: Storage | null, native: boolean, reload: boolean) {
  if (!native || reload || launchClaimed) return false;
  launchClaimed = true;
  try {
    if (storage?.getItem('rs:launch-intro-shown')) return false;
    storage?.setItem('rs:launch-intro-shown', '1');
  } catch { /* In-memory guard still prevents a second intro in this document. */ }
  return true;
}
const showAtLaunch = typeof window !== 'undefined' && (() => {
  try {
  let storage: Storage | null = null;
  try { storage = window.sessionStorage; } catch { /* Optional. */ }
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return claimColdLaunch(storage, Capacitor.isNativePlatform(), navigation?.type === 'reload');
  } catch { return false; }
})();

export function LaunchIntro() {
  const [visible, setVisible] = useState(showAtLaunch);
  useEffect(() => {
    if (!visible) return;
    let reduced = false;
    try { reduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches); }
    catch { setVisible(false); return; }
    const timer = window.setTimeout(() => setVisible(false), reduced ? 800 : 5000);
    return () => window.clearTimeout(timer);
  }, [visible]);
  if (!visible) return null;
  return <div className="rs-launch-intro" role="status" aria-label="Abrindo Revenda Smart" data-testid="launch-intro">
    <div className="rs-launch-brand">
      <img src="/logo-revenda-smart-symbol-official.png" alt="" onError={() => setVisible(false)} />
      <span>Revenda Smart</span>
    </div>
    <button type="button" onClick={() => setVisible(false)}>Continuar</button>
  </div>;
}

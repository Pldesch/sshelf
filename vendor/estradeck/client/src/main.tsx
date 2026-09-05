import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './studio.css';

// This app uses no service worker. If a stale one is registered on localhost
// (commonly left behind by a different project that previously used this port),
// it intercepts requests and serves old assets that survive even a hard reload.
// Once our own JS runs, unregister any worker and drop its caches so the app is
// never stale again. The page is still controlled by the old worker until the
// next navigation, so reload once after cleaning up.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    if (regs.length === 0) return;
    Promise.all(regs.map((r) => r.unregister()))
      .then(() => (window.caches ? caches.keys() : Promise.resolve<string[]>([])))
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => window.location.reload());
  });
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

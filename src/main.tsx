import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';

declare global {
  interface Window {
    __ziaDeferredPrompt?: Event | null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__ziaDeferredPrompt = e;
    window.dispatchEvent(new Event('zia-install-ready'));
  });
}

registerSW({
  immediate: true,
});

// When Vite runs with HMR disabled, vite-plugin-pwa's dev virtual register is a no-op;
// register the classic dev service worker explicitly so Chrome treats Zia AI as a real installable PWA.
if (import.meta.env.DEV && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const registerDevServiceWorker = () => {
    navigator.serviceWorker
      .register('/dev-sw.js?dev-sw', { scope: '/', type: 'classic' })
      .catch((err) => {
        console.warn('Registro do Service Worker PWA (dev):', err);
      });
  };
  if (document.readyState === 'complete') {
    registerDevServiceWorker();
  } else {
    window.addEventListener('load', registerDevServiceWorker, { once: true });
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

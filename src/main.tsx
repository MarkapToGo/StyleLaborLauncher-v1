import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

async function setWindowIcon() {
  try {
    // Only attempt inside Tauri.
    if (!(window as any).__TAURI_INTERNALS__) return;

    // StrictMode can run some code twice in dev; guard with a global flag.
    if ((window as any).__STYLELABOR_ICON_SET__) return;
    (window as any).__STYLELABOR_ICON_SET__ = true;

    const { getCurrentWindow } = await import('@tauri-apps/api/window');

    // Use a PNG buffer; requires `tauri` Cargo feature `image-png` (enabled in src-tauri/Cargo.toml).
    const res = await fetch('/logo-256.png', { cache: 'reload' });
    if (!res.ok) return;
    const bytes = new Uint8Array(await res.arrayBuffer());
    await getCurrentWindow().setIcon(bytes);
  } catch {
    // ignore (e.g. running in browser preview)
  }
}

void setWindowIcon();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

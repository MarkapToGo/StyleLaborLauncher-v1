import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, Square, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const unlistenRef = useRef<(() => void)[]>([]);
  const logDev = (label: string, err: unknown) => {
    try {
      // Avoid noisy logs in production builds.
      if (import.meta.env?.DEV) console.warn(`[window-controls] ${label}`, err);
    } catch {
      // ignore
    }
  };

  const refreshMaximized = useCallback(async () => {
    try {
      const maximized = await getCurrentWindow().isMaximized();
      setIsMaximized(maximized);
    } catch {
      // ignore: window API may be unavailable in some environments (e.g. non-tauri browser preview)
    }
  }, []);

  useEffect(() => {
    refreshMaximized();

    // Keep maximize state in sync with OS actions (snap/maximize/restore)
    (async () => {
      try {
        const win = getCurrentWindow();
        const unlistenResized = await win.onResized(() => refreshMaximized());
        const unlistenFocus = await win.onFocusChanged(() => refreshMaximized());
        unlistenRef.current = [unlistenResized, unlistenFocus];
      } catch (e) {
        logDev('failed to attach window listeners (likely missing permissions or not running in Tauri)', e);
        // ignore: likely not running inside Tauri
      }
    })();

    return () => {
      for (const unlisten of unlistenRef.current) {
        try {
          unlisten();
        } catch {
          // ignore
        }
      }
      unlistenRef.current = [];
    };
  }, [refreshMaximized]);

  const minimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (e) {
      logDev('minimize failed', e);
    }
  };

  const toggleMaximize = async () => {
    try {
      await getCurrentWindow().toggleMaximize();
      await refreshMaximized();
    } catch (e) {
      logDev('toggleMaximize failed', e);
    }
  };

  const close = async () => {
    try {
      await getCurrentWindow().close();
    } catch (e) {
      logDev('close failed', e);
    }
  };

  return (
    <div
      className="flex items-stretch h-full"
      data-tauri-drag-region="false"
      aria-label="Window controls"
    >
      <button
        type="button"
        onClick={minimize}
        className={cn(
          'w-11 h-full inline-flex items-center justify-center',
          'text-text-secondary hover:text-yellow-500 hover:bg-bg-tertiary',
          'transition-colors'
        )}
        data-tauri-drag-region="false"
        aria-label="Minimize"
        title="Minimize"
      >
        <Minus className="w-6 h-6" />
      </button>

      <button
        type="button"
        onClick={toggleMaximize}
        className={cn(
          'w-11 h-full inline-flex items-center justify-center',
          'text-text-secondary hover:text-success hover:bg-bg-tertiary',
          'transition-colors'
        )}
        data-tauri-drag-region="false"
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? <Copy className="w-5 h-5" /> : <Square className="w-5 h-5" />}
      </button>

      <button
        type="button"
        onClick={close}
        className={cn(
          'w-11 h-full inline-flex items-center justify-center',
          'text-text-secondary hover:text-red-500',
          'hover:bg-bg-tertiary transition-colors'
        )}
        data-tauri-drag-region="false"
        aria-label="Close"
        title="Close"
      >
        <X className="w-6 h-6" />
      </button>
    </div>
  );
}



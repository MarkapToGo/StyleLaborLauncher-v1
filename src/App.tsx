import { useRef } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Layout } from './components/layout/Layout';
import { OnboardingOverlay } from './components/onboarding/OnboardingOverlay';
import { Home } from './pages/Home';
import { Profiles } from './pages/Profiles';
import { Modpacks } from './pages/Modpacks';
import { Settings } from './pages/Settings';
import { Console } from './pages/Console';
import { ProfileDetails } from './pages/ProfileDetails';
import { ProfileLogs } from './pages/ProfileLogs';
import { AddContent } from './pages/AddContent';
import { Gallery } from './pages/Gallery';
import { ProfileSettings } from './pages/ProfileSettings';
import { useEffect } from 'react';
import { useAccountStore } from './stores/accountStore';
import { useProfileStore } from './stores/profileStore';
import { useSettingsStore } from './stores/settingsStore';
import { Toaster, toast } from 'sonner';

import { listen } from '@tauri-apps/api/event';
import { useDownloadStore } from './stores/downloadStore';
import { useConsoleStore, type CrashReport } from './stores/consoleStore';
import { useGalleryStore } from './stores/galleryStore';
import type { InstallStage } from './types';

const AnimatedRoutes = () => {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/profiles" element={<Profiles />} />
          <Route path="/modpacks" element={<Modpacks />} />
          <Route path="/profiles/:profileId" element={<ProfileDetails />} />
          <Route path="/profiles/:profileId/settings" element={<ProfileSettings />} />
          <Route path="/profiles/:profileId/add-content" element={<AddContent />} />
          <Route path="/profiles/:profileId/logs" element={<ProfileLogs />} />
          <Route path="/console" element={<Console />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </AnimatePresence>
  );
};

export default function App() {
  const { fetchAccounts } = useAccountStore();
  const { fetchProfiles } = useProfileStore();
  const { fetchSettings } = useSettingsStore();
  const { fetchImages, subscribeToEvents } = useGalleryStore();


  useEffect(() => {
    // Initialize stores on app load
    fetchAccounts();
    fetchProfiles();
    fetchSettings();
    fetchImages();

    // Subscribe to gallery events
    const unsusbscribe = subscribeToEvents();

    return () => {
      unsusbscribe.then(f => f());
    }
  }, []);

  // Track if update check has already run (prevents duplicate toasts in React StrictMode)
  const updateCheckRef = useRef(false);

  useEffect(() => {
    // Bridge backend profile install progress -> global install UI.
    let unlistenProfileInstall: (() => void) | undefined;
    let unlistenModpackInstall: (() => void) | undefined;

    const setupListeners = async () => {
      try {
        // Check for updates (only once)
        if (!updateCheckRef.current) {
          updateCheckRef.current = true;
          try {
            const { check } = await import('@tauri-apps/plugin-updater');
            const { relaunch } = await import('@tauri-apps/plugin-process');

            const update = await check();
            if (update?.available) {
              toast.custom((t) => (
                <div className="bg-popover border border-border rounded-lg shadow-lg p-4 w-[356px] flex flex-col gap-2">
                  <span className="font-semibold text-sm text-popover-foreground">Update Available!</span>
                  <span className="text-xs text-muted-foreground">
                    v{update.version} is available (Current: v{update.currentVersion})
                  </span>
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={async () => {
                        toast.dismiss(t);
                        const loadingToast = toast.loading('Downloading update...');
                        try {
                          await update.downloadAndInstall((event) => {
                            switch (event.event) {
                              case 'Started':
                                // contentLength is optional
                                break;
                              case 'Progress':
                                // event.chunkLength
                                break;
                              case 'Finished':
                                break;
                            }
                          });
                          toast.dismiss(loadingToast);
                          toast.success('Update installed! Restarting...');
                          await relaunch();
                        } catch (e) {
                          toast.dismiss(loadingToast);
                          toast.error('Update failed: ' + String(e));
                        }
                      }}
                      className="bg-primary text-primary-foreground px-3 py-1.5 rounded text-xs font-medium hover:bg-primary/90 transition-colors"
                    >
                      Update & Restart
                    </button>
                    <button
                      onClick={() => toast.dismiss(t)}
                      className="bg-secondary text-secondary-foreground px-3 py-1.5 rounded text-xs font-medium hover:bg-secondary/80 transition-colors"
                    >
                      Later
                    </button>
                  </div>
                </div>
              ), { duration: Infinity });
            }
          } catch (err) {
            console.error('Failed to check for updates:', err);
          }
        }

        unlistenProfileInstall = await listen<{
          profileId: string;
          stage: InstallStage | string;
          message: string;
          progress: number;
          status: 'progress' | 'complete' | 'failed' | string;
        }>('profile_install_progress', (event) => {
          const p = event.payload;
          const stage = (p.stage as InstallStage) || 'downloading_minecraft';
          const ds = useDownloadStore.getState();

          if (p.status === 'failed' || stage === 'failed') {
            ds.failInstall(p.message || 'Installation failed');
            return;
          }

          if (p.status === 'complete' || stage === 'complete') {
            ds.completeInstall();
            // Refresh profiles
            fetchProfiles();
            return;
          }

          // Start once, then update
          if (!ds.isInstalling) {
            ds.startInstall(stage, p.message || 'Installing…');
          }
          ds.updateInstall({ stage, message: p.message || 'Installing…', progress: p.progress ?? 0 });
        });

        // Modpack install progress
        unlistenModpackInstall = await listen<{
          state: string;
          progress: number;
          message?: string;
        }>('modpack_install_progress', (event) => {
          const p = event.payload;
          const ds = useDownloadStore.getState();

          if (p.state === 'error') {
            ds.failInstall(p.message || 'Modpack install failed');
            return;
          }
          if (p.state === 'finished') {
            ds.completeInstall();
            fetchProfiles();
            return;
          }

          if (!ds.isInstalling) {
            ds.startInstall('downloading_mods', p.message || 'Installing modpack...');
          }
          ds.updateInstall({ stage: 'downloading_mods', message: p.message || 'Installing...', progress: p.progress });
        });

      } catch (err) {
        console.error("Failed to setup listeners:", err);
      }
    };

    setupListeners();

    return () => {
      if (unlistenProfileInstall) unlistenProfileInstall();
      if (unlistenModpackInstall) unlistenModpackInstall();
    };
  }, [fetchProfiles]);



  // Game console and status event listeners
  useEffect(() => {
    let unlistenConsole: undefined | (() => void);
    let unlistenStatus: undefined | (() => void);
    let unlistenCrash: undefined | (() => void);

    (async () => {
      try {
        // Listen for game console output
        unlistenConsole = await listen<{
          line: string;
          stream: 'stdout' | 'stderr';
          timestamp: number;
        }>('game_console_output', (event) => {
          const cs = useConsoleStore.getState();
          cs.addLog(event.payload.line, event.payload.stream, event.payload.timestamp);
        });

        // Listen for game status changes
        unlistenStatus = await listen<{
          isRunning: boolean;
          profileId: string;
          pid?: number;
        }>('game_status', (event) => {
          console.log('[App] Game status event:', event.payload);
          try {
            const cs = useConsoleStore.getState();
            const profiles = useProfileStore.getState().profiles || [];
            // Find logic matching profileStore helper
            const profile = profiles.find(p => p.id === event.payload.profileId);

            console.log('[App] Found profile:', profile?.name);

            cs.setGameRunning(
              event.payload.isRunning,
              event.payload.profileId,
              profile?.name || 'Unknown Profile',
              event.payload.pid
            );
          } catch (err) {
            console.error('[App] Failed to update game status:', err);
            // Fallback
            const cs = useConsoleStore.getState();
            cs.setGameRunning(event.payload.isRunning, event.payload.profileId, 'Unknown');
          }
        });

        // Listen for crash reports
        unlistenCrash = await listen<CrashReport>('crash_report', (event) => {
          const cs = useConsoleStore.getState();
          cs.setCrashReport(event.payload);
        });
      } catch {
        // ignore (not running inside Tauri)
      }
    })();

    return () => {
      try {
        unlistenConsole?.();
        unlistenStatus?.();
        unlistenCrash?.();
      } catch {
        // ignore
      }
    };
  }, []);

  return (
    <BrowserRouter>
      <AnimatedRoutes />
      <OnboardingOverlay />
      <Toaster />
    </BrowserRouter>
  );
}

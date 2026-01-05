import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {

  RotateCcw,
  Folder,
  Coffee,
  CheckCircle2,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { ConfirmModal, Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';
import { useSettingsStore } from '../stores/settingsStore';
import { useAccountStore } from '../stores/accountStore';
import { useToastStore } from '../stores/toastStore';
import { settings as settingsApi, utils as utilsApi } from '../lib/tauri';
import { open } from '@tauri-apps/plugin-dialog';
import { cn } from '../lib/utils';
import { FluidBackground } from '../components/backgrounds/FluidBackground';
import { MatrixBackground } from '../components/backgrounds/MatrixBackground';
import { SnowBackground } from '../components/backgrounds/SnowBackground';
import { WavyBackground } from '../components/backgrounds/WavyBackground';
import { OctagonSquareBackground } from '../components/backgrounds/OctagonSquareBackground';
import { VHSBackground } from '../components/backgrounds/VHSBackground';
import { SkinViewer } from '../components/SkinViewer';

export function Settings() {
  const { settings, updateSettings, resetSettings } = useSettingsStore();
  const { activeAccount } = useAccountStore();
  const { success, error } = useToastStore();

  const [localSettings, setLocalSettings] = useState(settings);
  const [systemMemory, setSystemMemory] = useState(16384);
  const [javaVersions, setJavaVersions] = useState<string[]>([]);

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const [isMoveConfirmOpen, setIsMoveConfirmOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isClearCacheConfirmOpen, setIsClearCacheConfirmOpen] = useState(false);
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [resolvedPath, setResolvedPath] = useState<string>('');

  // Factory Reset & Danger Zone State
  const [isDangerZoneOpen, setIsDangerZoneOpen] = useState(false);
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState('');
  const [factoryResetStep, setFactoryResetStep] = useState<'idle' | 'warning' | 'confirm' | 'processing'>('idle');

  // Loading states
  const [isLoadingSystemInfo, setIsLoadingSystemInfo] = useState(true);
  const [areSkinsReady, setAreSkinsReady] = useState(false);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    // Debounced auto-save
    const timer = setTimeout(async () => {
      // Only save if there are actual changes
      if (JSON.stringify(localSettings) !== JSON.stringify(settings)) {
        setIsSaving(true);
        try {
          await updateSettings(localSettings);
          setLastSaved(new Date());
        } catch (err) {
          error('Failed to save settings', String(err));
        } finally {
          setIsSaving(false);
        }
      }
    }, 1000); // 1s debounce to avoid rapid disk writes

    return () => clearTimeout(timer);
  }, [localSettings, updateSettings, settings, error]);

  useEffect(() => {
    if (lastSaved) {
      const timer = setTimeout(() => setLastSaved(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [lastSaved]);

  useEffect(() => {
    // Delay skin rendering to prevent UI freeze on navigation
    const timer = setTimeout(() => setAreSkinsReady(true), 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const fetchSystemInfo = async () => {
      setIsLoadingSystemInfo(true);
      try {
        const memory = await settingsApi.getSystemMemory();
        setSystemMemory(memory);

        // Calculate min memory based on system memory
        let minMem = 2 * 1024;
        if (memory > 32 * 1024) minMem = 6 * 1024;
        else if (memory >= 16 * 1024) minMem = 5 * 1024;

        // Auto-adjust if current setting is too low
        if (localSettings.defaultMaxMemory < minMem) {
          setLocalSettings(prev => ({
            ...prev,
            defaultMaxMemory: minMem
          }));
        }

        const versions = await settingsApi.detectJava();
        setJavaVersions(versions);

        const path = await utilsApi.getGameDirectory();
        // Strip /instances suffix if present to show the root data directory
        setResolvedPath(path.replace(/[\\/]instances$/, ''));
      } catch (err) {
        // Use defaults if fetch fails
      } finally {
        setIsLoadingSystemInfo(false);
      }
    };
    fetchSystemInfo();
  }, [localSettings.defaultMaxMemory]);

  // Manual save handler removed in favor of auto-save

  const handleReset = () => {
    setIsResetConfirmOpen(true);
  };

  const confirmReset = async () => {
    setIsResetting(true);
    setIsResetConfirmOpen(false);
    try {
      await resetSettings();
      success('Settings reset', 'All settings have been restored to defaults');
    } catch (err) {
      error('Failed to reset settings', String(err));
    } finally {
      setIsResetting(false);
    }
  };

  const handleBrowsePath = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: localSettings.gameDataPath,
      });

      if (selected && typeof selected === 'string') {
        const path = selected;
        // Check if path is different
        if (path !== localSettings.gameDataPath) {
          setTargetPath(path);
          setIsMoveConfirmOpen(true);
        }
      }
    } catch (err) {
      error('Failed to open dialog', String(err));
    }
  };

  const confirmMove = async () => {
    if (!targetPath) return;

    setIsMoving(true);
    setIsMoveConfirmOpen(false);

    try {
      await settingsApi.setGameDataPath(targetPath);

      // Update local settings immediately to reflect change
      setLocalSettings(prev => ({ ...prev, gameDataPath: targetPath }));
      await updateSettings({ ...localSettings, gameDataPath: targetPath }); // Force update config

      success('Data Moved', 'Game data effectively moved to new location.');
    } catch (err) {
      error('Failed to move data', String(err));
    } finally {
      setIsMoving(false);
      setTargetPath(null);
    }
  };

  const handleClearCache = async () => {
    setIsClearing(true);
    setIsClearCacheConfirmOpen(false);
    try {
      await settingsApi.clearCache();
      success('Cache Cleared', 'Temporary files have been removed.');
    } catch (err) {
      error('Failed to clear cache', String(err));
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="w-full space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Settings</h1>
          <p className="text-xs text-text-secondary mt-0.5">
            Configure your launcher preferences
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AnimatePresence mode="wait">
            {isSaving ? (
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex items-center gap-1.5 text-xs text-text-muted"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </motion.div>
            ) : lastSaved ? (
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex items-center gap-1.5 text-xs text-green-400"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Saved</span>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleReset}
            isLoading={isResetting}
            leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
          >
            Reset to Defaults
          </Button>
        </div>
      </div>

      {/* Installation Path */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card hover={false} padding="sm">
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-blue-500/15 flex items-center justify-center">
                <Folder className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <CardTitle>Installation Path</CardTitle>
                <CardDescription>Location for game instances and assets</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Game Data Directory
              </label>
              <div className="flex gap-1.5 w-full items-center">
                {isLoadingSystemInfo ? (
                  <Skeleton className="h-8 flex-1" />
                ) : (
                  <div
                    className="input input-sm flex-1 opacity-75 cursor-default flex items-center px-3 min-w-0"
                    title={resolvedPath}
                  >
                    <div className="flex min-w-0 w-full font-mono text-xs text-text-secondary">
                      {/* Responsive middle truncation: Head truncates, Tail stays visible */}
                      <span className="truncate">
                        {resolvedPath.length > 25 ? resolvedPath.slice(0, -25) : resolvedPath}
                      </span>
                      <span className="flex-shrink-0">
                        {resolvedPath.length > 25 ? resolvedPath.slice(-25) : ''}
                      </span>
                    </div>
                  </div>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleBrowsePath}
                  isLoading={isMoving}
                  disabled={isLoadingSystemInfo}
                >
                  Change
                </Button>
              </div>
              <p className="text-[10px] text-text-muted mt-1">
                Changing this will move all your existing instances and assets to the new location.
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Java Settings */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card hover={false} padding="sm">
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-orange-500/15 flex items-center justify-center">
                <Coffee className="w-4 h-4 text-orange-400" />
              </div>
              <div>
                <CardTitle>Java Settings</CardTitle>
                <CardDescription>Configure Java runtime for Minecraft</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Java Path
              </label>
              <div className="flex gap-1.5">
                {isLoadingSystemInfo ? (
                  <Skeleton className="h-8 flex-1" />
                ) : (
                  <select
                    value={localSettings.javaPath}
                    onChange={(e) => setLocalSettings({ ...localSettings, javaPath: e.target.value })}
                    className="input input-sm flex-1"
                  >
                    <option value="">Auto-detect</option>
                    {javaVersions.map((path) => (
                      <option key={path} value={path}>{path}</option>
                    ))}
                  </select>
                )}
                <Button variant="secondary" size="sm">
                  <Folder className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    try {
                      success('Installing Java', 'Downloading and installing recommended Java versions...');
                      await settingsApi.installJava();
                      success('Java Installed', 'Recommended Java versions installed successfully');
                      // Refresh versions
                      const versions = await settingsApi.detectJava();
                      setJavaVersions(versions);
                    } catch (err) {
                      error('Failed to install Java', String(err));
                    }
                  }}
                >
                  Install Recommended
                </Button>
              </div>
              <p className="text-[10px] text-text-muted mt-1">
                Leave empty to automatically detect Java installation
              </p>
            </div>


            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-medium text-text-secondary">
                  Maximum Memory Allocation
                </label>
                <div className="text-xs font-mono text-accent">
                  {isLoadingSystemInfo ? (
                    <Skeleton className="h-4 w-12" />
                  ) : (
                    `${(localSettings.defaultMaxMemory / 1024).toFixed(1).replace(/\.0$/, '')} GB`
                  )}
                </div>
              </div>

              <div className="relative h-6 flex items-center">
                {(() => {
                  const sysMem = systemMemory; // MB
                  let minMem = 2 * 1024;
                  if (sysMem > 32 * 1024) minMem = 6 * 1024;
                  else if (sysMem >= 16 * 1024) minMem = 5 * 1024;

                  const maxMem = Math.floor(systemMemory * 0.75);
                  const currentMem = localSettings.defaultMaxMemory;

                  // Calculate percentage for width
                  // Handle edge case where max <= min (though shouldn't happen with these values)
                  const range = maxMem - minMem;
                  const percent = range > 0 ? ((currentMem - minMem) / range) * 100 : 0;

                  return (
                    <>
                      {/* Background Track */}
                      <div className="absolute w-full h-1 bg-bg-tertiary rounded-lg" />

                      {/* Colored Progress Track */}
                      <div
                        className="absolute h-1 bg-accent rounded-l-lg"
                        style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
                      />

                      {/* Interactive Slider (Transparent Track, Visible Thumb) */}
                      <input
                        type="range"
                        min={minMem}
                        max={maxMem}
                        step="512"
                        value={localSettings.defaultMaxMemory}
                        onChange={(e) => setLocalSettings({
                          ...localSettings,
                          defaultMaxMemory: parseInt(e.target.value)
                        })}
                        className="absolute w-full h-1 bg-transparent rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:scale-110 z-20"
                      />

                      <div className="flex justify-between mt-8 text-[10px] text-text-muted w-full">
                        <span>{minMem / 1024} GB</span>
                        <span>{((systemMemory * 0.75) / 1024).toFixed(1).replace(/\.0$/, '')} GB (75%)</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>


      {/* Personalization */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card hover={false} padding="sm">
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-purple-500/15 flex items-center justify-center">
                <div className="w-4 h-4 text-purple-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".5" /><circle cx="17.5" cy="10.5" r=".5" /><circle cx="8.5" cy="7.5" r=".5" /><circle cx="6.5" cy="12.5" r=".5" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" /></svg>
                </div>
              </div>
              <div>
                <CardTitle>Personalization</CardTitle>
                <CardDescription>Customize the look and feel</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Home Page Background
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Default Option */}
                <button
                  type="button"
                  onClick={() => setLocalSettings({ ...localSettings, homeBackground: 'default' })}
                  className={cn(
                    "relative group flex flex-col items-start gap-2 p-2 rounded-lg border transition-all duration-200 outline-none h-full",
                    (!localSettings.homeBackground || localSettings.homeBackground === 'default')
                      ? "bg-accent/10 border-accent ring-1 ring-accent/50"
                      : "bg-bg-tertiary border-border hover:border-border-hover hover:bg-bg-hover"
                  )}
                >
                  <div className="w-full h-32 rounded bg-bg-primary relative overflow-hidden border border-border/50">
                    {/* Mini Preview of Spotlight & Grid */}
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-accent/40 via-transparent to-transparent opacity-70" />
                    <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:12px_12px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-xs font-medium text-white">Default</span>
                    <span className="text-[10px] text-text-muted">Spotlight & Grid</span>
                  </div>
                  {(!localSettings.homeBackground || localSettings.homeBackground === 'default') && (
                    <div className="absolute top-2 right-2 w-4 h-4 bg-accent rounded-full flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  )}
                </button>

                {/* Matrix Option */}
                <button
                  type="button"
                  onClick={() => setLocalSettings({ ...localSettings, homeBackground: 'matrix' })}
                  className={cn(
                    "relative group flex flex-col items-start gap-2 p-2 rounded-lg border transition-all duration-200 outline-none h-full",
                    localSettings.homeBackground === 'matrix'
                      ? "bg-accent/10 border-accent ring-1 ring-accent/50"
                      : "bg-bg-tertiary border-border hover:border-border-hover hover:bg-bg-hover"
                  )}
                >
                  <div className="w-full h-32 rounded bg-black relative overflow-hidden border border-border/50">
                    <div className="absolute inset-0 flex items-center justify-center font-mono overflow-hidden">
                      <MatrixBackground isPreview={true} />
                    </div>
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-xs font-medium text-white">Matrix</span>
                    <span className="text-[10px] text-text-muted">Digital Rain</span>
                  </div>
                  {localSettings.homeBackground === 'matrix' && (
                    <div className="absolute top-2 right-2 w-4 h-4 bg-accent rounded-full flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  )}
                </button>

                {/* Fluid Option */}
                <button
                  type="button"
                  onClick={() => setLocalSettings({ ...localSettings, homeBackground: 'fluid' })}
                  className={cn(
                    "relative group flex flex-col items-start gap-2 p-2 rounded-lg border transition-all duration-200 outline-none h-full",
                    localSettings.homeBackground === 'fluid'
                      ? "bg-accent/10 border-accent ring-1 ring-accent/50"
                      : "bg-bg-tertiary border-border hover:border-border-hover hover:bg-bg-hover"
                  )}
                >
                  <div className="w-full h-32 rounded bg-black relative overflow-hidden border border-border/50">
                    <FluidBackground />
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-xs font-medium text-white">Fluid</span>
                    <span className="text-[10px] text-text-muted">Animated Blobs</span>
                  </div>
                  {localSettings.homeBackground === 'fluid' && (
                    <div className="absolute top-2 right-2 w-4 h-4 bg-accent rounded-full flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  )}
                </button>

                {/* Octagon Square Option */}
                <button
                  type="button"
                  onClick={() => setLocalSettings({ ...localSettings, homeBackground: 'octagon-square' })}
                  className={cn(
                    "relative group flex flex-col items-start gap-2 p-2 rounded-lg border transition-all duration-200 outline-none h-full",
                    localSettings.homeBackground === 'octagon-square'
                      ? "bg-accent/10 border-accent ring-1 ring-accent/50"
                      : "bg-bg-tertiary border-border hover:border-border-hover hover:bg-bg-hover"
                  )}
                >
                  <div className="w-full h-32 rounded bg-[#222] relative overflow-hidden border border-border/50 flex items-center justify-center">
                    <OctagonSquareBackground size="40px" />
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-xs font-medium text-white">Octagon</span>
                    <span className="text-[10px] text-text-muted">Shape Shifter</span>
                  </div>
                  {localSettings.homeBackground === 'octagon-square' && (
                    <div className="absolute top-2 right-2 w-4 h-4 bg-accent rounded-full flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  )}
                </button>

                {/* Wavy Option */}
                <button
                  type="button"
                  onClick={() => setLocalSettings({ ...localSettings, homeBackground: 'wavy' })}
                  className={cn(
                    "relative group flex flex-col items-start gap-2 p-2 rounded-lg border transition-all duration-200 outline-none h-full",
                    localSettings.homeBackground === 'wavy'
                      ? "bg-accent/10 border-accent ring-1 ring-accent/50"
                      : "bg-bg-tertiary border-border hover:border-border-hover hover:bg-bg-hover"
                  )}
                >
                  <div className="w-full h-32 rounded bg-bg-primary relative overflow-hidden border border-border/50">
                    <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                      <WavyBackground className="h-full" />
                    </div>
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-xs font-medium text-white">Wavy</span>
                    <span className="text-[10px] text-text-muted">Pulsating Waves</span>
                  </div>
                  {localSettings.homeBackground === 'wavy' && (
                    <div className="absolute top-2 right-2 w-4 h-4 bg-accent rounded-full flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  )}
                </button>

                {/* Snow Option */}
                <button
                  type="button"
                  onClick={() => setLocalSettings({ ...localSettings, homeBackground: 'snow' })}
                  className={cn(
                    "relative group flex flex-col items-start gap-2 p-2 rounded-lg border transition-all duration-200 outline-none h-full",
                    localSettings.homeBackground === 'snow'
                      ? "bg-accent/10 border-accent ring-1 ring-accent/50"
                      : "bg-bg-tertiary border-border hover:border-border-hover hover:bg-bg-hover"
                  )}
                >
                  <div className="w-full h-32 rounded bg-[#0d101b] relative overflow-hidden border border-border/50">
                    <div className="absolute inset-0 opacity-50 overflow-hidden">
                      <SnowBackground />
                    </div>
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-xs font-medium text-white">Snow</span>
                    <span className="text-[10px] text-text-muted">Winter Vibe</span>
                  </div>
                  {localSettings.homeBackground === 'snow' && (
                    <div className="absolute top-2 right-2 w-4 h-4 bg-accent rounded-full flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  )}
                </button>

                {/* VHS Option */}
                <button
                  type="button"
                  onClick={() => setLocalSettings({ ...localSettings, homeBackground: 'vhs' })}
                  className={cn(
                    "relative group flex flex-col items-start gap-2 p-2 rounded-lg border transition-all duration-200 outline-none h-full",
                    localSettings.homeBackground === 'vhs'
                      ? "bg-accent/10 border-accent ring-1 ring-accent/50"
                      : "bg-bg-tertiary border-border hover:border-border-hover hover:bg-bg-hover"
                  )}
                >
                  <div className="w-full h-32 rounded bg-black relative overflow-hidden border border-border/50">
                    <div className="absolute inset-0 grayscale contrast-150 flex items-center justify-center overflow-hidden">
                      <VHSBackground isPreview={true} />
                    </div>
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-xs font-medium text-white">VHS</span>
                    <span className="text-[10px] text-text-muted">Retro Glitch</span>
                  </div>
                  {localSettings.homeBackground === 'vhs' && (
                    <div className="absolute top-2 right-2 w-4 h-4 bg-accent rounded-full flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  )}
                </button>

                {/* Minimal Option */}
                <button
                  type="button"
                  onClick={() => setLocalSettings({ ...localSettings, homeBackground: 'none' })}
                  className={cn(
                    "relative group flex flex-col items-start gap-2 p-2 rounded-lg border transition-all duration-200 outline-none h-full",
                    localSettings.homeBackground === 'none'
                      ? "bg-accent/10 border-accent ring-1 ring-accent/50"
                      : "bg-bg-tertiary border-border hover:border-border-hover hover:bg-bg-hover"
                  )}
                >
                  <div className="w-full h-32 rounded bg-bg-primary relative overflow-hidden border border-border/50">
                    {/* Plain Background */}
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-xs font-medium text-white">Minimal</span>
                    <span className="text-[10px] text-text-muted">Solid color focus</span>
                  </div>
                  {localSettings.homeBackground === 'none' && (
                    <div className="absolute top-2 right-2 w-4 h-4 bg-accent rounded-full flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  )}
                </button>
              </div>

              {/* VHS Specific Settings */}
              {localSettings.homeBackground === 'vhs' && (
                <div className="mt-4 p-3 bg-bg-tertiary rounded-lg border border-border flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-text-primary">Disable VHS Scanlines</span>
                    <span className="text-xs text-text-muted">Removes the scanlines and sets background to black</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLocalSettings(s => ({ ...s, vhsNoLines: !s.vhsNoLines }))}
                    className={cn(
                      "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg-primary",
                      localSettings.vhsNoLines ? "bg-accent" : "bg-bg-primary border border-border"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                        localSettings.vhsNoLines ? "translate-x-6" : "translate-x-1"
                      )}
                    />
                  </button>
                </div>
              )}

              {/* Skin Pose Selector */}
              <div className="mt-4">
                <div className="flex flex-col mb-3">
                  <span className="text-sm font-medium text-text-primary">Skin Pose</span>
                  <span className="text-xs text-text-muted">Choose how your character appears on the home screen</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { id: 'cool', name: 'Cool', desc: 'Relaxed Stance' },
                    { id: 'idle', name: 'Idle', desc: 'Animated Breathing' },
                    { id: 'walk', name: 'Walking', desc: 'Animated Walk' },
                    { id: 'hero', name: 'Hero', desc: 'Confident Stance' },
                    { id: 'wave', name: 'Wave', desc: 'Waving Hand' },
                    { id: 'levitate', name: 'Levitate', desc: 'Float & Spin' },
                    { id: 'sit', name: 'Sit', desc: 'Sitting Down' },
                    { id: 'sleep', name: 'Sleep', desc: 'Slower Breathing' },
                  ].map((pose) => (
                    <button
                      key={pose.id}
                      type="button"
                      onClick={() => setLocalSettings({ ...localSettings, skinPose: pose.id as any })}
                      disabled={!areSkinsReady}
                      className={cn(
                        "relative group flex flex-col items-start gap-2 p-2 rounded-lg border transition-all duration-200 outline-none h-full",
                        (localSettings.skinPose === pose.id || (!localSettings.skinPose && pose.id === 'cool'))
                          ? "bg-accent/10 border-accent ring-1 ring-accent/50"
                          : "bg-bg-tertiary border-border hover:border-border-hover hover:bg-bg-hover"
                      )}
                    >
                      <div className="w-full h-32 rounded bg-bg-primary relative overflow-hidden border border-border/50 flex items-center justify-center">
                        {/* Render skin viewer only when ready to avoid lag */}
                        {areSkinsReady ? (
                          <SkinViewer
                            uuid={activeAccount?.uuid}
                            skinUrl={activeAccount?.skinUrl}
                            width={150}
                            height={200}
                            animation={pose.id as any}
                            className="scale-75 origin-center" // Scale down for preview
                          />
                        ) : (
                          <Skeleton className="w-full h-full bg-white/5" />
                        )}
                      </div>
                      <div className="flex flex-col items-start">
                        <span className="text-xs font-medium text-white">{pose.name}</span>
                        <span className="text-[10px] text-text-muted">{pose.desc}</span>
                      </div>
                      {(localSettings.skinPose === pose.id || (!localSettings.skinPose && pose.id === 'cool')) && (
                        <div className="absolute top-2 right-2 w-4 h-4 bg-accent rounded-full flex items-center justify-center z-10">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
      {/* Integrations */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card hover={false} padding="sm">
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-indigo-500/15 flex items-center justify-center">
                <div className="w-4 h-4 text-indigo-400">
                  {/* Discord icon */}
                  <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                  </svg>
                </div>
              </div>
              <div>
                <CardTitle>Integrations</CardTitle>
                <CardDescription>Connect with external services</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-medium text-text-primary mb-0.5">
                  Discord Rich Presence
                </label>
                <p className="text-[10px] text-text-muted">
                  Show what you're playing on your Discord profile
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLocalSettings(s => ({ ...s, discordRpc: !s.discordRpc }))}
                className={cn(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg-primary",
                  (localSettings.discordRpc !== false) ? "bg-accent" : "bg-bg-primary border border-border"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                    (localSettings.discordRpc !== false) ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <button
        type="button"
        onClick={() => setIsDangerZoneOpen(!isDangerZoneOpen)}
        className="w-full flex items-center justify-between p-4 bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 rounded-lg transition-colors group"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-red-500/10 flex items-center justify-center group-hover:bg-red-500/20 transition-colors">
            <Trash2 className="w-4 h-4 text-red-500" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-medium text-red-500 group-hover:text-red-400 transition-colors">Danger Zone</h3>
            <p className="text-xs text-red-500/60 group-hover:text-red-500/80">Destructive actions and resets</p>
          </div>
        </div>

        {isDangerZoneOpen ? (
          <ChevronUp className="w-4 h-4 text-red-500/50" />
        ) : (
          <ChevronDown className="w-4 h-4 text-red-500/50" />
        )}
      </button>

      {/* Collapsible Content */}
      <AnimatePresence>
        {isDangerZoneOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-x border-b border-red-500/20 rounded-b-lg -mt-1 pt-4 pb-2 px-2 space-y-2 bg-red-500/5 mx-1">
              {/* Clear Cache Item */}
              <div className="flex items-center justify-between p-2 hover:bg-red-500/5 rounded-md transition-colors">
                <div>
                  <div className="text-xs font-medium text-text-primary">Clear Cache</div>
                  <div className="text-[10px] text-text-muted">Removes temporary files. Safe to do.</div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsClearCacheConfirmOpen(true)}
                >
                  Clear Cache
                </Button>
              </div>

              {/* Factory Reset Item */}
              <div className="flex items-center justify-between p-2 hover:bg-red-500/5 rounded-md transition-colors">
                <div>
                  <div className="text-xs font-medium text-red-400">Factory Reset</div>
                  <div className="text-[10px] text-text-muted">Wipes all data, accounts, instances, and settings. Cannot be undone.</div>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setFactoryResetStep('warning')}
                >
                  Factory Reset
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <ConfirmModal
        isOpen={isMoveConfirmOpen}
        title="Move Game Data"
        message={`Are you sure you want to move game data to "${targetPath}"? Use this only if you know what you are doing.`}
        confirmText="Move Data"
        onConfirm={confirmMove}
        onClose={() => {
          setIsMoveConfirmOpen(false);
          setTargetPath(null);
        }}
        isLoading={isMoving}
      />

      <ConfirmModal
        isOpen={isResetConfirmOpen}
        title="Reset Settings"
        message="Are you sure you want to reset all settings to their default values?"
        confirmText="Reset"
        onConfirm={confirmReset}
        onClose={() => setIsResetConfirmOpen(false)}
        isLoading={isResetting}
      />

      <ConfirmModal
        isOpen={isClearCacheConfirmOpen}
        title="Clear Cache"
        message="This will remove temporary files. Your instances and saves will not be affected."
        confirmText="Clear Cache"
        onConfirm={handleClearCache}
        onClose={() => setIsClearCacheConfirmOpen(false)}
        isLoading={isClearing}
      />

      {/* Factory Reset - Step 1: Warning */}
      <ConfirmModal
        isOpen={factoryResetStep === 'warning'}
        title="Factory Reset - Warning"
        message="This will delete EVERYTHING: all worlds, saves, screenshots, modpacks, and accounts. The application will be reset to a fresh state."
        confirmText="I Understand, Continue"
        onConfirm={() => setFactoryResetStep('confirm')}
        onClose={() => setFactoryResetStep('idle')}
        variant="danger"
      />

      {/* Factory Reset - Step 2: Final Confirmation */}
      <Modal
        isOpen={factoryResetStep === 'confirm'}
        onClose={() => {
          setFactoryResetStep('idle');
          setDeleteConfirmationInput('');
        }}
        title="Factory Reset - Final Confirmation"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Are you absolutely sure? This action <span className="text-red-400 font-bold">CANNOT</span> be undone.
            All your data including worlds and screenshots will be permanently lost.
          </p>

          <div className="space-y-2">
            <label className="text-xs text-text-muted block">
              Type <span className="font-mono text-red-400 font-bold">DELETE</span> to confirm:
            </label>
            <input
              type="text"
              value={deleteConfirmationInput}
              onChange={(e) => setDeleteConfirmationInput(e.target.value)}
              className="input w-full border-red-500/50 focus:border-red-500 text-red-400 placeholder:text-red-500/20"
              placeholder="DELETE"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setFactoryResetStep('idle');
                setDeleteConfirmationInput('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={deleteConfirmationInput !== 'DELETE' || factoryResetStep === 'processing'}
              isLoading={factoryResetStep === 'processing'}
              onClick={async () => {
                setFactoryResetStep('processing');
                try {
                  await settingsApi.factoryReset();
                  success('Factory Reset Complete', 'All data has been wiped. The application will now restart.');
                  setTimeout(async () => {
                    window.location.reload();
                  }, 2000);
                } catch (err) {
                  error('Factory Reset Failed', String(err));
                  setFactoryResetStep('idle');
                  setDeleteConfirmationInput('');
                }
              }}
            >
              WIPE EVERYTHING
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

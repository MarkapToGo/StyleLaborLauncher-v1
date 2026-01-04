import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, LogOut, UserPlus, User, Loader2, Copy, Check, ExternalLink } from 'lucide-react';
import { SkinViewer } from '../SkinViewer';
import { useAccountStore } from '../../stores/accountStore';
import { useConsoleStore } from '../../stores/consoleStore';
import { cn } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { open } from '@tauri-apps/plugin-shell';
import { WindowControls } from './WindowControls';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Detect if we're on Windows (only platform with custom decorations)
const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');

export function Header() {
  const {
    activeAccount,
    accounts,
    startLogin,
    cancelLogin,
    logout,
    switchAccount,
    isLoading,
    loginStep,
    userCode,
    verificationUri,
    error,
    clearError
  } = useAccountStore();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { isGameRunning } = useConsoleStore();

  const handleLogin = async () => {
    setIsDropdownOpen(false);
    await startLogin();
  };

  const handleSwitch = async (uuid: string) => {
    setIsDropdownOpen(false);
    await switchAccount(uuid);
  };

  const handleLogout = async (uuid: string) => {
    await logout(uuid);
  };

  const copyCode = () => {
    if (userCode) {
      navigator.clipboard.writeText(userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };



  const openVerificationUrl = async () => {
    if (verificationUri) {
      await open(verificationUri);
    }
  };

  const openAppRegInfo = async () => {
    await open('https://aka.ms/AppRegInfo');
  };

  // Auto-copy and auto-open when entering device-code step
  useEffect(() => {
    if (loginStep === 'device-code' && userCode && verificationUri) {
      // Copy code
      navigator.clipboard.writeText(userCode).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });

      // Open browser
      open(verificationUri).catch(err => {
        console.error("Failed to open browser:", err);
      });
    }
  }, [loginStep, userCode, verificationUri]);

  const isInvalidAppReg =
    typeof error === 'string' &&
    (error.includes('Invalid app registration') || error.includes('AppRegInfo'));

  const toggleMaximize = async (e: React.MouseEvent) => {
    // Don't treat double-clicks on interactive controls as titlebar maximize.
    const el = e.target as HTMLElement | null;
    if (el?.closest?.('[data-tauri-drag-region="false"]')) return;

    try {
      await getCurrentWindow().toggleMaximize();
    } catch (err) {
      try {
        if (import.meta.env?.DEV) console.warn('[titlebar] toggleMaximize failed', err);
      } catch {
        // ignore
      }
    }
  };

  return (
    <>
      <header
        className="h-12 bg-bg-secondary border-b border-border flex items-stretch"
        {...(isWindows ? { 'data-tauri-drag-region': true } : {})}
      >
        {/* Draggable title bar region (only functional on Windows) */}
        <div
          className="flex-1 flex items-center justify-between px-4 min-w-0 h-full cursor-default select-none"
          {...(isWindows ? { 'data-tauri-drag-region': true, onDoubleClick: toggleMaximize, title: 'Double-click to maximize/restore' } : {})}
        >
          {/* Title / Branding */}
          <div className="flex items-center gap-1.5 min-w-0">
            <h1 className="text-[10px] text-white whitespace-nowrap font-minecraft-five tracking-wider">STYLELABOR</h1>
            <span className="text-[0.75rem] text-white/90 whitespace-nowrap font-poppins mt-1 tracking-wide font-bold">Launcher</span>
          </div>

          <div className="flex items-center gap-3" data-tauri-drag-region="false">
            {/* Instance status badge */}
            {isGameRunning ? (
              <div className="h-9 px-3 bg-green-500/10 rounded-md border border-green-500/30 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-green-400 font-medium">Instance Running</span>
              </div>
            ) : (
              <div className="h-9 px-3 bg-bg-tertiary rounded-md border border-border flex items-center">
                <span className="text-xs text-text-secondary">No instances running</span>
              </div>
            )}

            {/* Account selector */}
            <div className="relative">
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                disabled={isLoading && loginStep === 'idle'}
                className={cn(
                  'flex items-center gap-2 h-9 px-3 rounded-md',
                  'bg-bg-tertiary hover:bg-bg-hover border border-border hover:border-border-hover',
                  'transition-all duration-150',
                  isLoading && loginStep === 'idle' && 'opacity-50 cursor-wait'
                )}
                data-tauri-drag-region="false"
              >
                {activeAccount ? (
                  <>
                    <div className="w-6 h-6 rounded overflow-hidden relative">
                      {activeAccount ? (
                        <SkinViewer
                          skinUrl={activeAccount.skinUrl}
                          uuid={activeAccount.uuid}
                          width={64}
                          height={64}
                          headOnly={true}
                          animation="none"
                          className="w-full h-full"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-bg-tertiary">
                          <User className="w-3.5 h-3.5 text-text-muted" />
                        </div>
                      )}
                    </div>
                    <span className="text-sm font-medium text-white">{activeAccount.username}</span>
                  </>
                ) : (
                  <>
                    <div className="w-6 h-6 rounded bg-bg-hover flex items-center justify-center">
                      <User className="w-3.5 h-3.5 text-text-muted" />
                    </div>
                    <span className="text-sm text-text-secondary">Login</span>
                  </>
                )}
                <ChevronDown className={cn(
                  'w-3.5 h-3.5 text-text-muted transition-transform duration-150',
                  isDropdownOpen && 'rotate-180'
                )} />
              </button>

              {/* Dropdown */}
              <AnimatePresence>
                {isDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsDropdownOpen(false)}
                      data-tauri-drag-region="false"
                    />
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.98 }}
                      transition={{ duration: 0.1 }}
                      className="absolute right-0 mt-1 w-56 bg-bg-secondary rounded-lg border border-border shadow-dropdown z-50 overflow-hidden"
                    >
                      {/* Other accounts */}
                      {accounts.length > 0 && (
                        <div className="p-1.5 border-b border-border">
                          <p className="px-2 py-1 text-[10px] text-text-muted uppercase tracking-wider">
                            Accounts
                          </p>
                          {accounts.map((account) => (
                            <button
                              key={account.uuid}
                              onClick={() => handleSwitch(account.uuid)}
                              className={cn(
                                'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md',
                                'hover:bg-bg-tertiary transition-colors group',
                                account.isActive && 'bg-accent/10'
                              )}
                              data-tauri-drag-region="false"
                            >
                              <div className="w-6 h-6 rounded overflow-hidden relative">
                                <SkinViewer
                                  skinUrl={account.skinUrl}
                                  uuid={account.uuid}
                                  width={64}
                                  height={64}
                                  headOnly={true}
                                  animation="none"
                                  className="w-full h-full"
                                />
                              </div>
                              <span className={cn(
                                'flex-1 text-left text-sm font-medium',
                                account.isActive ? 'text-accent' : 'text-white'
                              )}>
                                {account.username}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleLogout(account.uuid);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-error/20 rounded text-text-muted hover:text-error transition-all"
                                data-tauri-drag-region="false"
                              >
                                <LogOut className="w-3.5 h-3.5" />
                              </button>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Add account */}
                      <div className="p-1.5">
                        <button
                          onClick={handleLogin}
                          className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-bg-tertiary transition-colors text-accent"
                          data-tauri-drag-region="false"
                        >
                          <UserPlus className="w-4 h-4" />
                          <span className="text-sm font-medium">Add Account</span>
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Custom window controls - only on Windows (macOS/Linux use native decorations) */}
        {isWindows && <WindowControls />}
      </header>

      {/* Login Modal */}
      <Modal
        isOpen={loginStep !== 'idle'}
        onClose={cancelLogin}
        title="Microsoft Login"
        size="md"
      >
        <div className="space-y-4">
          {loginStep === 'authorizing' && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Loader2 className="w-8 h-8 text-accent animate-spin mb-4" />
              <p className="text-sm text-white font-medium">Starting authentication...</p>
              <p className="text-xs text-text-secondary mt-1">Please wait...</p>
            </div>
          )}

          {loginStep === 'device-code' && (
            <div className="space-y-6">
              {/* Error Banner */}
              {error && (
                <div className="space-y-3">
                  <div className="bg-error/10 border border-error/20 text-error text-xs p-3 rounded-md">
                    {error}
                  </div>

                  {isInvalidAppReg && (
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="secondary" size="sm" onClick={openAppRegInfo}>
                        Open App Registration Info
                      </Button>
                      <Button variant="secondary" size="sm" onClick={clearError}>
                        Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="text-center space-y-2">
                <p className="text-sm text-text-secondary">
                  To sign in, go to the link below and enter the code:
                </p>
                <a
                  href={verificationUri || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline text-sm font-medium inline-flex items-center gap-1"
                  onClick={openVerificationUrl}
                >
                  {verificationUri}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="bg-bg-tertiary p-4 rounded-lg border border-border text-center">
                <p className="text-xs text-text-secondary mb-2 uppercase tracking-wide">Enter this code</p>
                <div className="flex items-center justify-center gap-3">
                  <span className="text-2xl font-mono font-bold text-white tracking-wider">
                    {userCode}
                  </span>
                  <Button size="sm" variant="secondary" onClick={copyCode}>
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center pt-2">
                <div className="flex items-center gap-2 text-text-secondary">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span className="text-xs">Waiting for you to sign in...</span>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button variant="secondary" onClick={cancelLogin}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

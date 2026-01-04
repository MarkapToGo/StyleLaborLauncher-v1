import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    User,
    Plus,
    LogOut,
    Check,
    Loader2,
    Copy,
    ExternalLink,
    ShieldAlert
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { useToastStore } from '../stores/toastStore';
import { useAccountStore } from '../stores/accountStore';
import { SkinViewer } from '../components/SkinViewer';
import { SkinManager } from '../components/skins/SkinManager';
import { cn } from '../lib/utils';

export function Profiles() {
    const {
        accounts,
        activeAccount,
        fetchAccounts,
        startLogin,
        cancelLogin,
        logout,
        switchAccount,
        isLoading,
        loginStep,
        userCode,
        verificationUri,
        message,
        error: accountError,
        clearError
    } = useAccountStore();

    const { success, error: toastError } = useToastStore();

    const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
    const [copiedCode, setCopiedCode] = useState(false);

    useEffect(() => {
        fetchAccounts();
    }, [fetchAccounts]);

    // Sync modal state with login step
    useEffect(() => {
        if (loginStep === 'device-code' || loginStep === 'authorizing') {
            setIsLoginModalOpen(true);
        } else if (loginStep === 'idle') {
            setIsLoginModalOpen(false);
        }
    }, [loginStep]);

    // Handle errors from store
    useEffect(() => {
        if (accountError) {
            toastError('Account Error', accountError);
            clearError();
        }
    }, [accountError, toastError, clearError]);

    const handleCopyCode = async () => {
        if (userCode) {
            try {
                await navigator.clipboard.writeText(userCode);
                setCopiedCode(true);
                setTimeout(() => setCopiedCode(false), 2000);
                success('Copied', 'Code copied to clipboard');
            } catch (err) {
                // Fallback
            }
        }
    };

    const handleOpenLink = async () => {
        if (verificationUri) {
            import('@tauri-apps/plugin-shell').then(({ open }) => open(verificationUri));
        }
    };

    const handleLogin = () => {
        startLogin();
    };

    const handleCancelLogin = () => {
        cancelLogin();
        setIsLoginModalOpen(false);
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="w-full space-y-6"
        >
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-12rem)]">
                {/* Left: Accounts List (4 cols) */}
                <div className="lg:col-span-4 flex flex-col gap-4 overflow-hidden">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-white">Your Accounts</h2>
                        <Button
                            size="sm"
                            onClick={handleLogin}
                            leftIcon={<Plus className="w-3 h-3" />}
                            isLoading={isLoading && loginStep === 'authorizing'}
                        >
                            Add
                        </Button>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-2">
                        {accounts.map((account, index) => (
                            <motion.div
                                key={account.uuid}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: index * 0.05 }}
                            >
                                <Card
                                    className={cn(
                                        "transition-all duration-300 relative overflow-hidden group",
                                        account.isActive
                                            ? "border-accent bg-accent/5"
                                            : "hover:border-white/20 bg-bg-secondary/40 hover:bg-bg-secondary/60",
                                        "p-3"
                                    )}
                                >
                                    <div className="flex gap-4 items-start p-1">
                                        {/* Avatar / Skin Full Body */}
                                        <div className="w-24 h-40 rounded-xl bg-black/20 overflow-hidden relative border border-white/10 flex-shrink-0 shadow-inner mt-1">
                                            <div className="absolute inset-0 flex justify-center items-center">
                                                <SkinViewer
                                                    uuid={account.uuid}
                                                    skinUrl={account.skinUrl}
                                                    width={150}
                                                    height={280}
                                                    animation="walk"
                                                    zoom={0.6}
                                                    className="mt-4"
                                                />
                                            </div>
                                        </div>

                                        <div className="flex-1 min-w-0 flex flex-col self-stretch justify-between py-1">
                                            <div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <h3 className="font-bold text-lg text-white">
                                                        {account.username}
                                                    </h3>
                                                    {account.isActive && (
                                                        <div className="px-2 py-0.5 rounded-full bg-green-500/20 border border-green-500/30 text-[10px] font-bold text-green-400 shadow-[0_0_10px_rgba(74,222,128,0.2)]">
                                                            ACTIVE
                                                        </div>
                                                    )}
                                                </div>

                                                <p className="text-[10px] text-text-muted font-mono break-all opacity-80 leading-tight">
                                                    {account.uuid}
                                                </p>
                                            </div>

                                            <div className="flex gap-2 mt-2">
                                                {!account.isActive && (
                                                    <Button
                                                        size="sm"
                                                        className="flex-1 h-8 bg-white/10 hover:bg-white/20 text-white border-white/5"
                                                        onClick={() => switchAccount(account.uuid)}
                                                        isLoading={isLoading}
                                                    >
                                                        Select
                                                    </Button>
                                                )}
                                                <Button
                                                    size="sm"
                                                    variant="danger"
                                                    className="flex-1 h-8"
                                                    onClick={() => logout(account.uuid)}
                                                    disabled={isLoading}
                                                    leftIcon={<LogOut className="w-3.5 h-3.5" />}
                                                >
                                                    Logout
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            </motion.div>
                        ))}
                    </div>
                </div>

                {/* Right: Skin Manager (8 cols) */}
                <div className="lg:col-span-8 overflow-hidden h-full">
                    {activeAccount ? (
                        <SkinManager />
                    ) : (
                        <Card className="h-full flex flex-col items-center justify-center text-text-muted bg-bg-secondary/10 border-dashed border-white/5">
                            <User className="w-12 h-12 mb-4 opacity-20" />
                            <p>Select an account to manage skins</p>
                        </Card>
                    )}
                </div>
            </div>

            {/* Login Modal */}
            <Modal
                isOpen={isLoginModalOpen}
                onClose={handleCancelLogin}
                title="Connect Microsoft Account"
                size="md"
                showClose={true}
            >
                <div className="space-y-6 py-2">
                    {loginStep === 'authorizing' && (
                        <div className="flex flex-col items-center justify-center py-8">
                            <Loader2 className="w-10 h-10 text-accent animate-spin mb-4" />
                            <p className="text-text-secondary">Connecting to Microsoft Auth...</p>
                        </div>
                    )}

                    {loginStep === 'device-code' && userCode && (
                        <div className="flex flex-col gap-6">
                            <div className="flex gap-4 p-4 bg-accent/10 border border-accent/20 rounded-xl">
                                <ShieldAlert className="w-6 h-6 text-accent flex-shrink-0 mt-0.5" />
                                <div className="text-sm">
                                    <p className="text-white font-medium mb-1">Action Required</p>
                                    <p className="text-text-secondary">
                                        To add your account, you need to authorize this new device on Microsoft's secure login page.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Device Code</label>
                                <div
                                    className="flex items-center gap-2 bg-black/30 border border-border rounded-lg p-3 group cursor-pointer"
                                    onClick={handleCopyCode}
                                >
                                    <code className="flex-1 text-2xl font-mono text-center text-accent tracking-[0.2em] font-bold">
                                        {userCode}
                                    </code>
                                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-text-muted group-hover:text-white">
                                        {copiedCode ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                                    </Button>
                                </div>
                                <p className="text-xs text-center text-text-muted">Click code to copy</p>
                            </div>

                            <div className="space-y-2">
                                <Button
                                    className="w-full h-12 text-base shadow-lg shadow-accent/20"
                                    onClick={handleOpenLink}
                                    rightIcon={<ExternalLink className="w-4 h-4" />}
                                >
                                    Open Login Page
                                </Button>
                                <p className="text-xs text-center text-text-secondary">
                                    {message || 'Follow instructions in your browser'}
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </Modal>

        </motion.div>
    );
}

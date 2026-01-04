import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Trash2, Loader2, Plus, RefreshCw, Rotate3D } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ConfirmModal } from '../ui/Modal';
import { useAccountStore } from '../../stores/accountStore';
import { useToastStore } from '../../stores/toastStore';
import { skin as skinApi } from '../../lib/tauri';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { SkinViewer } from '../SkinViewer';

interface SkinFile {
    filename: string;
    path: string;
}

const SkinItem = ({
    skin,
    activeAccount,
    isApplying,
    handleApply,
    handleDelete,
    forceBackView
}: {
    skin: SkinFile;
    activeAccount: any;
    isApplying: boolean;
    handleApply: (path: string, variant: 'classic' | 'slim') => void;
    handleDelete: (filename: string) => void;
    forceBackView: boolean;
}) => {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
        >
            <div className="group relative bg-black/20 rounded-lg overflow-hidden border border-white/5 hover:border-accent/50 transition-all">
                <div className="aspect-[3/4] relative bg-gradient-to-b from-transparent to-black/20">
                    <div className="absolute inset-0 flex items-center justify-center py-2">
                        <SkinViewer
                            skinUrl={convertFileSrc(skin.path)}
                            width={180}
                            height={240}
                            animation="none"
                            zoom={0.85}
                            rotationY={forceBackView ? Math.PI : 0}
                            className="w-full h-full"
                        />
                    </div>

                    {/* Overlay Actions */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2 z-20">
                        <Button
                            size="sm"
                            className="w-full"
                            onClick={() => handleApply(skin.path, 'classic')}
                            disabled={isApplying || !activeAccount}
                        >
                            Apply (Classic)
                        </Button>
                        <Button
                            size="sm"
                            variant="secondary"
                            className="w-full text-xs"
                            onClick={() => handleApply(skin.path, 'slim')}
                            disabled={isApplying || !activeAccount}
                        >
                            Apply (Slim)
                        </Button>
                        <Button
                            size="sm"
                            variant="danger"
                            className="w-full h-8"
                            onClick={() => handleDelete(skin.filename)}
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                    </div>
                </div>
                <div className="p-2 bg-black/40 text-[10px] text-center truncate text-text-secondary font-mono">
                    {skin.filename}
                </div>
            </div>
        </motion.div>
    );
};

export function SkinManager() {
    const { activeAccount, updateAccountSkin } = useAccountStore();
    const { success, error } = useToastStore();

    const [skins, setSkins] = useState<SkinFile[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isApplying, setIsApplying] = useState(false);
    const [deletingSkin, setDeletingSkin] = useState<string | null>(null);
    const [globalBackView, setGlobalBackView] = useState(false);

    useEffect(() => {
        loadLibrary();
    }, []);

    const loadLibrary = async () => {
        setIsLoading(true);
        try {
            const library = await skinApi.getLibrary();
            setSkins(library);
        } catch (err) {
            error('Failed to load skin library', String(err));
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpload = async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [{ name: 'Skin Files', extensions: ['png'] }]
            });

            if (selected && typeof selected === 'string') {
                setIsUploading(true);
                await skinApi.saveToLibrary(selected);
                await loadLibrary();
                success('Skin Saved', 'New skin added to your library');
            }
        } catch (err) {
            error('Failed to upload skin', String(err));
        } finally {
            setIsUploading(false);
        }
    };

    const handleApply = async (skinPath: string, variant: 'classic' | 'slim' = 'classic') => {
        if (!activeAccount) return;

        setIsApplying(true);
        try {
            await skinApi.upload(activeAccount.accessToken, skinPath, variant);
            // Update local state immediately
            updateAccountSkin(activeAccount.uuid, convertFileSrc(skinPath));
            success('Skin Applied', 'Your skin has been updated! It may take a few minutes to appear in-game.');
        } catch (err) {
            error('Failed to apply skin', String(err));
        } finally {
            setIsApplying(false);
        }
    };

    const handleDelete = async () => {
        if (!deletingSkin) return;

        try {
            await skinApi.deleteFromLibrary(deletingSkin);
            await loadLibrary();
            success('Details', 'Skin removed from library');
        } catch (err) {
            error('Failed to delete skin', String(err));
        } finally {
            setDeletingSkin(null);
        }
    };

    return (
        <Card className="h-full flex flex-col bg-bg-secondary/30 backdrop-blur-sm border-white/5">
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
                <div>
                    <h3 className="font-bold text-white">Skin Library</h3>
                    <p className="text-xs text-text-muted">Manage and apply your skins</p>
                </div>
                <div className="flex gap-2">
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setGlobalBackView(!globalBackView)}
                        title="Rotate All Skins"
                    >
                        <Rotate3D className={`w-4 h-4 ${globalBackView ? 'text-accent' : ''}`} />
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={loadLibrary}
                        disabled={isLoading}
                        title="Refresh Library"
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleUpload}
                        leftIcon={<Plus className="w-4 h-4" />}
                        isLoading={isUploading}
                    >
                        Add Skin
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {isLoading ? (
                    <div className="h-full flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-accent animate-spin" />
                    </div>
                ) : skins.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-text-muted opacity-50 space-y-2">
                        <Upload className="w-8 h-8" />
                        <p className="text-sm">No skins in library</p>
                        <Button variant="ghost" size="sm" onClick={handleUpload} className="mt-2">
                            Upload one now
                        </Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                        <AnimatePresence>
                            {skins.map((skin) => (
                                <SkinItem
                                    key={skin.filename}
                                    skin={skin}
                                    activeAccount={activeAccount}
                                    isApplying={isApplying}
                                    handleApply={handleApply}
                                    handleDelete={() => setDeletingSkin(skin.filename)}
                                    forceBackView={globalBackView}
                                />
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </div>

            <ConfirmModal
                isOpen={!!deletingSkin}
                onClose={() => setDeletingSkin(null)}
                onConfirm={handleDelete}
                title="Delete Skin"
                message="Are you sure you want to remove this skin from your library?"
                confirmText="Delete"
                isLoading={isLoading}
            />
        </Card>
    );
}

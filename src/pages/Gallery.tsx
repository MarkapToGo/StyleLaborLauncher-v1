import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { convertFileSrc } from '@tauri-apps/api/core';
import { gallery } from '../lib/tauri';
import { formatTimeAgo } from '../lib/utils';
import { Trash2, FolderOpen, Image as ImageIcon, LayoutGrid, List, Square, Grid2x2, Copy, Check } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useToastStore } from '../stores/toastStore';
import { ConfirmModal } from '../components/ui/Modal';
import { useGalleryStore, type GalleryImage } from '../stores/galleryStore';
import { useSettingsStore } from '../stores/settingsStore';

export function Gallery() {
    const { images, isLoading, removeImage } = useGalleryStore();
    const { settings, updateSettings } = useSettingsStore();
    const [selectedImage, setSelectedImage] = useState<GalleryImage | null>(null);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const { error, success } = useToastStore();

    const viewMode = settings.galleryViewMode || 'grid';
    const gridSize = settings.galleryGridSize || 4;

    const getSizeClasses = (cols: number) => {
        if (cols <= 2) return {
            title: 'text-lg mb-1',
            subtitle: 'text-sm mb-3',
            meta: 'text-xs',
            icon: 'w-5 h-5',
            padding: 'p-5'
        };
        if (cols <= 4) return {
            title: 'text-xs mb-0.5',
            subtitle: 'text-[10px] mb-2',
            meta: 'text-[10px]',
            icon: 'w-3.5 h-3.5',
            padding: 'p-3'
        };
        return {
            title: 'text-[10px] mb-0',
            subtitle: 'text-[9px] mb-1',
            meta: 'text-[9px]',
            icon: 'w-3 h-3',
            padding: 'p-2'
        };
    };

    const sizeClasses = getSizeClasses(gridSize);

    // Fetching is handled in App.tsx now

    const handleDelete = async () => {
        if (!deleteId) return;
        try {
            await removeImage(deleteId);
            setDeleteId(null);
            setSelectedImage(null); // Close modal if open
            success('Deleted', 'Screenshot removed from gallery');
        } catch (err) {
            error('Failed to delete', String(err));
        }
    };

    const [copiedId, setCopiedId] = useState<string | null>(null);

    const handleCopy = async (img: GalleryImage) => {
        try {
            await gallery.copyToClipboard(img.path);
            setCopiedId(img.id);
            setTimeout(() => setCopiedId(null), 2000);
            success('Copied', 'Screenshot copied to clipboard');
        } catch (err) {
            error('Failed to copy', 'Could not copy image to clipboard');
            console.error(err);
        }
    };

    const openFolder = async () => {
        try {
            await gallery.openFolder();
        } catch (e) {
            console.error(e);
            error('Error', 'Could not open gallery folder');
        }
    };

    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center justify-between mb-6 px-1">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                        <ImageIcon className="w-6 h-6 text-accent" />
                        Gallery
                    </h1>
                    <p className="text-sm text-text-secondary mt-1">
                        Browse and manage your screenshots
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {/* View Toggles */}
                    <div className="flex items-center gap-1 bg-bg-secondary p-1 rounded-md border border-border/50">
                        <button
                            onClick={() => updateSettings({ galleryViewMode: 'grid' })}
                            className={`p-1.5 rounded-sm transition-colors ${viewMode === 'grid' ? 'bg-bg-tertiary text-accent shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
                            title="Grid View"
                        >
                            <LayoutGrid className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => updateSettings({ galleryViewMode: 'list' })}
                            className={`p-1.5 rounded-sm transition-colors ${viewMode === 'list' ? 'bg-bg-tertiary text-accent shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
                            title="List View"
                        >
                            <List className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Grid Size Controls (Only in Grid Mode) */}
                    {viewMode === 'grid' && (
                        <div className="flex items-center gap-1 bg-bg-secondary p-1 rounded-md border border-border/50">
                            <button
                                onClick={() => updateSettings({ galleryGridSize: 2 })}
                                className={`p-1.5 rounded-sm transition-colors ${gridSize === 2 ? 'bg-bg-tertiary text-accent shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
                                title="Extra Large View (2 Columns)"
                            >
                                <Square className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => updateSettings({ galleryGridSize: 4 })}
                                className={`p-1.5 rounded-sm transition-colors ${gridSize === 4 ? 'bg-bg-tertiary text-accent shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
                                title="Large View (4 Columns)"
                            >
                                <Grid2x2 className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => updateSettings({ galleryGridSize: 6 })}
                                className={`p-1.5 rounded-sm transition-colors ${gridSize === 6 ? 'bg-bg-tertiary text-accent shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
                                title="Medium View (6 Columns)"
                            >
                                <LayoutGrid className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={openFolder}
                        leftIcon={<FolderOpen className="w-4 h-4" />}
                    >
                        Open Folder
                    </Button>
                </div>
            </div>

            {isLoading ? (
                <div className="flex-1 flex items-center justify-center">
                    <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
            ) : images.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-text-muted opacity-50">
                    <ImageIcon className="w-16 h-16 mb-4" />
                    <p>No screenshots yet.</p>
                    <p className="text-xs mt-2">Take screenshots in-game (F2) to see them here.</p>
                </div>
            ) : (
                <div className={`overflow-y-auto pb-10 pr-2 custom-scrollbar ${viewMode === 'grid' ? 'grid gap-4' : 'flex flex-col gap-2'}`}
                    style={viewMode === 'grid' ? { gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))` } : {}}
                >
                    <AnimatePresence mode='popLayout'>
                        {images.map((img) => (
                            <motion.div
                                layout
                                key={img.id}
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className={`group bg-bg-tertiary rounded-lg overflow-hidden border border-border/50 hover:border-accent/50 transition-all cursor-pointer ${viewMode === 'list' ? 'flex h-24' : 'relative aspect-video'
                                    }`}
                                onClick={() => setSelectedImage(img)}
                            >
                                {/* Image Container */}
                                <div className={`${viewMode === 'list' ? 'w-40 h-full' : 'w-full h-full'}`}>
                                    <img
                                        src={convertFileSrc(img.path)}
                                        alt={img.filename}
                                        loading="lazy"
                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                    />
                                </div>

                                {/* Content Overlay/Side Panel */}
                                {viewMode === 'grid' ? (
                                    <div
                                        className={`absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end ${sizeClasses.padding}`}
                                        title={new Date(img.timestamp).toLocaleString()}
                                    >
                                        <p className={`font-bold text-white truncate ${sizeClasses.title}`}>{img.origin_profile || 'Unknown Profile'}</p>
                                        <p className={`font-medium text-gray-300 truncate opacity-80 ${sizeClasses.subtitle}`}>{img.filename}</p>

                                        <div className="flex items-center justify-between">
                                            <span className={`${sizeClasses.meta} text-accent font-medium`}>{formatTimeAgo(img.timestamp)}</span>
                                            <button
                                                className="p-1.5 bg-bg-secondary hover:bg-bg-primary text-text-muted hover:text-white rounded-md transition-colors mr-1"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleCopy(img);
                                                }}
                                                title="Copy to Clipboard"
                                            >
                                                {copiedId === img.id ? <Check className={sizeClasses.icon} /> : <Copy className={sizeClasses.icon} />}
                                            </button>
                                            <button
                                                className="p-1.5 bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white rounded-md transition-colors"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDeleteId(img.id);
                                                }}
                                            >
                                                <Trash2 className={sizeClasses.icon} />
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex-1 p-3 flex items-center justify-between">
                                        <div>
                                            <h3 className="font-bold text-text-primary text-sm mb-1">{img.origin_profile || 'Unknown Profile'}</h3>
                                            <p className="text-xs text-text-muted">{img.filename}</p>
                                            <p className="text-xs text-text-secondary mt-1">{new Date(img.timestamp).toLocaleString()}</p>
                                        </div>

                                        <div className="flex items-center gap-4">
                                            <span className="text-xs text-accent font-medium bg-accent/10 px-2 py-1 rounded-full">
                                                {formatTimeAgo(img.timestamp)}
                                            </span>
                                            <button
                                                className="p-2 bg-bg-secondary hover:bg-bg-primary text-text-muted hover:text-text-primary rounded-md transition-colors"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleCopy(img);
                                                }}
                                                title="Copy to Clipboard"
                                            >
                                                {copiedId === img.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                            </button>
                                            <button
                                                className="p-2 bg-bg-secondary hover:bg-red-500/20 text-text-muted hover:text-red-400 rounded-md transition-colors"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDeleteId(img.id);
                                                }}
                                                title="Delete Screenshot"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}

            {/* Lightbox / Preview Modal */}
            <AnimatePresence>
                {selectedImage && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
                        onClick={() => setSelectedImage(null)}
                    >
                        <div className="relative max-w-full max-h-full" onClick={e => e.stopPropagation()}>
                            <motion.img
                                initial={{ scale: 0.9 }}
                                animate={{ scale: 1 }}
                                src={convertFileSrc(selectedImage.path)}
                                className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
                            />
                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-black/50 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
                                <span className="text-xs text-white/80">{selectedImage.filename}</span>
                                <div className="w-px h-4 bg-white/20" />
                                <button
                                    onClick={() => handleCopy(selectedImage)}
                                    className="text-white/80 hover:text-white transition-colors"
                                    title="Copy to Clipboard"
                                >
                                    {copiedId === selectedImage.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                </button>
                                <button
                                    onClick={() => {
                                        setDeleteId(selectedImage.id);
                                        // Don't close yet, let modal handle it
                                    }}
                                    className="text-red-400 hover:text-red-300 transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <ConfirmModal
                isOpen={!!deleteId}
                onClose={() => setDeleteId(null)}
                onConfirm={handleDelete}
                title="Delete Screenshot"
                message="Are you sure you want to delete this screenshot? This action cannot be undone."
                confirmText="Delete"
                variant="danger"
            />
        </div>
    );
}

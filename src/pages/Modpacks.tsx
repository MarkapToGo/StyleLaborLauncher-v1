import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Search,
  Download,
  Package,
  Play,
  Eye,
  Trash2
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Progress } from '../components/ui/Progress';
import { useToastStore } from '../stores/toastStore';
import { useProfileStore } from '../stores/profileStore';
import { useDownloadStore } from '../stores/downloadStore';

import { modpacks, profiles } from '../lib/tauri';
import type { Modpack, Profile } from '../types';




// Loader icon paths
const LOADER_ICONS: Record<string, string> = {
  neoforge: '/modlauncher-icons/neoforge-icon.png',
  forge: '/modlauncher-icons/forge-icon.webp',
  fabric: '/modlauncher-icons/fabric-icon.webp',
  vanilla: '/modlauncher-icons/vanilla-minecraft-icon.png',
};

const getLoaderIcon = (loader: string): string | null => {
  return LOADER_ICONS[loader.toLowerCase()] || null;
};

export function Modpacks() {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<Modpack[]>([]);
  const [allModpacks, setAllModpacks] = useState<Modpack[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [selectedModpack, setSelectedModpack] = useState<Modpack | null>(null);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  
  // Refactored: No longer using mods modal here
  // const [isModsModalOpen, setIsModsModalOpen] = useState(false);
  // const [viewingProfile, setViewingProfile] = useState<Profile | null>(null);
  // const [installedMods, setInstalledMods] = useState<ModInfo[]>([]);
  // const [isLoadingMods, setIsLoadingMods] = useState(false);

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState<Profile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
  const navigate = useNavigate();
  
  const { error, success } = useToastStore();
  const { profiles: profilesList, launchProfile, isLaunching: isLaunchingProfile, fetchProfiles } = useProfileStore();
  const { currentInstall, isInstalling } = useDownloadStore();

  // LocalStorage cache key  
  const CACHE_KEY = 'modpacksCache';
  const CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes cache validity

  // Load from cache immediately on mount
  useEffect(() => {
    // Try to load cached modpacks instantly
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (data && Array.isArray(data) && data.length > 0) {
          setAllModpacks(data);
          setResults(data);
          // If cache is still fresh, don't show loading state
          if (Date.now() - timestamp < CACHE_EXPIRY_MS) {
            setIsInitialLoad(false);
          }
        }
      }
    } catch (e) {
      // Ignore cache errors
    }
    // Always fetch fresh data in background
    fetchModpacks();
  }, []);

  // Filter results locally when query changes
  useEffect(() => {
    let filtered = allModpacks;
    
    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(m => m.name.toLowerCase().includes(q));
    }

    setResults(filtered);
  }, [allModpacks, searchQuery]);

  const fetchModpacks = async () => {
    setIsLoading(true);
    try {
      // searchCurseforge now returns the server list
      const serverPacks = await modpacks.searchCurseforge(""); 
      setAllModpacks(serverPacks);
      setResults(serverPacks);
      
      // Save to cache
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          data: serverPacks,
          timestamp: Date.now()
        }));
      } catch (e) {
        // Ignore cache save errors
      }
    } catch (err) {
      error('Failed to load modpacks', String(err));
    } finally {
      setIsLoading(false);
      setIsInitialLoad(false);
    }
  };

  const handleInstall = async (modpack: Modpack) => {
    setSelectedModpack(modpack);
    setIsInstallModalOpen(true);
  };

  const confirmInstall = async () => {
    if (!selectedModpack) return;
    
    setIsInstallModalOpen(false);
    // Don't set local state; the global listener in App.tsx will pick up the start event.
    // However, we can optimistically set it here if we want instant feedback before the first event.
    // For now, let's rely on the store.
    
    try {
      await modpacks.installFromId(selectedModpack.id); 
    } catch (err) {
      error('Installation failed', String(err));
    }
  };

  const handleViewMods = (profile: Profile) => {
    navigate(`/profiles/${profile.id}`);
  };



  const handleDeleteClick = (profile: Profile) => {
    setProfileToDelete(profile);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!profileToDelete) return;
    setIsDeleting(true);
    try {
      await profiles.delete(profileToDelete.id);
      await fetchProfiles();
      success('Modpack deleted', `${profileToDelete.name} has been removed`);
    } catch (err) {
      error('Failed to delete', String(err));
    } finally {
      setIsDeleting(false);
      setIsDeleteModalOpen(false);
      setProfileToDelete(null);
    }
  };



  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      className="w-full space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-lg font-semibold text-white">Packs</h1>
            <p className="text-xs text-text-secondary mt-0.5">
              Install configured modpacks from the server
            </p>
          </div>
          {/* Subtle loading indicator when refreshing in background */}
          {isLoading && !isInitialLoad && (
            <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          )}
        </div>
      </div>

      {/* Search */}
      <Card hover={false} padding="sm">
        <CardContent>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter modpacks..."
                className="input pl-8 input-sm"
              />
            </div>
            {/* Refresh Button instead of Search */}
            <Button size="sm" onClick={fetchModpacks} isLoading={isLoading}>
              Refresh
            </Button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-4 mt-3">
             {/* ... Filters UI ... */}
             {/* Simplified filters since we probably only have a few packs, but keeping UI is fine */}
          </div>
        </CardContent>
      </Card>

      {/* Installation progress */}
      {isInstalling && currentInstall && (
        <Card hover={false} padding="sm" className="border-accent/20">
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-accent/15 flex items-center justify-center">
                <Download className="w-4 h-4 text-accent animate-pulse" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">{currentInstall.message}</p>
                <Progress value={currentInstall.progress} size="sm" className="mt-1.5" />
              </div>
              <span className="text-xs font-medium text-accent">
                {Math.round(currentInstall.progress)}%
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {results.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {results.map((modpack, index) => {
             const installedProfile = profilesList.find(p => p.sourceId === modpack.id || p.name === modpack.name);
             console.log('[Modpacks] Checking:', modpack.name, 'ID:', modpack.id, 'Installed?', !!installedProfile);
             return (
            <motion.div
              key={modpack.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
            >
              <Card 
                padding="none" 
                className="h-full group hover:border-accent/50 transition-all duration-300 overflow-hidden"
              >
                <div className="flex h-full relative">
                  {/* Icon Section - Large Prominent Image */}
                  <div className="w-40 flex-shrink-0 relative">
                    {modpack.icon ? (
                      <img 
                        src={modpack.icon} 
                        alt={modpack.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent/20 to-bg-tertiary">
                        <Package className="w-12 h-12 text-accent/50" />
                      </div>
                    )}
                    {/* Subtle edge shadow for depth */}
                    <div className="absolute inset-y-0 right-0 w-4 bg-gradient-to-r from-transparent to-bg-secondary/50" />
                  </div>

                  {/* Content Section */}
                  <div className="flex-1 p-4 flex flex-col justify-between min-w-0">
                    {/* Header */}
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-base font-semibold text-white truncate group-hover:text-accent transition-colors">
                            {modpack.name}
                          </h3>
                          <p className="text-xs text-text-muted mt-0.5">
                            by <span className="text-text-secondary">{modpack.author}</span>
                          </p>
                        </div>
                        {/* Loader Icon + MC Version */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {modpack.loader && modpack.loader !== 'vanilla' && getLoaderIcon(modpack.loader) && (
                            <>
                              <img 
                                src={getLoaderIcon(modpack.loader)!} 
                                alt={modpack.loader}
                                className="w-5 h-5 object-contain"
                                title={modpack.loader}
                              />
                              <span className="text-text-muted/50">|</span>
                            </>
                          )}
                          <span className="text-xs font-medium text-text-secondary">
                            {modpack.mcVersion}
                          </span>
                        </div>
                      </div>

                      {/* Description */}
                      <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">
                        {modpack.description || 'No description available'}
                      </p>

                      {/* Tags/Categories */}
                      {modpack.categories && modpack.categories.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {modpack.categories.slice(0, 3).map((tag, i) => (
                            <span 
                              key={i}
                              className="px-1.5 py-0.5 text-[10px] rounded bg-bg-tertiary text-text-muted"
                            >
                              {tag}
                            </span>
                          ))}
                          {modpack.categories.length > 3 && (
                            <span className="text-[10px] text-text-muted">
                              +{modpack.categories.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
                      <div className="flex items-center gap-4 text-xs text-text-muted">
                        <span className="flex items-center gap-1.5">
                          <Download className="w-3.5 h-3.5 text-accent/70" />
                          <span className="text-text-secondary">{modpack.version}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {installedProfile && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleViewMods(installedProfile)}
                            leftIcon={<Eye className="w-3.5 h-3.5" />}
                          >
                            Manage
                          </Button>
                        )}

                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => installedProfile ? launchProfile(installedProfile.id) : handleInstall(modpack)}
                          leftIcon={installedProfile ? <Play className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                          className="shadow-lg shadow-accent/20"
                          isLoading={(installedProfile && isLaunchingProfile) || (!installedProfile && isInstalling && currentInstall?.modpackId === modpack.id)}
                          disabled={isInstalling && currentInstall?.modpackId !== modpack.id}
                        >
                          {installedProfile 
                            ? 'Play' 
                            : (isInstalling && currentInstall?.modpackId === modpack.id 
                                ? 'Installing...' 
                                : 'Install')
                          }
                        </Button>
                      </div>
                    </div>
                  </div>
                  {installedProfile && (
                     <button
                       onClick={(e) => { e.stopPropagation(); handleDeleteClick(installedProfile); }}
                       className="absolute bottom-2 left-2 p-1.5 text-red-400 hover:text-red-300 bg-black/60 hover:bg-red-500/20 border border-transparent hover:border-red-500/50 rounded-md opacity-0 group-hover:opacity-100 transition-all duration-200 z-20 backdrop-blur-sm"
                       title="Delete Modpack"
                     >
                       <Trash2 className="w-4 h-4" />
                     </button>
                  )}
                </div>
              </Card>
            </motion.div>
          );
        })}
        </div>
      ) : isInitialLoad ? (
        /* Skeleton Loaders */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} padding="none" className="h-full overflow-hidden animate-pulse">
              <div className="flex h-full">
                {/* Icon skeleton */}
                <div className="w-40 flex-shrink-0 bg-bg-tertiary" />
                {/* Content skeleton */}
                <div className="flex-1 p-4 space-y-3">
                  <div className="h-5 bg-bg-tertiary rounded w-3/4" />
                  <div className="h-3 bg-bg-tertiary rounded w-1/2" />
                  <div className="h-3 bg-bg-tertiary rounded w-full" />
                  <div className="h-3 bg-bg-tertiary rounded w-4/5" />
                  <div className="flex gap-2 mt-4">
                    <div className="h-8 bg-bg-tertiary rounded w-20" />
                    <div className="h-8 bg-bg-tertiary rounded w-24" />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <Package className="w-12 h-12 text-text-muted mx-auto mb-3" />
          <h3 className="text-sm font-medium text-white mb-1">
            {isLoading ? 'Loading...' : 'No modpacks found'}
          </h3>
          <p className="text-xs text-text-secondary">
             {isLoading ? 'Fetching modpacks from server' : 'Check server configuration'}
          </p>
        </div>
      )}

      {/* Install confirmation modal */}
      <Modal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
        title="Install Modpack"
        size="sm"
      >
        {selectedModpack && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-md bg-bg-tertiary overflow-hidden">
                {selectedModpack.icon ? (
                  <img 
                    src={selectedModpack.icon} 
                    alt={selectedModpack.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                     <Package className="w-6 h-6 text-text-muted" />
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-sm font-medium text-white">{selectedModpack.name}</h3>
                <p className="text-xs text-text-secondary">
                  v{selectedModpack.version}
                </p>
              </div>
            </div>
            
            <p className="text-xs text-text-secondary">
              This will download and install the modpack from the server.
            </p>
            
            <div className="flex justify-end gap-2 pt-1">
              <Button 
                variant="secondary" 
                size="sm"
                onClick={() => setIsInstallModalOpen(false)}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={confirmInstall}>
                Install
              </Button>
            </div>
          </div>
        )}
      </Modal>



      {/* Delete confirmation modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="Delete Modpack"
        size="sm"
      >
        {profileToDelete && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Are you sure you want to delete <span className="text-white font-medium">{profileToDelete.name}</span>?
            </p>
            <p className="text-xs text-red-400">
              This will permanently delete all mod files, configs, and world saves associated with this modpack.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button 
                variant="secondary" 
                size="sm"
                onClick={() => setIsDeleteModalOpen(false)}
              >
                Cancel
              </Button>
              <Button 
                size="sm" 
                onClick={confirmDelete}
                isLoading={isDeleting}
                className="bg-red-500 hover:bg-red-600 border-red-500"
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </motion.div>
  );
}

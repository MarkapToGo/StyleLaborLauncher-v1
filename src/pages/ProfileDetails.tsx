import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { ArrowLeft, Package, FileBox, Play, Search, FolderOpen, ChevronLeft, ChevronRight, Plus, Trash2, AlertTriangle, FileText } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useToastStore } from '../stores/toastStore';
import { useProfileStore } from '../stores/profileStore';
import { modpacks, profiles, userMods } from '../lib/tauri';
import { compareVersions } from '../lib/utils';
import type { ModInfo, Profile, Modpack } from '../types';
import { Settings } from 'lucide-react';



export function ProfileDetails() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [modpack, setModpack] = useState<Modpack | null>(null);
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;
  const [isLoading, setIsLoading] = useState(true);
  const [deletingMod, setDeletingMod] = useState<string | null>(null);

  const [confirmDeleteMod, setConfirmDeleteMod] = useState<ModInfo | null>(null);
  
  const { error } = useToastStore();
  const { profiles: profilesList, launchProfile, isLaunching } = useProfileStore();

  useEffect(() => {
    if (!profileId) return;

    const foundProfile = profilesList.find(p => p.id === profileId);
    if (foundProfile) {
      setProfile(foundProfile);
      loadMods(foundProfile.id);
      loadModpackInfo(foundProfile);
    }
  }, [profileId, profilesList]);

  const loadModpackInfo = async (p: Profile) => {
    if (!p.sourceId) return;
    try {
        // We can try to fetch from cache or server. 
        // For now, let's just search by ID if possible, or name.
        // Assuming searchCurseforge allows searching by generic string, or if we have a direct fetch.
        // The previous implementation used generic search.
        const results = await modpacks.searchCurseforge(p.name);
        const match = results.find(m => m.id === p.sourceId || m.name === p.name);
        if (match) {
            setModpack(match);
        }
    } catch (e) {
        console.error("Failed to load modpack info", e);
    }
  };

  const loadMods = async (id: string) => {
    setIsLoading(true);
    try {
      const loadedMods = await profiles.getMods(id);
      setMods(loadedMods);
    } catch (err) {
      error('Failed to load mods', String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const filteredMods = mods.filter(mod => {
    const query = searchQuery.toLowerCase();
    // Also create a spaceless version for matching "Creative Core" with "CreativeCore"
    const queryNoSpaces = query.replace(/\s+/g, '');
    
    const modName = (mod.name?.toLowerCase() || '');
    const modNameNoSpaces = modName.replace(/\s+/g, '');
    const fileName = mod.fileName.toLowerCase();
    const fileNameNoSpaces = fileName.replace(/\s+/g, '');
    const author = (mod.author?.toLowerCase() || '');
    
    return (
      // Standard includes search
      modName.includes(query) || 
      fileName.includes(query) ||
      author.includes(query) ||
      // Spaceless matching for "Creative Core" -> "CreativeCore"
      modNameNoSpaces.includes(queryNoSpaces) ||
      fileNameNoSpaces.includes(queryNoSpaces)
    );
  });

  const totalPages = Math.ceil(filteredMods.length / ITEMS_PER_PAGE);
  const paginatedMods = filteredMods.slice(
    (currentPage - 1) * ITEMS_PER_PAGE, 
    currentPage * ITEMS_PER_PAGE
  );

  // Reset page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const handleOpenFolder = async () => {
    if (profile) {
      try {
        await profiles.openFolder(profile.id);
      } catch (err) {
        error('Failed to open folder', String(err));
      }
    }
  };

  const handleDeleteMod = async (mod: ModInfo) => {
    if (!profile || deletingMod) return;
    setDeletingMod(mod.fileName);
    try {
      await userMods.remove(profile.id, mod.fileName);
      setMods(prev => prev.filter(m => m.fileName !== mod.fileName));
    } catch (err) {
      error('Failed to remove content', String(err));
    } finally {
      setDeletingMod(null);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!profile && !isLoading) {
      return (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
              <Package className="w-12 h-12 mb-4" />
              <p>Profile not found</p>
              <Button variant="secondary" onClick={() => navigate('/modpacks')} className="mt-4">
                  Back to Modpacks
              </Button>
          </div>
      );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
      className="w-full space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate('/modpacks')}
            className="text-text-secondary hover:text-white pl-0"
            leftIcon={<ArrowLeft className="w-4 h-4" />}
          >
            Back
          </Button>
          
          <div className="flex items-center gap-4">
              {modpack?.icon && (
                  <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 shadow-lg border border-border/50">
                    <img src={modpack.icon} alt={modpack.name} className="w-full h-full object-cover" />
                  </div>
              )}
              <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-2">
                  {profile?.name}
                  <span className="text-xs font-normal text-text-muted px-2 py-0.5 rounded-full bg-bg-tertiary">
                    {profile?.version}
                  </span>
                  {/* Update Indicator */}
                  {modpack && profile?.modpackVersion && (() => {
                      const cmp = compareVersions(modpack.version, profile.modpackVersion);
                      console.log('[UpdateCheck]', {
                          local: profile.modpackVersion,
                          remote: modpack.version,
                          comparison: cmp,
                          hasUpdate: cmp > 0
                      });
                      return cmp > 0;
                  })() && (
                      <Button
                          size="sm"
                          variant="primary" 
                          className="ml-2 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 shadow-orange-500/20"
                          onClick={async () => {
                              if (!profile.sourceId || !modpack.id) return;
                              try {
                                  // Trigger update
                                  // We need to import invoke
                                  const { invoke } = await import('@tauri-apps/api/core');
                                  await invoke('update_modpack', { 
                                      profileId: profile.id, 
                                      modpackId: parseInt(modpack.id) 
                                  });
                                  // Refresh profile data?
                                  // The command emits events, we should see progress.
                              } catch (e) {
                                  console.error("Update failed", e);
                              }
                          }}
                      >
                          Update Available ({modpack.version})
                      </Button>
                  )}
                </h1>
                <p className="text-xs text-text-secondary mt-0.5 line-clamp-1 max-w-lg">
                   {modpack?.description || `${mods.length} mods installed`}
                </p>
              </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
             <Button
                size="sm"
                variant="secondary"
                onClick={handleOpenFolder}
                leftIcon={<FolderOpen className="w-4 h-4" />}
                className="hidden sm:flex"
              >
                Folder
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate(`/profiles/${profileId}/settings`)}
                leftIcon={<Settings className="w-4 h-4" />}
                className="hidden sm:flex"
              >
                Settings
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate(`/profiles/${profileId}/logs`)}
                leftIcon={<FileText className="w-4 h-4" />}
                className="hidden sm:flex"
              >
                Logs
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate(`/profiles/${profileId}/add-content`)}
                leftIcon={<Plus className="w-4 h-4" />}
                className="hidden sm:flex"
              >
                Add Content
              </Button>
             <Button
                size="sm"
                variant="primary"
                onClick={() => profile && launchProfile(profile.id)}
                leftIcon={<Play className="w-4 h-4" />}
                className="shadow-lg shadow-accent/20"
                isLoading={isLaunching}
              >
                Play
              </Button>
        </div>
      </div>

      {/* Mods List */}
      <Card hover={false} padding="none" className="overflow-hidden min-h-[400px]">
        <div className="p-4 border-b border-border/50 bg-bg-secondary/30 flex items-center justify-between gap-4">
             <h2 className="text-sm font-semibold text-white whitespace-nowrap">Installed Mods ({filteredMods.length})</h2>
             
             {/* Search */}
             <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search mods..."
                    className="w-full h-10 pl-10 pr-4 bg-bg-tertiary/50 border border-border/50 rounded-lg text-sm text-white placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:bg-bg-tertiary transition-all"
                />
             </div>
        </div>

        {/* Top Pagination */}
        {filteredMods.length > ITEMS_PER_PAGE && (
            <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between bg-bg-secondary/30">
                <p className="text-xs text-text-muted">
                    Page {currentPage} of {totalPages}
                </p>
                <div className="flex items-center gap-2">
                    <Button 
                        size="sm" 
                        variant="secondary" 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        leftIcon={<ChevronLeft className="w-4 h-4" />}
                    >
                        Previous
                    </Button>
                    <Button 
                        size="sm" 
                        variant="secondary" 
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                    >
                        Next <ChevronRight className="w-4 h-4 ml-1.5" />
                    </Button>
                </div>
            </div>
        )}
        
        <div className="divide-y divide-border/30">
            {isLoading ? (
                <div className="p-12 text-center text-text-muted">
                    <Package className="w-8 h-8 mx-auto mb-3 animate-pulse text-accent/50" />
                    <p>Loading mods involved...</p>
                </div>
            ) : filteredMods.length === 0 ? (
                <div className="p-12 text-center text-text-muted">
                    <FileBox className="w-8 h-8 mx-auto mb-3 opacity-50" />
                    <p>{searchQuery ? 'No mods match your search' : 'No mods found in this profile'}</p>
                </div>
            ) : (
                paginatedMods.map((mod, i) => (
                    <div 
                        key={i}
                        className="flex items-center gap-4 p-4 hover:bg-bg-tertiary/30 transition-colors group"
                    >
                         {/* Icon */}
                        <div className="w-10 h-10 rounded-lg flex-shrink-0 overflow-hidden bg-bg-tertiary shadow-sm">
                            {mod.iconPath ? (
                            <img 
                                src={mod.iconPath.startsWith('http://') || mod.iconPath.startsWith('https://') 
                                    ? mod.iconPath 
                                    : convertFileSrc(mod.iconPath)}
                                alt={mod.name || mod.fileName}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                                }}
                            />
                            ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <Package className="w-5 h-5 text-accent/40" />
                            </div>
                            )}
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                             <div className="flex items-center gap-2">
                                <h3 className="text-sm font-medium text-white truncate">
                                    {mod.name || mod.fileName.replace(/\.jar$/, '').replace(/-/g, ' ')}
                                </h3>
                                {mod.modId && (
                                     <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-bg-tertiary">
                                        ID: {mod.modId}
                                     </span>
                                )}
                                {mod.isExtra && (
                                     <span className="text-[10px] font-medium text-white px-1.5 py-0.5 rounded bg-accent/80 ml-2">
                                        Extra
                                     </span>
                                )}
                                {mod.isUserInstalled && (
                                     <span className="text-[10px] font-medium text-green-300 px-1.5 py-0.5 rounded bg-green-500/20 border border-green-500/30 ml-2">
                                        User Added
                                     </span>
                                )}
                             </div>
                             
                             <p className="text-xs text-text-secondary truncate mt-0.5">
                                {mod.description || (mod.author ? `by ${mod.author}` : mod.fileName)}
                             </p>
                        </div>
                        
                        {/* Size */}
                        <div className="text-right text-xs text-text-muted font-mono bg-bg-tertiary/50 px-2 py-1 rounded">
                            {formatSize(mod.sizeBytes)}
                        </div>
                        
                        {/* Delete Button for ALL content */}
                        {profile && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (mod.isUserInstalled) {
                                        // User mods can be deleted directly
                                        handleDeleteMod(mod);
                                    } else {
                                        // Modpack content needs confirmation
                                        setConfirmDeleteMod(mod);
                                    }
                                }}
                                disabled={deletingMod === mod.fileName}
                                className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                title="Remove content"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                ))
            )}
        </div>
        
        {/* Pagination */}
        {filteredMods.length > ITEMS_PER_PAGE && (
            <div className="p-4 border-t border-border/50 flex items-center justify-between bg-bg-secondary/30">
                <p className="text-xs text-text-muted">
                    Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredMods.length)} of {filteredMods.length} mods
                </p>
                <div className="flex items-center gap-2">
                    <Button 
                        size="sm" 
                        variant="secondary" 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        leftIcon={<ChevronLeft className="w-4 h-4" />}
                    >
                        Previous
                    </Button>
                    <div className="text-xs font-medium text-white px-2">
                        Page {currentPage} of {totalPages}
                    </div>
                    <Button 
                        size="sm" 
                        variant="secondary" 
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        // rightIcon={<ChevronRight className="w-4 h-4" />} // Button component might not support rightIcon yet, checking... 
                        // Assuming no rightIcon support based on usage so far, appending icon as child
                    >
                        Next <ChevronRight className="w-4 h-4 ml-1.5" />
                    </Button>
                </div>
            </div>
        )}
      </Card>

      {/* Confirmation Dialog for Deleting Modpack Content */}
      {confirmDeleteMod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
              </div>
              <h3 className="text-lg font-bold text-white">Warning: Modpack Content</h3>
            </div>
            <p className="text-text-secondary mb-4">
              <span className="font-medium text-white">{confirmDeleteMod.name || confirmDeleteMod.fileName}</span> is part of the modpack. 
              Deleting it may cause issues or crashes. It will be restored if you update the modpack.
            </p>
            <p className="text-sm text-text-muted mb-6">
              Are you sure you want to delete this content?
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                variant="secondary"
                onClick={() => setConfirmDeleteMod(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="bg-red-600 hover:bg-red-500"
                onClick={() => {
                  if (confirmDeleteMod) {
                    handleDeleteMod(confirmDeleteMod);
                    setConfirmDeleteMod(null);
                  }
                }}
              >
                Delete Anyway
              </Button>
            </div>
          </div>
        </div>
      )}


    </motion.div>
  );
}


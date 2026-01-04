import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, Download, Loader2, Package, ExternalLink, Check, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { userMods, profiles } from '../lib/tauri';
import { useToastStore } from '../stores/toastStore';
import type { ModrinthSearchResult, ModInfo } from '../types';

const ITEMS_PER_PAGE = 20;

// Modrinth mod categories (popular ones)
const CATEGORIES = [
  { id: 'all', name: 'All Mods', query: '' },
  { id: 'optimization', name: 'Optimization', query: 'optimization' },
  { id: 'utility', name: 'Utility', query: 'utility' },
  { id: 'technology', name: 'Technology', query: 'technology' },
  { id: 'magic', name: 'Magic', query: 'magic' },
  { id: 'adventure', name: 'Adventure', query: 'adventure' },
  { id: 'decoration', name: 'Decoration', query: 'decoration' },
  { id: 'worldgen', name: 'World Gen', query: 'worldgen' },
];

// Content types
const CONTENT_TYPES = [
  { id: 'mod', name: 'Mods' },
  { id: 'resourcepack', name: 'Resource Packs' },
  { id: 'shader', name: 'Shaders' },
];

export function AddContent() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const { success, error: showError } = useToastStore();
  
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [contentType, setContentType] = useState('mod');
  const [results, setResults] = useState<ModrinthSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installedMods, setInstalledMods] = useState<ModInfo[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalResults, setTotalResults] = useState(0);

  const totalPages = Math.max(1, Math.ceil(totalResults / ITEMS_PER_PAGE));

  // Load installed mods on mount
  useEffect(() => {
    if (!profileId) return;
    
    profiles.getMods(profileId).then(mods => {
      setInstalledMods(mods);
    }).catch(console.error);
  }, [profileId]);

  // Check if a mod is already installed
  // Uses fuzzy matching to handle naming variations like "FerriteCore ((Neo)Forge)" vs "FerriteCore"
  const isModInstalled = useCallback((mod: ModrinthSearchResult) => {
    const searchTitle = mod.title.toLowerCase().trim();
    
    // Extract base name by removing common suffixes like "(Fabric)", "((Neo)Forge)", "[Forge]", etc.
    const normalizeModName = (name: string): string => {
      return name
        .toLowerCase()
        .trim()
        // Remove common loader/platform suffixes in various formats
        .replace(/\s*[\[\(]+(neo)?forge[\]\)]+/gi, '')
        .replace(/\s*[\[\(]+fabric[\]\)]+/gi, '')
        .replace(/\s*[\[\(]+quilt[\]\)]+/gi, '')
        .replace(/\s*[\[\(]+neoforge[\]\)]+/gi, '')
        // Remove version-like suffixes
        .replace(/\s*[\[\(]+\d+\.\d+.*?[\]\)]+/gi, '')
        // Clean up any leftover brackets/parens
        .replace(/\s*[\[\(]+[\]\)]+/g, '')
        .trim();
    };
    
    const normalizedSearchTitle = normalizeModName(searchTitle);
    
    return installedMods.some(m => {
      // Strategy 1: Exact project ID match (most reliable)
      if (m.modId?.toString() === mod.project_id) return true;
      
      if (!m.name) return false;
      
      const installedName = m.name.toLowerCase().trim();
      const normalizedInstalledName = normalizeModName(installedName);
      
      // Strategy 2: Exact name match
      if (installedName === searchTitle) return true;
      
      // Strategy 3: Normalized base name match
      if (normalizedInstalledName === normalizedSearchTitle && normalizedInstalledName.length > 3) return true;
      
      // Strategy 4: One contains the other (for cases like "Sodium" in "Sodium Extra")
      // Only if the shorter name is reasonably long to avoid false positives
      if (normalizedSearchTitle.length >= 5 && normalizedInstalledName.startsWith(normalizedSearchTitle)) return true;
      if (normalizedInstalledName.length >= 5 && normalizedSearchTitle.startsWith(normalizedInstalledName)) return true;
      
      return false;
    });
  }, [installedMods]);

  const performSearch = useCallback(async (searchQuery: string, page: number) => {
    if (!profileId) return;
    
    setIsSearching(true);
    setError(null);
    
    const offset = (page - 1) * ITEMS_PER_PAGE;
    
    try {
      console.log('[AddContent] Searching for type:', contentType, 'query:', searchQuery);
      const mods = await userMods.search(searchQuery, profileId, contentType, offset);
      console.log('[AddContent] Search results:', mods.length, 'items');
      // Debug: log first item's icon URL
      if (mods.length > 0) {
        console.log('[AddContent] First item:', mods[0].title, 'icon:', mods[0].icon_url);
      }
      setResults(mods);
      // Dynamic page estimation - if we get a full page, there's likely more
      if (mods.length === ITEMS_PER_PAGE) {
        // Always keep at least one page ahead of current
        setTotalResults(Math.max(totalResults, (page + 1) * ITEMS_PER_PAGE));
      } else {
        // Partial page means we've reached the end
        setTotalResults((page - 1) * ITEMS_PER_PAGE + mods.length);
      }
    } catch (err) {
      console.error('[AddContent] Search failed:', err);
      setError(String(err));
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [profileId, contentType, totalResults]);

  // Search when query, category, content type, or page changes
  useEffect(() => {
    const effectiveQuery = query || (activeCategory !== 'all' ? CATEGORIES.find(c => c.id === activeCategory)?.query || '' : '');
    const timer = setTimeout(() => {
      performSearch(effectiveQuery, currentPage);
    }, query ? 400 : 0);
    
    return () => clearTimeout(timer);
  }, [query, activeCategory, contentType, currentPage, performSearch]);

  const handleCategoryChange = (categoryId: string) => {
    setActiveCategory(categoryId);
    setQuery('');
    setCurrentPage(1);
  };

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const openModUrl = (slug: string) => {
    const url = `https://modrinth.com/mod/${slug}`;
    console.log('[AddContent] Opening URL:', url);
    open(url).catch(console.error);
  };

  const handleInstall = async (mod: ModrinthSearchResult) => {
    if (!profileId) return;
    
    setInstallingId(mod.project_id);
    setError(null);
    
    try {
      const entry = await userMods.install(profileId, mod.project_id, contentType);
      setInstalledMods(prev => [...prev, {
        fileName: entry.fileName,
        sizeBytes: 0,
        modId: parseInt(entry.projectId) || undefined,
        name: entry.name,
        author: entry.author,
        description: mod.description,
        iconPath: mod.icon_url,
        isUserInstalled: true,
      }]);
      const typeLabel = contentType === 'mod' ? 'Mod' : contentType === 'resourcepack' ? 'Resource Pack' : 'Shader';
      success(`${typeLabel} installed`, `${mod.title} has been added to your modpack`);
    } catch (err) {
      console.error('Install failed:', err);
      showError('Installation failed', String(err));
    } finally {
      setInstallingId(null);
    }
  };

  const formatDownloads = (count: number): string => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      
      if (currentPage > 3) pages.push('ellipsis');
      
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      
      for (let i = start; i <= end; i++) pages.push(i);
      
      if (currentPage < totalPages - 2) pages.push('ellipsis');
      
      pages.push(totalPages);
    }
    
    return pages;
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate(`/profiles/${profileId}`)}
            className="text-text-secondary hover:text-white pl-0"
            leftIcon={<ArrowLeft className="w-4 h-4" />}
          >
            Back to Mods
          </Button>
          
          <div>
            <h1 className="text-xl font-bold text-white">Add New Content</h1>
            <p className="text-xs text-text-secondary mt-0.5">
              Browse and install mods from Modrinth
            </p>
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <Card hover={false} padding="none" className="overflow-hidden">
        <div className="p-4 space-y-4">
          {/* Content Type Tabs */}
          <div className="flex gap-1 p-1 bg-bg-tertiary/50 rounded-lg w-fit">
            {CONTENT_TYPES.map(type => (
              <button
                key={type.id}
                onClick={() => { setContentType(type.id); setCurrentPage(1); setResults([]); }}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  contentType === type.id
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-white hover:bg-bg-tertiary'
                }`}
              >
                {type.name}
              </button>
            ))}
          </div>
          
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setCurrentPage(1); }}
              placeholder={`Search for ${contentType === 'mod' ? 'mods' : contentType === 'resourcepack' ? 'resource packs' : 'shaders'}...`}
              className="w-full h-12 pl-12 pr-4 bg-bg-tertiary border border-border/50 rounded-xl text-white placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:bg-bg-tertiary/80 transition-all text-base"
            />
            {isSearching && (
              <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-accent animate-spin" />
            )}
          </div>
          
          {/* Category Filters - Only for Mods */}
          {contentType === 'mod' && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <Filter className="w-4 h-4 text-text-muted flex-shrink-0" />
              {CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => handleCategoryChange(cat.id)}
                  className={`px-3 py-1.5 text-sm rounded-full border whitespace-nowrap transition-colors ${
                    activeCategory === cat.id
                      ? 'bg-accent/20 border-accent/50 text-accent font-medium'
                      : 'bg-bg-tertiary/50 border-border/50 text-text-secondary hover:text-white hover:border-border'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      <Card hover={false} padding="none" className="overflow-hidden">
        <div className="p-4 border-b border-border/50 bg-bg-secondary/30 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">
            {query ? `Search: "${query}"` : CATEGORIES.find(c => c.id === activeCategory)?.name || 'All Mods'}
          </h2>
          
          {/* Top Pagination */}
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1 || isSearching}
              className="px-2 h-7"
            >
              <ChevronLeft className="w-3 h-3" />
            </Button>
            <span className="text-xs text-text-muted px-2">Page {currentPage}</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages || isSearching}
              className="px-2 h-7"
            >
              <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
        </div>
        
        <div className="divide-y divide-border/30 min-h-[300px]">
          {results.length === 0 && !isSearching && (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <Package className="w-16 h-16 mb-4 opacity-30" />
              <p className="text-lg font-medium">No mods found</p>
              <p className="text-sm mt-1">Try a different search or category</p>
            </div>
          )}
          
          {isSearching && (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <Loader2 className="w-12 h-12 mb-4 animate-spin text-accent" />
              <p>Loading mods...</p>
            </div>
          )}
          
          {!isSearching && results.map((mod) => {
            const installed = isModInstalled(mod);
            
            return (
              <div
                key={mod.project_id}
                className="flex items-center gap-4 p-4 hover:bg-bg-tertiary/30 transition-colors"
              >
                {/* Icon */}
                <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-bg-tertiary border border-border/30">
                  {mod.icon_url ? (
                    <img 
                      src={mod.icon_url}
                      alt={mod.title}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const target = e.currentTarget;
                        target.onerror = null;
                        target.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="w-6 h-6 text-accent/40" />
                    </div>
                  )}
                </div>
                
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-white truncate">{mod.title}</h3>
                    <button
                      onClick={(e) => { e.stopPropagation(); openModUrl(mod.slug); }}
                      className="text-text-muted hover:text-accent transition-colors flex-shrink-0"
                      title="Open on Modrinth"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                    {installed && (
                      <span className="text-[10px] font-medium text-green-300 px-1.5 py-0.5 rounded bg-green-500/20 border border-green-500/30 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Installed
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5">
                    by {mod.author} • {formatDownloads(mod.downloads)} downloads
                  </p>
                  <p className="text-sm text-text-muted mt-1 line-clamp-1">
                    {mod.description}
                  </p>
                </div>
                
                {/* Install Button */}
                <Button
                  size="sm"
                  variant={installed ? 'secondary' : 'primary'}
                  onClick={() => handleInstall(mod)}
                  disabled={installingId !== null || installed}
                  isLoading={installingId === mod.project_id}
                  leftIcon={installed ? <Check className="w-4 h-4" /> : installingId !== mod.project_id ? <Download className="w-4 h-4" /> : undefined}
                  className="flex-shrink-0"
                >
                  {installed ? 'Installed' : installingId === mod.project_id ? '...' : 'Install'}
                </Button>
              </div>
            );
          })}
        </div>
        
        {/* Pagination */}
        {results.length > 0 && (
          <div className="p-4 border-t border-border/50 bg-bg-secondary/30 flex items-center justify-center gap-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1 || isSearching}
              className="px-2"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            
            {getPageNumbers().map((page, i) => (
              page === 'ellipsis' ? (
                <span key={`ellipsis-${i}`} className="px-2 text-text-muted">...</span>
              ) : (
                <button
                  key={page}
                  onClick={() => handlePageChange(page)}
                  disabled={isSearching}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                    currentPage === page
                      ? 'bg-accent text-white'
                      : 'text-text-secondary hover:text-white hover:bg-bg-tertiary'
                  }`}
                >
                  {page}
                </button>
              )
            ))}
            
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages || isSearching}
              className="px-2"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </Card>
      
      {/* Footer */}
      <div className="flex items-center justify-center py-4">
        <p className="text-xs text-text-muted">
          Powered by <span className="text-green-400 font-medium">Modrinth</span>
        </p>
      </div>
    </div>
  );
}

import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, FileText, RefreshCw, Calendar, HardDrive, Folder, ChevronDown, ChevronRight, Star, Search, ArrowDownToLine, List, Info, AlertCircle, XCircle, Upload, FolderOpen } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';
import { useToastStore } from '../stores/toastStore';
import { logs, mclogs, type LogFileInfo, type LogFolder, type ProfileLogsResult } from '../lib/tauri';
import { cn } from '../lib/utils';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';

export function ProfileLogs() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [logsResult, setLogsResult] = useState<ProfileLogsResult | null>(null);
  const [selectedLog, setSelectedLog] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<string>('');
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Log viewer controls
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>('ALL');

  const { error, success } = useToastStore();
  const [isUploading, setIsUploading] = useState(false);

  const handleUploadToMcLogs = async () => {
    if (!logContent || isUploading) return;
    setIsUploading(true);
    try {
      const url = await mclogs.upload(logContent);
      success('Log Uploaded', 'Opening mclo.gs...');
      // Open the URL in browser
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
    } catch (err) {
      error('Upload Failed', String(err));
    } finally {
      setIsUploading(false);
    }
  };

  const loadLogFiles = async () => {
    if (!profileId) return;
    setIsLoadingList(true);
    try {
      const result = await logs.list(profileId);
      setLogsResult(result);
      // Auto-select latest.log if available
      if (result.priority_files.length > 0) {
        setSelectedLog(result.priority_files[0].path);
      } else if (result.other_files.length > 0) {
        setSelectedLog(result.other_files[0].path);
      }
    } catch (err) {
      error('Failed to load log files', String(err));
    } finally {
      setIsLoadingList(false);
    }
  };

  const loadLogContent = async (filePath: string) => {
    if (!profileId) return;
    setIsLoadingContent(true);
    setLogContent(''); // Clear while loading
    try {
      const content = await logs.read(profileId, filePath);
      setLogContent(content);
    } catch (err) {
      error('Failed to read log file', String(err));
      setLogContent('');
    } finally {
      setIsLoadingContent(false);
    }
  };

  useEffect(() => {
    loadLogFiles();
  }, [profileId]);

  useEffect(() => {
    if (selectedLog) {
      loadLogContent(selectedLog);
    }
  }, [selectedLog]);

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const toggleFolder = (folderName: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderName)) {
        next.delete(folderName);
      } else {
        next.add(folderName);
      }
      return next;
    });
  };

  const toggleSection = (sectionName: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionName)) {
        next.delete(sectionName);
      } else {
        next.add(sectionName);
      }
      return next;
    });
  };

  // Simple coloring for log lines
  const getLineColor = (line: string): string => {
    const upper = line.toUpperCase();
    if (upper.includes('ERROR') || upper.includes('FATAL')) return 'text-red-400';
    if (upper.includes('WARN')) return 'text-yellow-400';
    if (upper.includes('INFO')) return 'text-blue-400';
    if (upper.includes('DEBUG')) return 'text-purple-400';
    if (line.trim().startsWith('at ') || line.includes('Exception')) return 'text-red-300/80';
    return 'text-gray-300';
  };

  // Helper to check if a line matches filter
  const matchesFilter = (line: string): boolean => {
    const upper = line.toUpperCase();
    if (levelFilter === 'ALL') return true;
    if (levelFilter === 'INFO') return upper.includes('INFO');
    if (levelFilter === 'WARN') return upper.includes('WARN');
    if (levelFilter === 'ERROR') return upper.includes('ERROR') || upper.includes('FATAL') || upper.includes('EXCEPTION') || line.trim().startsWith('at ');
    return true;
  };

  // Memoize filtered log lines for virtualization
  const filteredLogLines = useMemo(() => {
    if (!logContent) return [];
    let lines = logContent.split('\n');

    // Apply level filter
    if (levelFilter !== 'ALL') {
      lines = lines.filter(line => matchesFilter(line));
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      lines = lines.filter(line => line.toLowerCase().includes(query));
    }

    return lines;
  }, [logContent, levelFilter, searchQuery]);

  const totalFiles = logsResult
    ? logsResult.priority_files.length + logsResult.crash_reports.length + logsResult.other_files.length +
    logsResult.folders.reduce((sum, f) => sum + f.files.length, 0)
    : 0;

  const scrollToBottom = () => {
    virtuosoRef.current?.scrollToIndex({
      index: filteredLogLines.length - 1,
      align: 'end',
      behavior: 'smooth',
    });
  };

  const renderFileItem = (file: LogFileInfo) => (
    <button
      key={file.path}
      onClick={() => setSelectedLog(file.path)}
      className={cn(
        "w-full p-3 text-left hover:bg-bg-tertiary/50 transition-colors",
        selectedLog === file.path && "bg-accent/10 border-l-2 border-accent"
      )}
    >
      <div className="flex items-center gap-2">
        {file.is_priority && <Star className="w-3 h-3 text-yellow-400 flex-shrink-0" />}
        <p className="text-sm font-medium text-white truncate">{file.name}</p>
      </div>
      <div className="flex items-center gap-3 mt-1 text-[10px] text-text-muted">
        <span className="flex items-center gap-1">
          <HardDrive className="w-3 h-3" />
          {formatSize(file.size_bytes)}
        </span>
        <span className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {formatDate(file.modified)}
        </span>
      </div>
    </button>
  );

  const renderFolder = (folder: LogFolder) => {
    const isExpanded = expandedFolders.has(folder.name);

    return (
      <div key={folder.name}>
        <button
          onClick={() => toggleFolder(folder.name)}
          className="w-full p-3 text-left hover:bg-bg-tertiary/50 transition-colors flex items-center gap-2"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-accent" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-muted" />
          )}
          <Folder className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium text-white">{folder.name}</span>
          <span className="text-[10px] text-text-muted ml-auto">
            {folder.files.length} file{folder.files.length !== 1 ? 's' : ''}
          </span>
        </button>
        {isExpanded && (
          <div className="pl-6 bg-bg-tertiary/20">
            {folder.files.map(file => renderFileItem(file))}
          </div>
        )}
      </div>
    );
  };

  const SectionHeader = ({ label, sectionKey, count }: { label: string; sectionKey: string; count: number }) => {
    const isCollapsed = collapsedSections.has(sectionKey);
    return (
      <button
        onClick={() => toggleSection(sectionKey)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-bg-tertiary/50 border-y border-border/50 hover:bg-bg-tertiary/70 transition-colors"
      >
        {isCollapsed ? (
          <ChevronRight className="w-3 h-3 text-text-muted" />
        ) : (
          <ChevronDown className="w-3 h-3 text-text-muted" />
        )}
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-text-muted">({count})</span>
        <div className="flex-1 h-px bg-border/50" />
      </button>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
      className="w-full h-full flex flex-col gap-4"
    >
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
            Back to Profile
          </Button>

          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-accent/10 border border-accent/20">
              <FileText className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Log Files</h1>
              <p className="text-xs text-text-secondary">{totalFiles} log files available</p>
            </div>
          </div>
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={loadLogFiles}
          leftIcon={<RefreshCw className="w-4 h-4" />}
          isLoading={isLoadingList}
        >
          Refresh
        </Button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Sidebar - Log Files List */}
        <Card hover={false} padding="none" className="w-72 flex-shrink-0 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-border/50 bg-bg-secondary/30">
            <h2 className="text-sm font-medium text-white">Files</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoadingList ? (
              <div className="p-4 text-center text-text-muted">
                <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin" />
                <p className="text-xs">Loading...</p>
              </div>
            ) : !logsResult || totalFiles === 0 ? (
              <div className="p-4 text-center text-text-muted">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs">No log files found</p>
                <p className="text-[10px] mt-1">Launch a game to generate logs</p>
              </div>
            ) : (
              <div>
                {/* Priority Files (latest.log, debug.log) - NOT collapsible */}
                {logsResult.priority_files.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary/50 border-y border-border/50">
                      <Star className="w-3 h-3 text-yellow-400" />
                      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Priority</span>
                      <div className="flex-1 h-px bg-border/50" />
                    </div>
                    <div className="divide-y divide-border/30">
                      {logsResult.priority_files.map(file => renderFileItem(file))}
                    </div>
                  </>
                )}

                {/* Crash Reports */}
                {logsResult.crash_reports.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border-y border-red-500/20">
                      <AlertCircle className="w-3 h-3 text-red-500" />
                      <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">Crash Reports</span>
                      <div className="flex-1 h-px bg-red-500/20" />
                    </div>
                    <div className="divide-y divide-border/30">
                      {logsResult.crash_reports.map(file => renderFileItem(file))}
                    </div>
                  </>
                )}

                {/* Folders (kubejs, etc.) - Collapsible */}
                {logsResult.folders.length > 0 && (
                  <>
                    <SectionHeader
                      label="Folders"
                      sectionKey="folders"
                      count={logsResult.folders.reduce((sum, f) => sum + f.files.length, 0)}
                    />
                    {!collapsedSections.has('folders') && (
                      <div>
                        {logsResult.folders.map(folder => renderFolder(folder))}
                      </div>
                    )}
                  </>
                )}

                {/* Other Files - Collapsible */}
                {logsResult.other_files.length > 0 && (
                  <>
                    <SectionHeader
                      label="Other Logs"
                      sectionKey="other"
                      count={logsResult.other_files.length}
                    />
                    {!collapsedSections.has('other') && (
                      <div className="divide-y divide-border/30">
                        {logsResult.other_files.map(file => renderFileItem(file))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Log Content Viewer - Virtualized */}
        <Card hover={false} padding="none" className="flex-1 flex flex-col overflow-hidden">
          {/* Header with controls */}
          <div className="p-3 border-b border-border/50 bg-bg-secondary/30 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-white truncate max-w-[40%]">
                {selectedLog || 'Select a log file'}
              </h2>
              {selectedLog && filteredLogLines.length > 0 && (
                <span className="text-xs text-text-muted">
                  {filteredLogLines.length.toLocaleString()} lines
                </span>
              )}
            </div>

            {/* Controls */}
            {selectedLog && (
              <div className="flex items-center gap-2">
                {/* Search */}
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full h-7 bg-bg-tertiary border border-border/50 rounded pl-7 pr-2 text-xs text-white focus:outline-none focus:border-accent/50 placeholder:text-text-muted/50"
                  />
                </div>

                {/* Level Filters */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setLevelFilter('ALL')}
                    className={cn(
                      "p-1.5 rounded transition-colors border",
                      levelFilter === 'ALL' ? "bg-accent text-white border-accent" : "bg-bg-tertiary text-white border-border/50 hover:text-white"
                    )}
                    title="All"
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setLevelFilter('INFO')}
                    className={cn(
                      "p-1.5 rounded transition-colors border",
                      levelFilter === 'INFO' ? "bg-blue-500 text-white border-blue-500" : "bg-bg-tertiary text-white border-border/50 hover:text-blue-400"
                    )}
                    title="Info"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setLevelFilter('WARN')}
                    className={cn(
                      "p-1.5 rounded transition-colors border",
                      levelFilter === 'WARN' ? "bg-yellow-500 text-white border-yellow-500" : "bg-bg-tertiary text-white border-border/50 hover:text-yellow-400"
                    )}
                    title="Warnings"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setLevelFilter('ERROR')}
                    className={cn(
                      "p-1.5 rounded transition-colors border",
                      levelFilter === 'ERROR' ? "bg-red-500 text-white border-red-500" : "bg-bg-tertiary text-white border-border/50 hover:text-red-400"
                    )}
                    title="Errors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="w-px h-5 bg-border/50" />

                {/* Scroll to Bottom */}
                <button
                  onClick={scrollToBottom}
                  className="flex items-center gap-1.5 px-2 py-1 rounded transition-colors border bg-bg-tertiary text-white border-border/50 hover:text-white text-xs"
                  title="Scroll to Bottom"
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  <span>Bottom</span>
                </button>

                {/* Upload to mclo.gs */}
                <button
                  onClick={handleUploadToMcLogs}
                  disabled={isUploading || !logContent}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded transition-colors border text-xs",
                    isUploading ? "bg-accent/20 text-accent border-accent/50" : "bg-bg-tertiary text-white border-border/50 hover:text-white",
                    !logContent && "opacity-50 cursor-not-allowed"
                  )}
                  title="Upload to mclo.gs"
                >
                  {isUploading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  <span>{isUploading ? 'Uploading...' : 'MCLogs'}</span>
                </button>

                {/* Analyze button */}
                <button
                  onClick={async () => {
                    if (!logContent) return;

                    // Upload if not already uploaded (we don't track state persistent here easily without return value, 
                    // so we'll just re-upload or upload fresh. A more robust way would be to track returning URL)
                    // For now, let's just trigger the upload logic, but we need the URL.
                    // Let's reimplement a quick inline version or modify handleUploadToMcLogs                    
                    setIsUploading(true);
                    try {
                      // Re-using mclogs upload logic
                      const url = await mclogs.upload(logContent);

                      // Copy to clipboard internally just in case they want it
                      await import('../lib/tauri').then(m => m.utils.copyToClipboard(url));

                      success('Analyzing Log', 'Opening analyzer window...');

                      // Open In-App Analyzer Window
                      const { utils } = await import('../lib/tauri');
                      await utils.openAnalyzerWindow(url);

                    } catch (err) {
                      error('Analysis Failed', 'Could not upload log: ' + String(err));
                    } finally {
                      setIsUploading(false);
                    }
                  }}
                  disabled={isUploading || !logContent}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded transition-colors border text-xs",
                    isUploading ? "bg-accent/20 text-accent border-accent/50" : "bg-bg-tertiary text-white border-border/50 hover:text-white",
                    !logContent && "opacity-50 cursor-not-allowed"
                  )}
                  title="Open Dig Yourself Out analyzer"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>{isUploading ? 'Preparing...' : 'Analyze'}</span>
                </button>

                <div className="w-px h-5 bg-border/50" />

                {/* Open Folder button */}
                <button
                  onClick={async () => {
                    if (!profileId) return;
                    try {
                      await logs.openFolder(profileId);
                    } catch (err) {
                      error('Failed to open folder', String(err));
                    }
                  }}
                  className="flex items-center gap-1.5 px-2 py-1 rounded transition-colors border bg-bg-tertiary text-text-muted border-border/50 hover:text-white text-xs"
                  title="Open logs folder"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Open Folder</span>
                </button>
              </div>
            )}
          </div>

          <CardContent className="flex-1 p-0 overflow-hidden bg-bg-tertiary/30">
            {isLoadingContent ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2">
                <RefreshCw className="w-6 h-6 animate-spin" />
                <p className="text-xs">Loading log content...</p>
              </div>
            ) : !selectedLog ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted">
                <FileText className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">Select a log file to view its contents</p>
              </div>
            ) : filteredLogLines.length > 0 ? (
              <Virtuoso
                ref={virtuosoRef}
                data={filteredLogLines}
                totalCount={filteredLogLines.length}
                className="h-full"
                itemContent={(index, line) => (
                  <div
                    className={cn(
                      "flex px-4 py-0.5 font-mono text-xs hover:bg-white/5",
                      getLineColor(line),
                      searchQuery && line.toLowerCase().includes(searchQuery.toLowerCase()) && "bg-yellow-500/10"
                    )}
                  >
                    <span className="text-gray-600 select-none w-14 flex-shrink-0 text-right pr-3">
                      {index + 1}
                    </span>
                    <span className="flex-1 whitespace-pre-wrap break-all">
                      {line}
                    </span>
                  </div>
                )}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-text-muted">
                <p className="text-sm">{searchQuery || levelFilter !== 'ALL' ? 'No matching lines' : 'Log file is empty'}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}

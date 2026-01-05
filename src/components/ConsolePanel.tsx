import { useEffect, useRef, useCallback, useState } from 'react';
import { X, Terminal, AlertTriangle, BookOpen, Search, Minus, Plus, Clock, List, Info, AlertCircle, XCircle, ArrowDown } from 'lucide-react';
import { useConsoleStore } from '../stores/consoleStore';
import { cn } from '../lib/utils';
import { LogRenderer } from './console/LogRenderer';

export function ConsolePanel() {
  const { isConsoleOpen, closeConsole, logs, isGameRunning, crashReport, profileName } = useConsoleStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // New State for Enhancements
  const [searchQuery, setSearchQuery] = useState('');
  const [fontSize, setFontSize] = useState(12);
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>('ALL');
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Helper to check if a line is part of an error (stack trace)
  const isErrorRelated = (line: string) => {
    const trimmed = line.trim();
    return line.includes('ERROR') ||
      line.includes('Exception') ||
      trimmed.startsWith('at ') ||
      trimmed.startsWith('Caused by:') ||
      line.includes('.java:');
  };

  // Filtered Logs
  const filteredLogs = logs.filter(log => {
    const matchesSearch = searchQuery === '' || log.line.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesLevel = levelFilter === 'ALL' || (
      levelFilter === 'INFO' ? log.line.includes('INFO') :
        levelFilter === 'WARN' ? log.line.includes('WARN') :
          levelFilter === 'ERROR' ? (isErrorRelated(log.line) || log.stream === 'stderr') : true
    );
    return matchesSearch && matchesLevel;
  });

  // Smooth scroll to bottom
  const scrollToBottom = useCallback((smooth = true) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
  }, []);

  // Handle user scroll - detect if user is at bottom
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsAtBottom(atBottom);
  }, []);

  // Auto-scroll when new logs arrive IF user is at the bottom
  useEffect(() => {
    if (isConsoleOpen && isAtBottom) {
      requestAnimationFrame(() => {
        scrollToBottom(true);
      });
    }
  }, [logs, isConsoleOpen, scrollToBottom, isAtBottom]);

  // Scroll to bottom when console opens
  useEffect(() => {
    if (isConsoleOpen) {
      // Multiple attempts to ensure scroll happens after DOM renders
      scrollToBottom(true);
      setTimeout(() => scrollToBottom(true), 50);
      setTimeout(() => scrollToBottom(true), 150);
    }
  }, [isConsoleOpen, scrollToBottom]);

  if (!isConsoleOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={closeConsole}
      />

      {/* Console Window - Page-like centered design */}
      <div className="relative w-full max-w-5xl h-[85vh] bg-bg-primary rounded-2xl border border-border/50 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex flex-col border-b border-border bg-bg-secondary/80">
          <div className="flex items-center justify-between px-6 py-3">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-xl bg-accent/10 border border-accent/20">
                <Terminal className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  Game Console
                  {isGameRunning && profileName && <span className="text-sm font-normal text-text-muted px-2 py-0.5 rounded bg-white/5 border border-white/10">{profileName}</span>}
                </h2>
                <div className="flex items-center gap-2 mt-0.5">
                  {isGameRunning ? (
                    <span className="flex items-center gap-1.5 text-xs text-green-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      Game Running
                    </span>
                  ) : (
                    <span className="text-xs text-text-muted">Ready</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Search Bar */}
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted group-focus-within:text-accent transition-colors" />
                <input
                  type="text"
                  placeholder="Search logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 w-48 bg-bg-tertiary border border-border/50 rounded-lg pl-9 pr-3 text-xs text-white focus:outline-none focus:border-accent/50 transition-all placeholder:text-text-muted/50"
                />
              </div>

              {/* Level Filters - Icons */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setLevelFilter('ALL')}
                  className={cn(
                    "p-2 rounded-lg transition-colors border",
                    levelFilter === 'ALL' ? "bg-accent text-white border-accent" : "bg-bg-tertiary text-white border-border/50 hover:text-white"
                  )}
                  title="All Logs"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setLevelFilter('INFO')}
                  className={cn(
                    "p-2 rounded-lg transition-colors border",
                    levelFilter === 'INFO' ? "bg-blue-500 text-white border-blue-500" : "bg-bg-tertiary text-white border-border/50 hover:text-blue-400"
                  )}
                  title="Info Only"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setLevelFilter('WARN')}
                  className={cn(
                    "p-2 rounded-lg transition-colors border",
                    levelFilter === 'WARN' ? "bg-yellow-500 text-white border-yellow-500" : "bg-bg-tertiary text-white border-border/50 hover:text-yellow-400"
                  )}
                  title="Warnings Only"
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setLevelFilter('ERROR')}
                  className={cn(
                    "p-2 rounded-lg transition-colors border",
                    levelFilter === 'ERROR' ? "bg-red-500 text-white border-red-500" : "bg-bg-tertiary text-white border-border/50 hover:text-red-400"
                  )}
                  title="Errors Only"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="w-px h-6 bg-border mx-1" />

              {/* Font Controls */}
              <div className="flex items-center bg-bg-tertiary rounded-lg border border-border/50">
                <button onClick={() => setFontSize(s => Math.max(7, s - 1))} className="p-2 hover:bg-white/5 text-white hover:text-white rounded-l-lg">
                  <Minus className="w-3 h-3" />
                </button>
                <span className="text-[10px] w-6 text-center select-none text-white">{fontSize}px</span>
                <button onClick={() => setFontSize(s => Math.min(20, s + 1))} className="p-2 hover:bg-white/5 text-white hover:text-white rounded-r-lg">
                  <Plus className="w-3 h-3" />
                </button>
              </div>

              {/* Timestamp Toggle */}
              <button
                onClick={() => setShowTimestamps(!showTimestamps)}
                className={cn(
                  "p-2 rounded-lg transition-colors border",
                  showTimestamps ? "bg-accent/10 border-accent/20 text-accent" : "bg-bg-tertiary border-border/50 text-white hover:text-white"
                )}
                title={showTimestamps ? "Hide Timestamps" : "Show Timestamps"}
              >
                <Clock className="w-4 h-4" />
              </button>

              {/* Scroll to Bottom */}
              <button
                onClick={() => { scrollToBottom(true); setIsAtBottom(true); }}
                className={cn(
                  "p-2 rounded-lg transition-colors border",
                  isAtBottom ? "bg-bg-tertiary border-border/50 text-white" : "bg-accent/10 border-accent/20 text-accent"
                )}
                title="Scroll to Bottom"
              >
                <ArrowDown className="w-4 h-4" />
              </button>

              <button
                onClick={closeConsole}
                className="ml-2 p-2 text-white hover:text-white transition-all"
                title="Close console"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

        </div>

        {/* Crash Report Alert */}
        {crashReport && (
          <div className="bg-red-500/10 border-b border-red-500/20 px-6 py-4 flex gap-4 animate-in slide-in-from-top-2">
            <div className="p-2 bg-red-500/20 rounded-lg h-fit">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-white font-medium flex items-center gap-2">
                Crash Detected: {crashReport.title}
              </h3>
              <p className="text-sm text-gray-300 mt-1">
                {crashReport.description}
              </p>

              <div className="mt-3 p-3 bg-bg-tertiary rounded-lg border border-border/50">
                <div className="flex items-center gap-2 text-green-400 mb-1">
                  <BookOpen className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-wider">Suggested Solution</span>
                </div>
                <p className="text-sm text-gray-300">
                  {crashReport.solution}
                </p>
              </div>
            </div>
            <button
              onClick={() => useConsoleStore.getState().setCrashReport(null)}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-text-muted hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Console Output */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto scroll-smooth"
          style={{ scrollBehavior: 'smooth' }}
        >
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted py-20">
              <div className="p-4 rounded-2xl bg-bg-secondary/50 mb-4">
                <Terminal className="w-12 h-12 opacity-30" />
              </div>
              <p className="text-center text-sm">
                {isGameRunning
                  ? 'Waiting for game output...'
                  : 'No game output yet. Launch a game to see console logs.'}
              </p>
            </div>
          ) : (

            <div className="p-2 font-mono leading-relaxed" style={{ fontSize: `${fontSize}px` }}>
              {filteredLogs.map((log) => (
                <LogRenderer
                  key={log.id}
                  log={log}
                  fontSize={fontSize}
                  highlight={searchQuery}
                  showTimestamp={showTimestamps}
                />
              ))}
              {filteredLogs.length === 0 && (
                <div className="text-center text-text-muted italic py-10 opacity-50">
                  No logs match your filters.
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border bg-bg-secondary/50 flex items-center justify-between text-xs text-text-muted">
          <span>{filteredLogs.length.toLocaleString()} line{filteredLogs.length !== 1 ? 's' : ''} (of {logs.length})</span>
          <span className="opacity-50">Auto-scroll pauses when you scroll up</span>
        </div>
      </div>
    </div>
  );
}


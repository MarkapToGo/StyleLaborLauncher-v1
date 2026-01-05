import { useRef, useState } from 'react';
import { Terminal, ArrowDown, Search, Minus, Plus, Clock, List, Info, AlertCircle, XCircle } from 'lucide-react';
import { useConsoleStore } from '../stores/consoleStore';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { LogRenderer } from '../components/console/LogRenderer';


export function Console() {
  const { logs, isGameRunning, profileName } = useConsoleStore();
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // New State for Enhancements
  const [searchQuery, setSearchQuery] = useState('');
  const [fontSize, setFontSize] = useState(12);
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>('ALL');
  const [showTimestamps, setShowTimestamps] = useState(true);

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

  const scrollToBottom = () => {
    virtuosoRef.current?.scrollToIndex({
      index: filteredLogs.length - 1,
      align: 'end',
      behavior: 'smooth',
    });
  };

  return (
    <div className="w-full h-full flex flex-col space-y-4">
      {/* Header */}
      <div className="flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2 rounded-xl bg-accent/10 border border-accent/20">
              <Terminal className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white flex items-center gap-2">
                Game Console
                {isGameRunning && logs.length > 0 && <span className="text-sm font-normal text-text-muted px-2 py-0.5 rounded bg-white/5 border border-white/10">{profileName}</span>}
              </h1>
              <p className="text-xs text-text-secondary mt-0.5 flex items-center gap-2">
                {isGameRunning ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    Game is running
                  </>
                ) : logs.length > 0 ? (
                  'Game stopped'
                ) : (
                  'Launch a game to see console output'
                )}
              </p>
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
                className="h-9 w-48 bg-bg-secondary border border-border/50 rounded-lg pl-9 pr-3 text-xs text-white focus:outline-none focus:border-accent/50 transition-all placeholder:text-text-muted/50"
              />
            </div>

            {/* Level Filters - Icons */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setLevelFilter('ALL')}
                className={cn(
                  "p-2 rounded-lg transition-colors border",
                  levelFilter === 'ALL' ? "bg-accent text-white border-accent" : "bg-bg-secondary text-white border-border/50 hover:text-white"
                )}
                title="All Logs"
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setLevelFilter('INFO')}
                className={cn(
                  "p-2 rounded-lg transition-colors border",
                  levelFilter === 'INFO' ? "bg-blue-500 text-white border-blue-500" : "bg-bg-secondary text-white border-border/50 hover:text-blue-400"
                )}
                title="Info Only"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setLevelFilter('WARN')}
                className={cn(
                  "p-2 rounded-lg transition-colors border",
                  levelFilter === 'WARN' ? "bg-yellow-500 text-white border-yellow-500" : "bg-bg-secondary text-white border-border/50 hover:text-yellow-400"
                )}
                title="Warnings Only"
              >
                <AlertCircle className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setLevelFilter('ERROR')}
                className={cn(
                  "p-2 rounded-lg transition-colors border",
                  levelFilter === 'ERROR' ? "bg-red-500 text-white border-red-500" : "bg-bg-secondary text-white border-border/50 hover:text-red-400"
                )}
                title="Errors Only"
              >
                <XCircle className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="w-px h-6 bg-border mx-1" />

            {/* Font Controls */}
            <div className="flex items-center bg-bg-secondary rounded-lg border border-border/50">
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
                showTimestamps ? "bg-accent/10 border-accent/20 text-accent" : "bg-bg-secondary border-border/50 text-white hover:text-white"
              )}
              title={showTimestamps ? "Hide Timestamps" : "Show Timestamps"}
            >
              <Clock className="w-4 h-4" />
            </button>

            {/* Scroll to Bottom */}
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<ArrowDown className="w-3.5 h-3.5" />}
              onClick={scrollToBottom}
            >
              Bottom
            </Button>
          </div>
        </div>

      </div>

      {/* Console Output */}
      <Card hover={false} padding="none" className="flex-1 flex flex-col overflow-hidden">
        <CardContent className="flex-1 p-0 overflow-hidden h-full">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted py-20">
              <div className="p-4 rounded-2xl bg-bg-tertiary/50 mb-4">
                <Terminal className="w-12 h-12 opacity-30" />
              </div>
              <p className="text-center text-sm">
                {isGameRunning
                  ? 'Waiting for game output...'
                  : 'No game output yet. Launch a game to see console logs.'}
              </p>
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              data={filteredLogs}
              totalCount={filteredLogs.length}
              followOutput="auto"
              initialTopMostItemIndex={filteredLogs.length - 1}
              className="h-full"
              itemContent={(_, log) => (
                <LogRenderer
                  log={log}
                  fontSize={fontSize}
                  highlight={searchQuery}
                  showTimestamp={showTimestamps}
                />
              )}
              components={{
                Footer: () => <div className="h-4" />, // Padding at bottom
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>{filteredLogs.length.toLocaleString()} line{filteredLogs.length !== 1 ? 's' : ''} (of {logs.length})</span>
        <span className="opacity-50">Virtualized view active</span>
      </div>
    </div>
  );
}

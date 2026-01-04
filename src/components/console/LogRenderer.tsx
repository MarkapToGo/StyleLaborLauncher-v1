import { memo } from 'react';
import { cn } from '../../lib/utils';
import { ConsoleLine } from '../../stores/consoleStore';

interface LogRendererProps {
  log: ConsoleLine;
  fontSize: number;
  highlight?: string;
  showTimestamp?: boolean;
}

export const LogRenderer = memo(({ log, fontSize, highlight, showTimestamp = true }: LogRendererProps) => {
  // Simple parser to identify log levels and components
  // Example: [14:20:20] [Render thread/INFO]: Setting up custom window
  
  const parseLine = (text: string) => {
    // Regex for standard MC logs: [Time] [Thread/Level]: Message
    const match = text.match(/^(\[[:0-9]+\]) (\[[^\]]+\]): (.*)$/);
    
    if (match) {
        return {
            timestamp: match[1],
            meta: match[2],
            content: match[3]
        };
    }
    // Fallback: try to find component/level anyway even if format is weird
    return { content: text };
  };

  const parts = parseLine(log.line);
  
  const getLevelColor = (text: string) => {
      // Robust check: look in the specific meta part OR the whole line for key levels
      const checkText = text.toUpperCase();
      if (checkText.includes('ERROR') || checkText.includes('FATAL')) return 'text-red-400 font-bold';
      if (checkText.includes('WARN')) return 'text-yellow-400 font-bold';
      if (checkText.includes('INFO')) return 'text-blue-400';
      if (checkText.includes('DEBUG')) return 'text-purple-400';
      
      // Stack trace lines (start with "at " or contain exception info)
      const trimmed = text.trim();
      if (trimmed.startsWith('at ') || trimmed.startsWith('Caused by:') || text.includes('Exception') || text.includes('.java:')) {
          return 'text-red-300/80'; // Softer red for stack traces
      }
      
      return 'text-gray-400';
  };

  const highlightText = (text: string, query?: string) => {
      if (!query) return text;
      const parts = text.split(new RegExp(`(${query})`, 'gi'));
      return parts.map((part, i) => 
          part.toLowerCase() === query.toLowerCase() 
              ? <span key={i} className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{part}</span>
              : part
      );
  };

  const metaColor = parts.meta ? getLevelColor(parts.meta) : '';
  
  // Format the system timestamp
  const formattedTime = new Date(log.timestamp).toLocaleTimeString();

  return (
    <div 
      className={cn(
        'py-0.5 px-2 rounded hover:bg-white/5 transition-colors font-mono leading-tight flex gap-2 break-all',
        log.stream === 'stderr' ? 'text-red-300' : 'text-gray-300'
      )}
      style={{ fontSize: `${fontSize}px` }}
    >
        {/* Show system timestamp */}
        {showTimestamp && (
            <span className="text-gray-500 select-none flex-shrink-0 w-20">{formattedTime}</span>
        )}
        
        {/* Render parsed meta if available */}
        {parts.meta && (
            <span className={cn(metaColor, "flex-shrink-0")}>{parts.meta}</span>
        )}

        <span className={cn("flex-1 whitespace-pre-wrap", !parts.meta && getLevelColor(parts.content) !== 'text-gray-400' ? getLevelColor(parts.content) : '')}>
            {highlightText(parts.content, highlight)}
        </span>
    </div>
  );
});

LogRenderer.displayName = 'LogRenderer';

import { useState, useEffect } from 'react';
import { Activity, Cpu } from 'lucide-react';
import { monitor } from '../../lib/tauri';
import { cn } from '../../lib/utils'; // Assuming you have a utils file for cn

interface PerformanceMonitorProps {
  pid: number | null;
  isRunning: boolean;
}

export function PerformanceMonitor({ pid, isRunning }: PerformanceMonitorProps) {
  const [cpu, setCpu] = useState(0);
  const [ram, setRam] = useState(0); // in bytes

  useEffect(() => {
    if (!pid || !isRunning) {
      setCpu(0);
      setRam(0);
      return;
    }

    const interval = setInterval(async () => {
      try {
        const stats = await monitor.getStats(pid);
        setCpu(stats.cpu_usage);
        setRam(stats.memory_usage);
      } catch (err) {
        console.warn('Failed to fetch stats', err);
      }
    }, 1500); // Poll every 1.5s

    return () => clearInterval(interval);
  }, [pid, isRunning]);

  // Format RAM
  const formatRam = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  return (
    <div className="flex items-center gap-4 text-xs font-mono text-text-muted select-none pointer-events-none">
      <div className={cn("flex items-center gap-1.5 transition-colors", cpu > 80 ? "text-red-400" : (cpu > 0 ? "text-blue-400" : ""))}>
        <Cpu className="w-3.5 h-3.5" />
        <span>{Math.round(cpu)}%</span>
      </div>
      <div className={cn("flex items-center gap-1.5 transition-colors", ram > 1024 * 1024 * 1024 * 4 ? "text-yellow-400" : (ram > 0 ? "text-green-400" : ""))}>
        <Activity className="w-3.5 h-3.5" />
        <span>{formatRam(ram)}</span>
      </div>
    </div>
  );
}

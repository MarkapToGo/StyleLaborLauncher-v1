import { useState } from 'react';
import { X, Check, AlertTriangle, Zap, Info, Terminal, ArrowLeft, Crown } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

interface OptimizationGuideProps {
  onBack: () => void;
  onSelectPreset: (id: string) => void;
}

type FlagDetail = {
  flag: string;
  desc: string;
};

type PresetDetail = {
  id: string;
  name: string;
  icon: any;
  color: string;
  summary: string;
  pros: string[];
  cons?: string[];
  flags: FlagDetail[];
  minJava?: number;
};

export const PRESET_DETAILS: Record<string, PresetDetail> = {
  balanced: {
    id: 'balanced',
    name: "Balanced (Default)",
    icon: Check,
    color: "text-blue-400",
    summary: "Standard configuration provided by Java. Reliable for vanilla.",
    pros: ["Stable", "Simple", "Good for unmodified game"],
    flags: [
      { flag: "-Xmx[RAM]", desc: "Sets maximum memory allocation." },
      { flag: "-Xms[RAM]", desc: "Sets initial memory allocation (if Aikar's)." }
    ]
  },
  aikars: {
    id: 'aikars',
    name: "Aikar's Flags",
    icon: Zap,
    color: "text-green-400",
    summary: "The industry standard for modded Minecraft. Carefully tuned G1GC.",
    pros: ["Eliminates large freeze spikes", "Smooths out performance", "Best for servers/heavy mods"],
    flags: [
      { flag: "-XX:+UseG1GC", desc: "Enables G1 Garbage Collector (splits memory into regions)." },
      { flag: "-XX:+ParallelRefProcEnabled", desc: "Uses multiple CPU cores to clean up object references." },
      { flag: "-XX:MaxGCPauseMillis=200", desc: "Target max lag spike duration of 200ms." },
      { flag: "-XX:+UnlockExperimentalVMOptions", desc: "Allows using advanced/experimental optimizations." },
      { flag: "-XX:+DisableExplicitGC", desc: "Prevents mods/plugins from manually triggering laggy GCs." },
      { flag: "-XX:+AlwaysPreTouch", desc: "Reserves all RAM at startup to prevent lag later." },
      { flag: "-XX:G1NewSizePercent=30", desc: "Dedicates 30% of RAM to new objects (short-lived data)." },
      { flag: "-XX:G1MaxNewSizePercent=40", desc: "Caps new object area at 40% to prevent it eating everything." },
      { flag: "-XX:G1HeapRegionSize=8M", desc: "Sets chunk size for memory management." },
      { flag: "-XX:G1ReservePercent=20", desc: "Keeps 20% RAM empty as a safety buffer." },
      { flag: "-XX:G1HeapWastePercent=5", desc: "Accepts 5% wasted space to avoid expensive compaction." },
      { flag: "-XX:G1MixedGCCountTarget=4", desc: "Spreads cleanup over 4 pauses instead of 1 big one." },
      { flag: "-XX:InitiatingHeapOccupancyPercent=15", desc: "Starts cleaning when 15% full (aggressive)." },
      { flag: "-XX:G1MixedGCLiveThresholdPercent=90", desc: "Efficiently reclaiming space from old objects." },
      { flag: "-XX:SurvivorRatio=32", desc: "Optimizes lifespan of object survival." },
      { flag: "-XX:+PerfDisableSharedMem", desc: "Disables unnecessary disk I/O for stats." },
      { flag: "-XX:MaxTenuringThreshold=1", desc: "Promotes long-lived objects faster." }
    ]
  },
  low_memory: {
    id: 'low_memory',
    name: "Low Memory",
    icon: AlertTriangle,
    color: "text-yellow-400",
    summary: "Sacrifices smoothness to run on 4GB or less RAM.",
    pros: ["Lowest RAM usage", "Good for potato PCs"],
    cons: ["Will stutter frequently", "Not for large modpacks"],
    flags: [
      { flag: "-XX:+UseSerialGC", desc: "Uses Serial Garbage Collector. Pauses entire game to clean RAM. Saves memory but causes stutter." }
    ]
  },
  zgc_gen: {
    id: 'zgc_gen',
    name: "Generational ZGC",
    icon: Terminal,
    color: "text-purple-400",
    summary: "Modern low-latency collector (Java 21+). The future of optimization.",
    pros: ["<1ms pause times", "Incredibly smooth", "Separates young/old objects"],
    cons: ["Higher CPU usage"],
    minJava: 21,
    flags: [
      { flag: "-XX:+UseZGC", desc: "Replaces standard GC with a concurrent collector. Performs cleanup in the background to eliminate lag spikes." },
      { flag: "-XX:+ZGenerational", desc: "Separates young objects from old ones. Drastically lowers CPU usage and handles high allocation rates efficiently." }
    ]
  },
  ultimate: {
    id: 'ultimate',
    name: "Ultimate (Hybrid)",
    icon: Crown,
    color: "text-amber-400",
    summary: "Combines Generational ZGC with Aikar's generic system optimizations. The absolute peak of performance.",
    pros: ["Best possible smoothness", "System-level tuning", "Optimized pre-touch"],
    cons: ["Experimental"],
    minJava: 21,
    flags: [
        { flag: "-XX:+UseZGC", desc: "Background garbage collection that eliminates gameplay pauses." },
        { flag: "-XX:+ZGenerational", desc: "Generational mode (Young/Old split) for highly efficient, high-FPS memory management." },
        { flag: "-XX:+UnlockExperimentalVMOptions", desc: "Allows low-level VM optimizations (often used in mod packs)." },
        { flag: "-XX:+AlwaysPreTouch", desc: "Reserves RAM at startup (Aikar's recommendation)." },
        { flag: "-XX:+DisableExplicitGC", desc: "Prevents plugins from lagging server." },
        { flag: "-XX:+PerfDisableSharedMem", desc: "Reduces disk I/O overhead." },
        { flag: "-XX:+UseStringDeduplication", desc: "Reduces RAM usage by deduplicating strings." },
        { flag: "-Djava.net.preferIPv4Stack=true", desc: "Improves network reliability/startup speed." }
    ]
  },
  shenandoah: {
    id: 'shenandoah',
    name: "Shenandoah",
    icon: Terminal,
    color: "text-red-400",
    summary: "Alternative low-latency collector (Java 17+).",
    pros: ["Low pause times", "Good alternative if ZGC fails"],
    minJava: 17,
    flags: [
      { flag: "-XX:+UseShenandoahGC", desc: "Enables Shenandoah Garbage Collector." },
      { flag: "-XX:+AlwaysPreTouch", desc: "Reserves RAM at startup." }
    ]
  }
};

export function OptimizationGuide({ onBack, onSelectPreset }: OptimizationGuideProps) {
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  const selected = activePresetId ? PRESET_DETAILS[activePresetId] : null;

  return (
    <div className="flex flex-col h-full bg-bg-secondary w-full">
        {/* Header */}
        <div className="p-4 border-b border-border/50 flex items-center gap-3 bg-bg-tertiary/50 shrink-0">
             <Button 
                variant="ghost" 
                className="p-2 h-auto"
                onClick={() => activePresetId ? setActivePresetId(null) : onBack()}>
                <ArrowLeft className="w-5 h-5 text-text-secondary" />
             </Button>
             <div>
                <h2 className="text-lg font-bold text-white leading-none mb-1">
                    {activePresetId ? 'Preset Details' : 'Optimization Guide'}
                </h2>
                <p className="text-xs text-text-secondary">
                    {activePresetId ? `Analyzing ${PRESET_DETAILS[activePresetId].name}` : 'Select a preset to explore'}
                </p>
             </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
            {!selected ? (
                // OVERVIEW GRID
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
                    {/* Intro Card */}
                    <div className="col-span-full mb-4 bg-accent/10 border border-accent/20 rounded-xl p-4 flex gap-4">
                        <div className="p-2 bg-accent/20 rounded-lg h-fit">
                            <Info className="w-5 h-5 text-accent" />
                        </div>
                        <div>
                        <h3 className="font-semibold text-white mb-1">Why optimize?</h3>
                        <p className="text-sm text-text-secondary leading-relaxed">
                            Minecraft runs on the JVM. Choosing the right "Garbage Collector" (GC) strategy can eliminate lag spikes and improve FPS.
                            Click a card below to see technical details.
                        </p>
                        </div>
                    </div>

                   {Object.values(PRESET_DETAILS).map(preset => {
                       const Icon = preset.icon;
                       return (
                           <button 
                                key={preset.id}
                                onClick={() => setActivePresetId(preset.id)}
                                className="group text-left bg-bg-tertiary/30 border border-border/30 hover:border-accent/50 hover:bg-bg-tertiary/50 transition-all rounded-xl p-5 flex flex-col gap-3 relative overflow-hidden"
                            >
                                <div className="flex items-center justify-between w-full relative z-10">
                                    <div className={cn("p-2 rounded-lg bg-bg-tertiary group-hover:bg-bg-secondary transition-colors", preset.color.replace('text-', 'bg-').replace('400', '500/10'))}>
                                        <Icon className={cn("w-5 h-5", preset.color)} />
                                    </div>
                                    {preset.minJava && (
                                        <span className="text-[10px] font-mono bg-bg-tertiary px-1.5 py-0.5 rounded text-text-muted border border-border">
                                            v{preset.minJava}+
                                        </span>
                                    )}
                                </div>
                                
                                <div className="space-y-1 relative z-10">
                                    <h3 className="font-bold text-white group-hover:text-accent transition-colors">{preset.name}</h3>
                                    <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">
                                        {preset.summary}
                                    </p>
                                </div>

                                {/* Hover Effect */}
                                <div className="absolute inset-0 bg-gradient-to-br from-transparent to-accent/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                           </button>
                       )
                   })}
                </div>
            ) : (
                // DETAIL VIEW
                <div className="w-full space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                    {/* Header Details */}
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <selected.icon className={cn("w-8 h-8", selected.color)} />
                            <h2 className="text-2xl font-bold text-white">{selected.name}</h2>
                            <Button 
                                size="sm" 
                                variant="primary" 
                                className="ml-auto"
                                onClick={() => onSelectPreset(selected.id)}
                            >
                                Apply This Preset
                            </Button>
                        </div>
                        <p className="text-text-secondary text-lg leading-relaxed border-l-2 border-accent/50 pl-4 py-2 bg-accent/5 rounded-r-lg">
                            {selected.summary}
                        </p>
                    </div>

                    {/* Pros/Cons */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-green-500/5 border border-green-500/10 rounded-xl p-4">
                            <h4 className="text-green-400 text-xs font-bold uppercase mb-3 flex items-center gap-2">
                                <Check className="w-3 h-3" /> Pros
                            </h4>
                            <ul className="space-y-2">
                                {selected.pros.map(pro => (
                                    <li key={pro} className="text-sm text-text-secondary flex items-start gap-2">
                                        <Check className="w-3 h-3 text-green-500 mt-1 shrink-0" />
                                        {pro}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        {selected.cons && (
                            <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4">
                                <h4 className="text-red-400 text-xs font-bold uppercase mb-3 flex items-center gap-2">
                                    <X className="w-3 h-3" /> Cons
                                </h4>
                                <ul className="space-y-2">
                                    {selected.cons.map(con => (
                                        <li key={con} className="text-sm text-text-secondary flex items-start gap-2">
                                            <X className="w-3 h-3 text-red-500 mt-1 shrink-0" />
                                            {con}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>

                    {/* Technical Flags */}
                    <div>
                        <h4 className="text-white font-bold mb-4 flex items-center gap-2">
                            <Terminal className="w-4 h-4 text-accent" />
                            Technical Breakdown
                        </h4>
                        <div className="space-y-3">
                            {selected.flags.map((item, idx) => (
                                <div key={idx} className="group bg-bg-tertiary/30 border border-border/30 rounded-lg p-3 hover:border-accent/30 transition-colors">
                                    <div className="font-mono text-sm text-accent mb-1 break-all select-all">
                                        {item.flag}
                                    </div>
                                    <div className="text-xs text-text-muted group-hover:text-text-secondary transition-colors">
                                        {item.desc}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    </div>
  );
}
// End of file
// (Removed original mock wrapper logic)


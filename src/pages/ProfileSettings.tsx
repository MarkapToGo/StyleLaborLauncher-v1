import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon, Save, Cpu, Beaker, FileCode, Check, ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useProfileStore } from '../stores/profileStore';
import { useSettingsStore } from '../stores/settingsStore';
import { cn } from '../lib/utils';
import { invoke } from '@tauri-apps/api/core';
import { OptimizationGuide, PRESET_DETAILS } from '../components/profile/OptimizationGuideModal';

const MEMORY_PRESETS = [2048, 4096, 6144, 8192, 12288, 16384];

export function ProfileSettings() {
    const { profileId } = useParams<{ profileId: string }>();
    const navigate = useNavigate();
    const { profiles, updateProfile } = useProfileStore();
    const { settings } = useSettingsStore();

    const profile = profiles.find(p => p.id === profileId);

    const [loading, setLoading] = useState(false);
    const [showGuide, setShowGuide] = useState(false);

    // Form State
    const [useGlobalMemory, setUseGlobalMemory] = useState(true);
    const [showWarning, setShowWarning] = useState(false);
    const [pendingPreset, setPendingPreset] = useState<string | null>(null);

    const handlePresetChange = (presetId: string) => {
        if (['balanced', 'aikars'].includes(presetId)) {
            setJvmPreset(presetId);
        } else {
            setPendingPreset(presetId);
            setShowWarning(true);
        }
    };
    const [maxMemory, setMaxMemory] = useState(4096);
    const [javaPath, setJavaPath] = useState('');
    const [jvmPreset, setJvmPreset] = useState('balanced');
    const [customArgs, setCustomArgs] = useState('');
    const [autoJava, setAutoJava] = useState(true);
    const [systemTotalMb, setSystemTotalMb] = useState<number>(0);

    useEffect(() => {
        invoke<number>('get_system_memory').then(setSystemTotalMb).catch(console.error);
    }, []);

    // Initialize state when profile loads
    useEffect(() => {
        if (profile) {
            setUseGlobalMemory(profile.maxMemory === undefined || profile.maxMemory === null);
            setMaxMemory(profile.maxMemory || settings.defaultMaxMemory || 4096);
            setJavaPath(profile.javaPath || '');
            setJvmPreset(profile.jvmPreset || 'balanced');
            setCustomArgs(profile.customJvmArgs || '');
            setAutoJava(profile.javaPath ? false : true);
        }
    }, [profile, settings.defaultMaxMemory]);

    const handleSave = async () => {
        if (!profile) return;
        setLoading(true);
        try {
            await updateProfile({
                ...profile,
                maxMemory: useGlobalMemory ? undefined : maxMemory,
                javaPath: autoJava ? undefined : (javaPath || undefined),
                jvmPreset: jvmPreset === 'balanced' ? undefined : jvmPreset,
                customJvmArgs: customArgs || undefined,
            });
            navigate(`/profiles/${profile.id}`);
        } catch (err) {
            console.error('Failed to save settings', err);
        } finally {
            setLoading(false);
        }
    };

    if (!profile) {
        return <div className="p-8 text-center text-text-muted">Profile not found</div>;
    }

    if (showGuide) {
        return (
            <div className="h-full bg-bg-secondary">
                <OptimizationGuide
                    onBack={() => setShowGuide(false)}
                    onSelectPreset={(id) => {
                        setJvmPreset(id);
                        setShowGuide(false);
                    }}
                />
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-bg-secondary w-full animate-in fade-in">
            {/* Header */}
            <div className="p-4 border-b border-border/50 flex items-center justify-between bg-bg-tertiary/20">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="sm" className="p-0 h-8 w-8" onClick={() => navigate(`/profiles/${profile.id}`)}>
                        <ArrowLeft className="w-4 h-4 text-text-secondary" />
                    </Button>
                    <div>
                        <h1 className="text-lg font-bold text-white flex items-center gap-2">
                            <SettingsIcon className="w-5 h-5 text-accent" />
                            Settings
                        </h1>
                        <p className="text-xs text-text-secondary">Configuration for {profile.name} ({profile.version})</p>
                    </div>
                </div>

                <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSave}
                    isLoading={loading}
                    leftIcon={<Save className="w-4 h-4" />}
                >
                    Save Changes
                </Button>
            </div>

            <div className="flex-1 overflow-y-auto scroll-smooth-container p-8 w-full space-y-6">

                {/* Memory Settings */}
                <section className="space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                        <Cpu className="w-4 h-4 text-purple-400" />
                        <h3 className="text-sm font-semibold text-white">Memory Allocation</h3>
                    </div>

                    <div className="bg-bg-tertiary/30 p-4 rounded-xl border border-border/30">
                        <div className="flex justify-between text-xs text-text-secondary mb-3">
                            <span>Selected: <span className="text-white font-mono font-bold">{maxMemory} MB</span></span>
                            <span>System Total: {systemTotalMb > 0 ? `${Math.round(systemTotalMb)} MB` : 'Detecting...'}</span>
                        </div>

                        <div className="flex items-center justify-between mb-4">
                            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Use Global Default</label>
                            <button
                                onClick={() => {
                                    const newUseGlobal = !useGlobalMemory;
                                    setUseGlobalMemory(newUseGlobal);
                                    if (newUseGlobal) {
                                        setMaxMemory(settings.defaultMaxMemory || 4096);
                                    }
                                }}
                                className={cn(
                                    "w-10 h-5 rounded-full relative transition-colors",
                                    useGlobalMemory ? "bg-accent" : "bg-bg-tertiary"
                                )}
                            >
                                <div className={cn(
                                    "absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform",
                                    useGlobalMemory ? "translate-x-5" : "translate-x-0"
                                )} />
                            </button>
                        </div>

                        <div className={cn("transition-opacity space-y-6", useGlobalMemory && "opacity-50 pointer-events-none")}>
                            <input
                                type="range"
                                min="2048"
                                max="32768"
                                step="1024"
                                value={maxMemory}
                                onChange={(e) => setMaxMemory(Number(e.target.value))}
                                className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                                disabled={useGlobalMemory}
                            />

                            <div className="flex flex-wrap gap-2">
                                {MEMORY_PRESETS.map(preset => (
                                    <button
                                        key={preset}
                                        onClick={() => setMaxMemory(preset)}
                                        disabled={useGlobalMemory}
                                        className={cn(
                                            "px-3 py-1.5 text-xs rounded-md border transition-all",
                                            maxMemory === preset
                                                ? "bg-accent/20 border-accent text-accent font-semibold"
                                                : "bg-bg-tertiary border-transparent text-text-muted hover:bg-white/5",
                                            useGlobalMemory && "cursor-not-allowed"
                                        )}
                                    >
                                        {preset / 1024} GB
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Java & JVM Settings */}
                <section className="space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                        <Beaker className="w-4 h-4 text-green-400" />
                        <h3 className="text-sm font-semibold text-white">Java & Optimization</h3>
                        <span className="bg-yellow-500/20 text-yellow-400 text-[10px] font-bold px-1.5 py-0.5 rounded border border-yellow-500/30">BETA</span>
                        <div className="flex-1" />
                        <button
                            onClick={() => setShowGuide(true)}
                            className="text-xs font-medium text-accent hover:text-accent-hover hover:underline flex items-center gap-1 transition-colors"
                        >
                            Explain Presets <ArrowLeft className="w-4 h-4 rotate-180" />
                        </button>
                    </div>

                    <div className="space-y-4">
                        {/* JVM Presets */}
                        <div className="bg-bg-tertiary/30 p-4 rounded-xl border border-border/30 space-y-3">
                            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Optimization Preset</label>
                            <div className="grid md:grid-cols-2 gap-3">
                                {Object.values(PRESET_DETAILS).map(preset => {
                                    const Icon = preset.icon;
                                    return (
                                        <button
                                            key={preset.id}
                                            onClick={() => handlePresetChange(preset.id)}
                                            className={cn(
                                                "text-left p-3 rounded-lg border transition-all flex flex-col gap-1 relative overflow-hidden group",
                                                jvmPreset === preset.id
                                                    ? "bg-accent/10 border-accent/50 shadow-[0_0_15px_-5px_var(--accent)]"
                                                    : "bg-bg-secondary border-border/50 hover:border-border hover:bg-white/5"
                                            )}
                                        >
                                            <div className="flex justify-between items-center w-full">
                                                <div className="flex items-center gap-2">
                                                    <Icon className={cn("w-4 h-4", jvmPreset === preset.id ? "text-accent" : "text-text-secondary")} />
                                                    <span className={cn("font-bold text-xs", jvmPreset === preset.id ? "text-accent" : "text-white")}>{preset.name}</span>
                                                </div>
                                                {jvmPreset === preset.id && <Check className="w-3.5 h-3.5 text-accent" />}
                                            </div>
                                            <span className="text-[10px] text-text-secondary leading-tight group-hover:text-text-primary transition-colors line-clamp-2 pl-6">{preset.summary}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Preset Warning Modal */}
                        {showWarning && (
                            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                                <div className="bg-bg-secondary border border-border p-6 rounded-xl shadow-2xl max-w-md w-full mx-4 space-y-4 animate-in zoom-in-95 duration-200">
                                    <div className="flex items-center gap-3 text-yellow-500">
                                        <div className="p-2 bg-yellow-500/10 rounded-full">
                                            <SettingsIcon className="w-6 h-6" />
                                        </div>
                                        <h3 className="text-lg font-bold text-white">Experimental Preset</h3>
                                    </div>

                                    <p className="text-sm text-text-secondary leading-relaxed">
                                        You are complying to use an <strong>Experimental Optimization Preset</strong>.
                                        <br /><br />
                                        These presets (ZGC, Ultimate, Shenandoah) utilize advanced JVM features that may cause <strong>crashes or instability</strong> on some hardware or modpacks.
                                    </p>

                                    <div className="bg-bg-tertiary/50 p-3 rounded-lg border border-yellow-500/20">
                                        <p className="text-xs text-yellow-200/80 font-medium">
                                            If the game fails to launch or crashes, please switch back to <strong>Default</strong> or <strong>High Performance (Aikar's)</strong> immediately.
                                        </p>
                                    </div>

                                    <div className="flex justify-end gap-3 pt-2">
                                        <Button
                                            variant="ghost"
                                            onClick={() => {
                                                setShowWarning(false);
                                                setPendingPreset(null);
                                            }}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            variant="primary"
                                            className="bg-yellow-500 hover:bg-yellow-600 text-black border-none"
                                            onClick={() => {
                                                if (pendingPreset) {
                                                    setJvmPreset(pendingPreset);
                                                    setPendingPreset(null);
                                                }
                                                setShowWarning(false);
                                            }}
                                        >
                                            I Understand, Apply
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Java Path */}
                        <div className="bg-bg-tertiary/30 p-4 rounded-xl border border-border/30 space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Java Executable</label>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-text-secondary">Auto-detect</span>
                                    <button
                                        onClick={() => {
                                            setAutoJava(!autoJava);
                                            if (!autoJava) setJavaPath('');
                                        }}
                                        className={cn(
                                            "w-10 h-5 rounded-full relative transition-colors",
                                            autoJava ? "bg-accent" : "bg-bg-tertiary"
                                        )}
                                    >
                                        <div className={cn(
                                            "absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform",
                                            autoJava ? "translate-x-5" : "translate-x-0"
                                        )} />
                                    </button>
                                </div>
                            </div>

                            {!autoJava && (
                                <div>
                                    <input
                                        type="text"
                                        value={javaPath}
                                        onChange={(e) => setJavaPath(e.target.value)}
                                        placeholder="C:\Program Files\Java\jdk-17\bin\java.exe"
                                        className="w-full bg-bg-secondary border border-border/50 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent font-mono"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Custom Arguments */}
                        <div className="bg-bg-tertiary/30 p-4 rounded-xl border border-border/30 space-y-3">
                            <div className="flex items-center gap-2">
                                <FileCode className="w-4 h-4 text-blue-400" />
                                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Custom JVM Arguments</label>
                            </div>
                            <textarea
                                value={customArgs}
                                onChange={(e) => setCustomArgs(e.target.value)}
                                placeholder="-Dsome.property=true -XX:+GenericFlag"
                                className="w-full h-20 bg-bg-secondary border border-border/50 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent font-mono resize-none leading-relaxed"
                            />
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}

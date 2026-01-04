
import { useNavigate } from 'react-router-dom';
import { Play, ChevronDown } from 'lucide-react';
import { useAccountStore } from '../stores/accountStore';
import { useProfileStore } from '../stores/profileStore';
import { useSettingsStore } from '../stores/settingsStore';
import { SkinViewer } from '../components/SkinViewer';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/utils';

import { MatrixBackground } from '../components/backgrounds/MatrixBackground';
import { FluidBackground } from '../components/backgrounds/FluidBackground';
import { OctagonSquareBackground } from '../components/backgrounds/OctagonSquareBackground';
import { WavyBackground } from '../components/backgrounds/WavyBackground';
import { SnowBackground } from '../components/backgrounds/SnowBackground';
import { VHSBackground } from '../components/backgrounds/VHSBackground';
import { StarsBackground } from '../components/backgrounds/StarsBackground';

export function Home() {
    const { activeAccount } = useAccountStore();
    const { selectedProfile, launchProfile, isLaunching } = useProfileStore();
    const { settings } = useSettingsStore();
    const navigate = useNavigate();

    const handleLaunch = async () => {
        if (selectedProfile) {
            launchProfile(selectedProfile.id);
        } else {
            navigate('/modpacks');
        }
    };

    return (
        <div className="w-full h-full relative overflow-hidden bg-bg-primary">
            {/* Background Effects */}
            {(!settings.homeBackground || settings.homeBackground === 'default') && (
                <div className="absolute inset-0 z-0">
                    {/* Spotlight */}
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-accent/20 via-transparent to-transparent opacity-70" />

                    {/* Grid Pattern */}
                    <div
                        className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]"
                    />

                    {/* Vignette */}
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,_var(--tw-gradient-stops))] from-transparent via-bg-primary/50 to-bg-primary" />
                </div>
            )}

            {settings.homeBackground === 'stars' && <StarsBackground />}
            {settings.homeBackground === 'matrix' && <MatrixBackground />}
            {settings.homeBackground === 'fluid' && <FluidBackground />}
            {settings.homeBackground === 'octagon-square' && <OctagonSquareBackground />}
            {settings.homeBackground === 'wavy' && <WavyBackground />}
            {settings.homeBackground === 'snow' && <SnowBackground />}
            {settings.homeBackground === 'vhs' && <VHSBackground />}
            {/* Layer 1: 3D Skin Render (Centered Background) */}
            <div className="absolute inset-0 flex items-center justify-center z-0">
                <SkinViewer
                    uuid={activeAccount?.uuid}
                    skinUrl={activeAccount?.skinUrl}
                    width={400}
                    height={600}
                    className="drop-shadow-2xl"
                    animation={settings.skinPose || 'cool'}
                />
            </div>

            {/* Layer 2: UI Overlay (Flex Column for Positioning) */}
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-between pt-10 pb-16 pointer-events-none">

                {/* Top: Player Name */}
                <div className="pointer-events-auto">
                    <h1 className="text-3xl text-white font-minecraft-five tracking-widest drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)] uppercase">
                        {activeAccount ? activeAccount.username : 'Maudado'}
                    </h1>
                </div>

                {/* Bottom: Launch Menu (Positioned over legs area) */}
                <div className="flex items-center gap-2 bg-bg-secondary/90 backdrop-blur-md p-2 pl-2 pr-2 rounded-2xl border border-white/10 shadow-2xl scale-110 pointer-events-auto mb-12">
                    <Button
                        size="lg"
                        className={cn(
                            "rounded-xl px-10 h-16 font-minecraft-five tracking-widest text-xl flex flex-col items-center justify-center gap-2 transition-all duration-300 leading-none",
                            selectedProfile
                                ? "shadow-[0_0_20px_rgba(123,108,255,0.4)]"
                                : "bg-gray-700/50 text-gray-400 hover:bg-gray-700/70 shadow-none border-gray-600/50"
                        )}
                        onClick={handleLaunch}
                        isLoading={isLaunching}
                        leftIcon={null}
                    >
                        <div className="flex items-center justify-center gap-2 w-full pt-1">
                            <Play className="w-5 h-5 fill-current" />
                            <span>PLAY</span>
                        </div>
                        {selectedProfile ? (
                            <span className="text-[8px] font-sans font-normal tracking-normal opacity-80 text-white/90 w-full text-center pb-1">
                                {selectedProfile.name}
                            </span>
                        ) : (
                            <span className="text-[8px] font-poppins font-normal tracking-normal opacity-60 uppercase w-full text-center pb-1">
                                Click to select pack
                            </span>
                        )}
                    </Button>

                    <div className="h-10 w-px bg-white/10 mx-1" />

                    <button
                        onClick={() => navigate('/modpacks')}
                        className="w-14 h-14 flex items-center justify-center rounded-xl hover:bg-white/5 text-text-muted hover:text-white transition-colors"
                        title="Select Profile"
                    >
                        <ChevronDown className="w-8 h-8" />
                    </button>
                </div>
            </div>
        </div>
    );
}

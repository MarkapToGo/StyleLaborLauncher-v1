import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { Button } from '../ui/Button';
import {
    Home,
    Package,
    Users,
    Image as ImageIcon,
    Terminal,
    Settings,
    ChevronRight,
    Check
} from 'lucide-react';
import { cn } from '../../lib/utils';

export function OnboardingOverlay() {
    const { overviewFinished, finishOverview } = useOnboardingStore();
    const [currentStep, setCurrentStep] = useState(0);

    if (overviewFinished) return null;

    const steps = [
        {
            title: "Welcome to StyleLabor Launcher",
            description: "The ultimate launcher experience awaits. Let's take a quick tour to show you what's possible.",
            icon: <img src="/logo-512.png" className="w-24 h-24 mb-4" alt="Logo" /> // Assuming icon.png exists or fallback
        },
        {
            title: "Home Dashboard",
            description: "Your command center. Get quick access to recent profiles, verify server status, and see the latest news at a glance.",
            icon: <Home className="w-16 h-16 text-accent" />
        },
        {
            title: "Modpacks",
            description: "Browse and install curated modpacks with a single click. Discover new adventures and keep everything up to date effortlessly.",
            icon: <Package className="w-16 h-16 text-accent" />
        },
        {
            title: "Profiles Management",
            description: "Create and manage multiple instances. Customize enhanced settings, view crash logs, and manage content per profile.",
            icon: <Users className="w-16 h-16 text-accent" />
        },
        {
            title: "Gallery",
            description: "Your memories, organized. View your in-game screenshots, manage them in a grid, and easily share your best moments.",
            icon: <ImageIcon className="w-16 h-16 text-accent" />
        },
        {
            title: "Console",
            description: "For the power users. Monitor live game output, debug issues, and view detailed crash reports in real-time.",
            icon: <Terminal className="w-16 h-16 text-accent" />
        },
        {
            title: "Settings",
            description: "Make it yours. Customize themes, Java arguments, memory allocation, and more to fit your exact needs.",
            icon: <Settings className="w-16 h-16 text-accent" />
        },
        {
            title: "You're All Set!",
            description: "You're ready to jump in. If you ever need to review this transform, you can reset it in settings.",
            icon: <Check className="w-16 h-16 text-green-500" />
        }
    ];

    const handleNext = () => {
        if (currentStep < steps.length - 1) {
            setCurrentStep(currentStep + 1);
        } else {
            finishOverview();
        }
    };

    const handleBack = () => {
        if (currentStep > 0) {
            setCurrentStep(currentStep - 1);
        }
    };

    const handleSkip = () => {
        finishOverview();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />

            {/* Content */}
            <motion.div
                className="relative z-10 w-full max-w-2xl bg-bg-secondary border border-border rounded-xl shadow-2xl overflow-hidden"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", duration: 0.5 }}
            >
                <div className="flex h-[400px]">
                    {/* Left Side - Visuals */}
                    <div className="w-1/2 bg-bg-tertiary/50 p-8 flex flex-col items-center justify-center text-center relative overflow-hidden">
                        <div className="absolute inset-0 bg-accent/5" />
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={currentStep}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ duration: 0.2 }}
                                className="relative z-10 flex flex-col items-center"
                            >
                                {steps[currentStep].icon}
                            </motion.div>
                        </AnimatePresence>

                        {/* Progress Indicators */}
                        <div className="absolute bottom-6 flex gap-2">
                            {steps.map((_, idx) => (
                                <div
                                    key={idx}
                                    className={cn(
                                        "w-2 h-2 rounded-full transition-colors duration-300",
                                        idx === currentStep ? "bg-accent" : "bg-border"
                                    )}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Right Side - Content */}
                    <div className="w-1/2 p-8 flex flex-col relative">
                        <button
                            onClick={handleSkip}
                            className="absolute top-4 right-4 text-text-muted hover:text-white transition-colors text-xs font-medium uppercase tracking-wider"
                        >
                            Skip
                        </button>

                        <div className="flex-1 flex flex-col justify-center">
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={currentStep}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <h2 className="text-2xl font-bold text-white mb-4">
                                        {steps[currentStep].title}
                                    </h2>
                                    <p className="text-text-secondary leading-relaxed">
                                        {steps[currentStep].description}
                                    </p>
                                </motion.div>
                            </AnimatePresence>
                        </div>

                        <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
                            <Button
                                variant="ghost"
                                onClick={handleBack}
                                disabled={currentStep === 0}
                                className={currentStep === 0 ? "invisible" : ""}
                            >
                                Back
                            </Button>

                            <Button
                                onClick={handleNext}
                                rightIcon={currentStep === steps.length - 1 ? <Check className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            >
                                {currentStep === steps.length - 1 ? "Get Started" : "Next"}
                            </Button>
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OnboardingState {
    overviewFinished: boolean;
    finishOverview: () => void;
    resetOverview: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
    persist(
        (set) => ({
            overviewFinished: false,
            finishOverview: () => set({ overviewFinished: true }),
            resetOverview: () => set({ overviewFinished: false }),
        }),
        {
            name: 'onboarding-storage',
        }
    )
);

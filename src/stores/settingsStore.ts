import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LauncherSettings } from '../types';
import { settings } from '../lib/tauri';

interface SettingsState {
  settings: LauncherSettings;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchSettings: () => Promise<void>;
  updateSettings: (updates: Partial<LauncherSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
  clearError: () => void;
}

const defaultSettings: LauncherSettings = {
  javaPath: '',
  defaultMinMemory: 2048,
  defaultMaxMemory: 4096,
  closeOnLaunch: false,
  modpackServerUrl: '',
  theme: 'dark',
  accentColor: '#6366f1',
  homeBackground: 'default',
  skinPose: 'cool',
  galleryViewMode: 'grid',
  galleryGridSize: 4,
  discordRpc: true,  // Enable Discord Rich Presence by default
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      isLoading: false,
      error: null,

      fetchSettings: async () => {
        set({ isLoading: true, error: null });
        try {
          const loadedSettings = await settings.get();
          set({ settings: loadedSettings, isLoading: false });
        } catch (error) {
          // Use defaults if settings don't exist yet
          set({ settings: defaultSettings, isLoading: false });
        }
      },

      updateSettings: async (updates) => {
        const newSettings = { ...get().settings, ...updates };
        set({ settings: newSettings, isLoading: true, error: null });
        try {
          await settings.save(newSettings);
          set({ isLoading: false });
        } catch (error) {
          set({ error: String(error), isLoading: false });
        }
      },

      resetSettings: async () => {
        set({ settings: defaultSettings, isLoading: true, error: null });
        try {
          await settings.save(defaultSettings);
          set({ isLoading: false });
        } catch (error) {
          set({ error: String(error), isLoading: false });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'settings-storage',
      partialize: (state) => ({ settings: state.settings }),
    }
  )
);

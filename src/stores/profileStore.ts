import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Profile } from '../types';
import { profiles } from '../lib/tauri';

interface ProfileState {
  profiles: Profile[];
  selectedProfile: Profile | null;
  isLoading: boolean;
  isLaunching: boolean;
  error: string | null;

  // Actions
  fetchProfiles: () => Promise<void>;
  createProfile: (profile: Omit<Profile, 'id'>) => Promise<Profile>;
  updateProfile: (profile: Profile) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  selectProfile: (id: string) => void;
  launchProfile: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
      profiles: [],
      selectedProfile: null,
      isLoading: false,
      isLaunching: false,
      error: null,

      fetchProfiles: async () => {
        set({ isLoading: true, error: null });
        try {
          const profileList = await profiles.getAll();

          // Try to load last played profile ID from localStorage
          const lastPlayedId = localStorage.getItem('lastPlayedProfileId');

          let selectedProfile = null;
          if (lastPlayedId) {
            selectedProfile = profileList.find(p => p.id === lastPlayedId) || null;
          }

          // Fallback logic if no last played or not found
          if (!selectedProfile) {
            selectedProfile = get().selectedProfile
              ? profileList.find(p => p.id === get().selectedProfile?.id) || profileList[0] || null
              : profileList[0] || null;
          }

          set({ profiles: profileList, selectedProfile, isLoading: false });
        } catch (error) {
          set({ error: String(error), isLoading: false });
        }
      },

      createProfile: async (profile) => {
        set({ isLoading: true, error: null });
        try {
          const newProfile = await profiles.create(profile);
          set({
            profiles: [...get().profiles, newProfile],
            selectedProfile: newProfile,
            isLoading: false
          });
          return newProfile;
        } catch (error) {
          set({ error: String(error), isLoading: false });
          throw error;
        }
      },

      updateProfile: async (profile) => {
        set({ isLoading: true, error: null });
        try {
          await profiles.update(profile);
          const updatedProfiles = get().profiles.map(p =>
            p.id === profile.id ? profile : p
          );
          set({
            profiles: updatedProfiles,
            selectedProfile: profile.id === get().selectedProfile?.id ? profile : get().selectedProfile,
            isLoading: false
          });
        } catch (error) {
          set({ error: String(error), isLoading: false });
        }
      },

      deleteProfile: async (id) => {
        set({ isLoading: true, error: null });
        try {
          await profiles.delete(id);
          const remainingProfiles = get().profiles.filter(p => p.id !== id);
          set({
            profiles: remainingProfiles,
            selectedProfile: id === get().selectedProfile?.id
              ? remainingProfiles[0] || null
              : get().selectedProfile,
            isLoading: false
          });
        } catch (error) {
          set({ error: String(error), isLoading: false });
        }
      },

      selectProfile: (id) => {
        const profile = get().profiles.find(p => p.id === id) || null;
        set({ selectedProfile: profile });
      },

      launchProfile: async (id) => {
        set({ isLaunching: true, error: null });
        try {
          console.debug('[launcher] launchProfile requested', { id });

          // Save last played profile ID
          localStorage.setItem('lastPlayedProfileId', id);

          await profiles.launch(id);
          // Update last played
          const updatedProfiles = get().profiles.map(p =>
            p.id === id ? { ...p, lastPlayed: Date.now() } : p
          );
          set({ profiles: updatedProfiles, isLaunching: false });
        } catch (error) {
          console.debug('[launcher] launchProfile failed', { id, error });
          set({ error: String(error), isLaunching: false });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'profile-storage',
      partialize: (state) => ({
        selectedProfile: state.selectedProfile
      }),
    }
  )
);

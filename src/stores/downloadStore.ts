import { create } from 'zustand';
import type { DownloadProgress, InstallProgress, InstallStage } from '../types';

interface DownloadState {
  currentInstall: InstallProgress | null;
  downloads: DownloadProgress[];
  isInstalling: boolean;
  
  // Actions
  startInstall: (stage: InstallStage, message: string, modpackId?: string) => void;
  updateInstall: (updates: Partial<InstallProgress>) => void;
  updateDownload: (download: DownloadProgress) => void;
  completeInstall: () => void;
  failInstall: (error: string) => void;
  reset: () => void;
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  currentInstall: null,
  downloads: [],
  isInstalling: false,

  startInstall: (stage, message, modpackId?) => {
    set({
      currentInstall: {
        modpackId,
        stage,
        message,
        progress: 0,
        downloads: [],
      },
      downloads: [],
      isInstalling: true,
    });
  },

  updateInstall: (updates) => {
    const current = get().currentInstall;
    if (current) {
      set({
        currentInstall: { ...current, ...updates },
      });
    }
  },

  updateDownload: (download) => {
    const downloads = get().downloads;
    const index = downloads.findIndex(d => d.id === download.id);
    
    if (index >= 0) {
      downloads[index] = download;
    } else {
      downloads.push(download);
    }
    
    set({ downloads: [...downloads] });
    
    // Update overall progress based on downloads
    const current = get().currentInstall;
    if (current && downloads.length > 0) {
      const totalProgress = downloads.reduce((acc, d) => acc + d.current, 0);
      const totalSize = downloads.reduce((acc, d) => acc + d.total, 0);
      const progress = totalSize > 0 ? (totalProgress / totalSize) * 100 : 0;
      
      set({
        currentInstall: { 
          ...current, 
          progress,
          downloads: downloads,
        },
      });
    }
  },

  completeInstall: () => {
    set({
      currentInstall: {
        stage: 'complete',
        message: 'Installation complete!',
        progress: 100,
      },
      isInstalling: false,
    });
  },

  failInstall: (error) => {
    const current = get().currentInstall;
    set({
      currentInstall: current ? {
        ...current,
        stage: 'failed',
        message: error,
      } : null,
      isInstalling: false,
    });
  },

  reset: () => {
    set({
      currentInstall: null,
      downloads: [],
      isInstalling: false,
    });
  },
}));

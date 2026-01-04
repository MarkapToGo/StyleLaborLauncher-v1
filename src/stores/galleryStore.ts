import { create } from 'zustand';
import { gallery } from '../lib/tauri';
import { listen } from '@tauri-apps/api/event';

export interface GalleryImage {
  id: string;
  filename: string;
  path: string;
  timestamp: number;
  origin_profile?: string;
}

interface GalleryState {
  images: GalleryImage[];
  isLoading: boolean;
  hasImages: boolean;

  fetchImages: () => Promise<void>;
  addImage: (image: GalleryImage) => void;
  removeImage: (id: string) => Promise<void>;
  subscribeToEvents: () => Promise<() => void>;
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  images: [],
  isLoading: false,
  hasImages: false,

  fetchImages: async () => {
    set({ isLoading: true });
    try {
      const images = await gallery.getAll();
      set({ 
        images, 
        hasImages: images.length > 0,
        isLoading: false 
      });
    } catch (error) {
      console.error('Failed to fetch gallery images:', error);
      set({ isLoading: false });
    }
  },

  addImage: (image) => {
    set((state) => {
        // Prevent duplicates
        if (state.images.some(img => img.filename === image.filename)) {
            return state;
        }

      const newImages = [image, ...state.images];
      return {
        images: newImages,
        hasImages: newImages.length > 0
      };
    });
  },

  removeImage: async (id) => {
    try {
      await gallery.delete(id);
      set((state) => {
        const newImages = state.images.filter((img) => img.id !== id);
        return {
          images: newImages,
          hasImages: newImages.length > 0
        };
      });
    } catch (error) {
      console.error('Failed to delete image:', error);
      throw error;
    }
  },
  
  subscribeToEvents: async () => {
      const unlisten = await listen<GalleryImage>('screenshot-added', (event) => {
          get().addImage(event.payload);
      });
      return unlisten;
  }
}));

// Account types
export interface Account {
  uuid: string;
  username: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  isActive: boolean;
  skinUrl?: string;
}

// Profile/Instance types
export interface Profile {
  id: string;
  name: string;
  version: string;
  loader: ModLoader;
  loaderVersion?: string;
  icon?: string;
  lastPlayed?: number;
  playTime?: number;
  javaPath?: string;
  jvmArgs?: string;
  minMemory?: number;
  maxMemory?: number;
  resolution?: {
    width: number;
    height: number;
  };
  sourceId?: string;
  modpackVersion?: string;
  jvmPreset?: string;
  customJvmArgs?: string;
}

export type ModLoader = 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt';

// Modpack types
export interface Modpack {
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
  icon?: string;
  mcVersion: string;
  loader: ModLoader;
  loaderVersion: string;
  source: 'curseforge' | 'modrinth' | 'local';
  sourceId?: string;
  categories?: string[]; // Tags/categories from CurseForge/Modrinth
}

export interface ModpackFile {
  projectId: number;
  fileId: number;
  name?: string;
  downloadUrl?: string;
  size?: number;
  hash?: string;
  hashAlgorithm?: 'sha1' | 'sha512';
}

// Download progress
export interface DownloadProgress {
  id: string;
  name: string;
  current: number;
  total: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  error?: string;
}

export interface InstallProgress {
  modpackId?: string;
  stage: InstallStage;
  message: string;
  progress: number;
  downloads?: DownloadProgress[];
}

export type InstallStage =
  | 'parsing'
  | 'downloading_minecraft'
  | 'downloading_loader'
  | 'downloading_mods'
  | 'extracting'
  | 'finalizing'
  | 'complete'
  | 'failed';

// Settings
export interface LauncherSettings {
  javaPath: string;
  defaultMinMemory: number;
  defaultMaxMemory: number;
  closeOnLaunch: boolean;
  modpackServerUrl?: string; // Optional URL for custom modpack server
  theme: 'dark' | 'light' | 'system';
  accentColor: string;
  gameDataPath?: string;
  homeBackground?: 'default' | 'none' | 'stars' | 'matrix' | 'liquid' | 'fluid' | 'octagon-square' | 'wavy' | 'snow' | 'vhs';
  vhsNoLines?: boolean;
  skinPose?: 'idle' | 'walk' | 'cool' | 'hero' | 'wave' | 'sleep' | 'levitate' | 'sit';
  galleryViewMode?: 'grid' | 'list';
  galleryGridSize?: number;
  discordRpc?: boolean;  // Enable/disable Discord Rich Presence
}

// Toast notifications
export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
}

// API responses
export interface MinecraftProfile {
  id: string;
  name: string;
  skins?: Array<{
    url: string;
    variant: string;
  }>;
}

export interface AuthResult {
  success: boolean;
  account?: Account;
  error?: string;
}

export interface ModInfo {
  fileName: string;
  sizeBytes: number;
  modId?: number;
  name?: string;
  author?: string;
  description?: string;
  iconPath?: string;
  isExtra?: boolean;
  isUserInstalled?: boolean;
}

// Modrinth search results (snake_case to match Rust serialization)
export interface ModrinthSearchResult {
  project_id: string;
  title: string;
  description: string;
  icon_url?: string;
  author: string;
  slug: string;
  downloads: number;
  follows: number;
}

// User-installed mod entry
export interface UserModEntry {
  projectId: string;
  versionId: string;
  fileName: string;
  name: string;
  author: string;
  description?: string;
  iconUrl?: string;
  installedAt: number;
}

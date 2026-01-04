import { invoke } from '@tauri-apps/api/core';
import type { Account, Profile, LauncherSettings, Modpack, ModrinthSearchResult, UserModEntry, ModInfo } from '../types';

// Authentication commands
// Authentication commands
export const auth = {
  startLogin: () => invoke<{
    user_code: string;
    verification_uri: string;
    device_code: string;
    expires_in: number;
    interval: number;
    message: string;
  }>('start_device_login'),
  pollLogin: (deviceCode: string) => invoke<Account | null>('poll_login', { deviceCode }),
  logout: (uuid: string) => invoke<void>('logout', { uuid }),
  refreshToken: (uuid: string) => invoke<Account>('refresh_token', { uuid }),
  getAccounts: () => invoke<Account[]>('get_accounts'),
  switchAccount: (uuid: string) => invoke<void>('switch_account', { uuid }),
};

// Profile commands
export const profiles = {
  getAll: () => invoke<Profile[]>('get_profiles'),
  create: (profile: Omit<Profile, 'id'>) => invoke<Profile>('create_profile', { profile }),
  update: (profile: Profile) => invoke<void>('update_profile', { profile }),
  delete: (id: string) => invoke<void>('delete_profile', { id }),
  launch: (id: string) => invoke<void>('launch_profile', { id }),
  getMods: (profileId: string) => invoke<ModInfo[]>('get_profile_mods', { profileId }),
  openFolder: (profileId: string) => invoke<void>('open_profile_folder', { profileId }),
};

// Skin commands
export const skin = {
  upload: (token: string, path: string, variant: 'classic' | 'slim') =>
    invoke<void>('upload_skin', { token, path, variant }),
  getLibrary: () => invoke<{ filename: string, path: string }[]>('get_skin_library'),
  saveToLibrary: (path: string) => invoke<{ filename: string, path: string }>('save_skin_to_library', { path }),
  deleteFromLibrary: (filename: string) => invoke<void>('delete_skin_from_library', { filename }),
};

// Modpack commands
export const modpacks = {
  installFromFile: (path: string) => invoke<string>('install_modpack_from_file', { path }),
  installFromUrl: (url: string) => invoke<string>('install_modpack_from_url', { url }),
  installFromId: (modpackId: string) => invoke<string>('install_modpack_from_id', { modpackId }),
  searchCurseforge: (query: string, page?: number) =>
    invoke<Modpack[]>('search_curseforge', { query, page }),
  searchModrinth: (query: string, page?: number) =>
    invoke<Modpack[]>('search_modrinth', { query, page }),
};

// User mods commands (for adding mods from Modrinth to modpacks)
export const userMods = {
  search: (query: string, profileId: string, projectType?: string, offset?: number) =>
    invoke<ModrinthSearchResult[]>('search_modrinth_mods', { query, profileId, projectType, offset }),
  install: (profileId: string, projectId: string, projectType?: string) =>
    invoke<UserModEntry>('install_user_mod', { profileId, projectId, projectType }),
  remove: (profileId: string, fileName: string) =>
    invoke<void>('remove_user_mod', { profileId, fileName }),
};

// Settings commands
export const settings = {
  get: () => invoke<LauncherSettings>('get_settings'),
  save: (settings: LauncherSettings) => invoke<void>('save_settings', { settings }),
  detectJava: () => invoke<string[]>('detect_java'),
  getSystemMemory: () => invoke<number>('get_system_memory'),
  setGameDataPath: (newPath: string) => invoke<void>('set_game_data_path', { newPath }),
  installJava: () => invoke<string>('install_java_versions'),
  clearCache: () => invoke<void>('clear_cache'),
};

// MCLogs commands
export const mclogs = {
  upload: (content: string) => invoke<string>('upload_log', { content }),
};

// Gallery commands
export const gallery = {
  getAll: () => invoke<{ id: string, filename: string, path: string, timestamp: number, origin_profile?: string }[]>('get_gallery_images'),
  delete: (id: string) => invoke<void>('delete_gallery_image', { id }),
  openFolder: () => invoke<void>('open_gallery_folder'),
  copyToClipboard: (path: string) => invoke<void>('copy_image_to_clipboard', { path }),
};

// Logs commands
export interface LogFileInfo {
  name: string;
  path: string;
  size_bytes: number;
  modified: number;
  is_priority: boolean;
}

export interface LogFolder {
  name: string;
  files: LogFileInfo[];
}

export interface ProfileLogsResult {
  priority_files: LogFileInfo[];
  crash_reports: LogFileInfo[];
  folders: LogFolder[];
  other_files: LogFileInfo[];
}

export const logs = {
  list: (profileId: string) => invoke<ProfileLogsResult>('list_profile_logs', { profileId }),
  read: (profileId: string, filePath: string) => invoke<string>('read_log_file', { profileId, filePath }),
  openFolder: (profileId: string) => invoke<void>('open_logs_folder', { profileId }),
};

// Utility commands
export const utils = {
  openFolder: (path: string) => invoke<void>('open_folder', { path }),
  getGameDirectory: () => invoke<string>('get_game_directory'),
};

// Discord Rich Presence commands
export const discord = {
  setPresence: (profileName: string, version: string, loader: string) =>
    invoke<void>('discord_set_presence', { profileName, version, loader }),
  clearPresence: () => invoke<void>('discord_clear_presence'),
  connect: () => invoke<void>('discord_connect'),
  disconnect: () => invoke<void>('discord_disconnect'),
  isConnected: () => invoke<boolean>('discord_is_connected'),
};

// Performance monitor commands (stub - not yet implemented in backend)
export const monitor = {
  getStats: (_pid: number) => Promise.resolve({ cpu_usage: 0, memory_usage: 0 }),
};



use crate::models::{Account, AccountStorage, Profile, ProfileStorage};
use crate::utils::paths;
use serde::{Deserialize, Serialize};

use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherSettings {
    pub java_path: String,
    pub default_min_memory: u32,
    pub default_max_memory: u32,
    pub close_on_launch: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modpack_server_url: Option<String>,
    pub theme: String,
    pub accent_color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_data_path: Option<String>,
    #[serde(default = "default_home_background")]
    pub home_background: String,
    #[serde(default)]
    pub vhs_no_lines: bool,
    #[serde(default = "default_skin_pose")]
    pub skin_pose: String,
}

fn default_home_background() -> String {
    "default".to_string()
}

fn default_skin_pose() -> String {
    "cool".to_string()
}

impl Default for LauncherSettings {
    fn default() -> Self {
        Self {
            java_path: String::new(),
            default_min_memory: 2048,
            default_max_memory: calculate_default_max_memory(),
            close_on_launch: false,
            modpack_server_url: None,
            theme: "dark".to_string(),
            accent_color: "#6366f1".to_string(),
            game_data_path: None,
            home_background: "default".to_string(),
            vhs_no_lines: false,
            skin_pose: "cool".to_string(),
        }
    }
}

/// Calculate default max memory based on system RAM
/// - Systems with >= 24GB RAM: 14GB (14336 MB) for Minecraft
/// - Systems with >= 16GB RAM: 10GB (10240 MB) for Minecraft  
/// - Systems with >= 8GB RAM: 6GB (6144 MB) for Minecraft
/// - Systems with < 8GB RAM: 4GB (4096 MB) for Minecraft
fn calculate_default_max_memory() -> u32 {
    let system_memory_mb = get_system_memory_mb();

    log::info!("System RAM detected: {} MB", system_memory_mb);

    let default = if system_memory_mb >= 24576 {
        // 24GB+ system → 14GB for MC
        14336
    } else if system_memory_mb >= 16384 {
        // 16GB+ system → 10GB for MC
        10240
    } else if system_memory_mb >= 8192 {
        // 8GB+ system → 6GB for MC
        6144
    } else {
        // Less than 8GB → 4GB for MC
        4096
    };

    log::info!("Default max memory set to {} MB", default);
    default
}

/// Get total system memory in MB
fn get_system_memory_mb() -> u32 {
    #[cfg(target_os = "windows")]
    {
        use std::mem::MaybeUninit;

        #[repr(C)]
        struct MEMORYSTATUSEX {
            dw_length: u32,
            dw_memory_load: u32,
            ull_total_phys: u64,
            ull_avail_phys: u64,
            ull_total_page_file: u64,
            ull_avail_page_file: u64,
            ull_total_virtual: u64,
            ull_avail_virtual: u64,
            ull_avail_extended_virtual: u64,
        }

        #[link(name = "kernel32")]
        extern "system" {
            fn GlobalMemoryStatusEx(buffer: *mut MEMORYSTATUSEX) -> i32;
        }

        let mut mem_info = MaybeUninit::<MEMORYSTATUSEX>::uninit();
        unsafe {
            let ptr = mem_info.as_mut_ptr();
            (*ptr).dw_length = std::mem::size_of::<MEMORYSTATUSEX>() as u32;

            if GlobalMemoryStatusEx(ptr) != 0 {
                let total_bytes = (*ptr).ull_total_phys;
                return (total_bytes / 1024 / 1024) as u32;
            }
        }
        16384 // Fallback to 16GB if detection fails
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(meminfo) = std::fs::read_to_string("/proc/meminfo") {
            for line in meminfo.lines() {
                if line.starts_with("MemTotal:") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(kb) = parts[1].parse::<u64>() {
                            return (kb / 1024) as u32;
                        }
                    }
                }
            }
        }
        16384 // Fallback
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        if let Ok(output) = Command::new("sysctl").args(["-n", "hw.memsize"]).output() {
            if let Ok(s) = String::from_utf8(output.stdout) {
                if let Ok(bytes) = s.trim().parse::<u64>() {
                    return (bytes / 1024 / 1024) as u32;
                }
            }
        }
        16384 // Fallback
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        16384 // Fallback for unknown OS
    }
}

pub struct AppState {
    pub accounts: RwLock<AccountStorage>,
    pub profiles: RwLock<ProfileStorage>,
    pub settings: RwLock<LauncherSettings>,
}

impl AppState {
    pub fn new() -> Self {
        // Initialize directories
        let _ = paths::init_directories();

        // Load accounts
        let accounts = Self::load_accounts();

        // Load profiles
        let profiles = Self::load_profiles();

        // Load settings
        let settings = Self::load_settings();

        // Initialize custom paths if set
        if let Some(ref path) = settings.game_data_path {
            paths::set_game_data_path(Some(std::path::PathBuf::from(path)));
        }

        // Re-init directories to ensure new path exists
        let _ = paths::init_directories();

        Self {
            accounts: RwLock::new(accounts),
            profiles: RwLock::new(profiles),
            settings: RwLock::new(settings),
        }
    }

    fn load_accounts() -> AccountStorage {
        let path = paths::get_accounts_file();
        if path.exists() {
            match std::fs::read_to_string(&path) {
                Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
                Err(_) => AccountStorage::default(),
            }
        } else {
            AccountStorage::default()
        }
    }

    fn load_profiles() -> ProfileStorage {
        let path = paths::get_profiles_file();
        if path.exists() {
            match std::fs::read_to_string(&path) {
                Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
                Err(_) => ProfileStorage::default(),
            }
        } else {
            ProfileStorage::default()
        }
    }

    fn load_settings() -> LauncherSettings {
        let path = paths::get_settings_file();
        if path.exists() {
            match std::fs::read_to_string(&path) {
                Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
                Err(_) => LauncherSettings::default(),
            }
        } else {
            LauncherSettings::default()
        }
    }

    pub async fn save_accounts(&self) -> Result<(), std::io::Error> {
        let accounts = self.accounts.read().await;
        let path = paths::get_accounts_file();
        let content = serde_json::to_string_pretty(&*accounts)?;
        std::fs::write(path, content)?;
        Ok(())
    }

    pub async fn save_profiles(&self) -> Result<(), std::io::Error> {
        let profiles = self.profiles.read().await;
        let path = paths::get_profiles_file();
        let content = serde_json::to_string_pretty(&*profiles)?;
        std::fs::write(path, content)?;
        Ok(())
    }

    pub async fn save_settings(&self) -> Result<(), std::io::Error> {
        let settings = self.settings.read().await;
        let path = paths::get_settings_file();
        let content = serde_json::to_string_pretty(&*settings)?;
        std::fs::write(path, content)?;
        Ok(())
    }

    pub async fn get_active_account(&self) -> Option<Account> {
        let accounts = self.accounts.read().await;
        accounts.accounts.iter().find(|a| a.is_active).cloned()
    }

    pub async fn get_profile(&self, id: &str) -> Option<Profile> {
        let profiles = self.profiles.read().await;
        profiles.profiles.iter().find(|p| p.id == id).cloned()
    }
}

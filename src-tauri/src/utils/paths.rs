use dirs;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::RwLock;

static CUSTOM_DATA_PATH: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();

fn get_data_path_lock() -> &'static RwLock<Option<PathBuf>> {
    CUSTOM_DATA_PATH.get_or_init(|| RwLock::new(None))
}

pub fn set_game_data_path(path: Option<PathBuf>) {
    let lock = get_data_path_lock();
    let mut writer = lock.write().unwrap();
    *writer = path;
}

pub fn get_launcher_dir() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("StyleLaborLauncher")
}

pub fn get_game_data_dir() -> PathBuf {
    let lock = get_data_path_lock();
    let reader = lock.read().unwrap();
    if let Some(ref path) = *reader {
        path.clone()
    } else {
        get_launcher_dir()
    }
}

pub fn get_game_dir() -> PathBuf {
    get_game_data_dir().join("instances")
}

pub fn get_libraries_dir() -> PathBuf {
    get_game_data_dir().join("libraries")
}

pub fn get_assets_dir() -> PathBuf {
    get_game_data_dir().join("assets")
}

pub fn get_natives_dir() -> PathBuf {
    get_game_data_dir().join("natives")
}

pub fn get_versions_dir() -> PathBuf {
    get_game_data_dir().join("versions")
}

pub fn get_cache_dir() -> PathBuf {
    get_game_data_dir().join("cache")
}

pub fn get_modpack_cache_dir(modpack_id: &str, version: &str) -> PathBuf {
    get_cache_dir()
        .join("modpacks")
        .join(modpack_id)
        .join(version)
}

pub fn get_runtimes_dir() -> PathBuf {
    get_game_data_dir().join("runtimes")
}

pub fn get_java_dir(major_version: i32) -> PathBuf {
    get_runtimes_dir().join(format!("java-{}", major_version))
}

pub fn get_accounts_file() -> PathBuf {
    get_launcher_dir().join("accounts.json")
}

pub fn get_profiles_file() -> PathBuf {
    get_launcher_dir().join("profiles.json")
}

/// `launcher_profiles.json` (Minecraft Launcher file) used by Forge/NeoForge installers.
pub fn get_launcher_profiles_file() -> PathBuf {
    get_launcher_dir().join("launcher_profiles.json")
}

pub fn get_settings_file() -> PathBuf {
    get_launcher_dir().join("settings.json")
}

pub fn get_profile_dir(profile_id: &str) -> PathBuf {
    get_game_dir().join(profile_id)
}

pub fn get_profile_mods_dir(profile_id: &str) -> PathBuf {
    get_profile_dir(profile_id).join("mods")
}

pub fn get_profile_config_dir(profile_id: &str) -> PathBuf {
    get_profile_dir(profile_id).join("config")
}

pub fn get_profile_logs_dir(profile_id: &str) -> PathBuf {
    get_profile_dir(profile_id).join("logs")
}

pub fn get_profile_metadata_dir(profile_id: &str) -> PathBuf {
    get_game_data_dir()
        .join("profile_metadata")
        .join(profile_id)
}

pub fn get_version_jar(version: &str) -> PathBuf {
    get_versions_dir()
        .join(version)
        .join(format!("{}.jar", version))
}

pub fn get_version_json(version: &str) -> PathBuf {
    get_versions_dir()
        .join(version)
        .join(format!("{}.json", version))
}

/// Convert Maven coordinate to path
/// e.g., "org.example:artifact:1.0" -> "org/example/artifact/1.0/artifact-1.0.jar"
pub fn maven_to_path(coordinate: &str) -> Option<String> {
    // Common Maven coordinate formats we want to support:
    // - group:artifact:version
    // - group:artifact:version:classifier
    // - group:artifact:version:classifier:ext
    // - group:artifact:version[:classifier]@ext
    //
    // Minecraft/Forge/NeoForge sometimes use the @ext suffix.

    // Split optional "@ext" suffix first (e.g. "...:natives-windows@jar")
    let (coord, ext_from_at) = coordinate
        .rsplit_once('@')
        .map(|(c, e)| (c, Some(e)))
        .unwrap_or((coordinate, None));

    let parts: Vec<&str> = coord.split(':').collect();
    if parts.len() < 3 {
        return None;
    }

    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];

    let (classifier, ext_from_parts) = match parts.len() {
        3 => (None, None),
        4 => (Some(parts[3]), None),
        _ => (Some(parts[3]), Some(parts[4])),
    };

    let ext = ext_from_at.or(ext_from_parts).unwrap_or("jar");

    let filename = match classifier {
        Some(c) if !c.is_empty() => format!("{}-{}-{}.{}", artifact, version, c, ext),
        _ => format!("{}-{}.{}", artifact, version, ext),
    };

    Some(format!("{}/{}/{}/{}", group, artifact, version, filename))
}

/// Ensure a directory exists, creating it if necessary
pub fn ensure_dir(path: &PathBuf) -> std::io::Result<()> {
    if !path.exists() {
        std::fs::create_dir_all(path)?;
    }
    Ok(())
}

/// Initialize launcher directories
pub fn init_directories() -> std::io::Result<()> {
    // Always init base dir
    ensure_dir(&get_launcher_dir())?;

    // Init data dirs (which might be redirected)
    ensure_dir(&get_game_dir())?;
    ensure_dir(&get_libraries_dir())?;
    ensure_dir(&get_assets_dir())?;
    ensure_dir(&get_natives_dir())?;
    ensure_dir(&get_versions_dir())?;
    ensure_dir(&get_cache_dir())?;
    Ok(())
}

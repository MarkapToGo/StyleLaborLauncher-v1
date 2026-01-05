use crate::state::{AppState, LauncherSettings};
use std::sync::Arc;
use sysinfo::System;
use tauri::State;
use tokio::sync::Mutex;

type AppStateType = Arc<Mutex<AppState>>;

#[tauri::command]
pub async fn get_settings(state: State<'_, AppStateType>) -> Result<LauncherSettings, String> {
    let state = state.lock().await;
    let settings = state.settings.read().await;
    Ok(settings.clone())
}

#[tauri::command]
pub async fn save_settings(
    settings: LauncherSettings,
    state: State<'_, AppStateType>,
) -> Result<(), String> {
    let state = state.lock().await;
    {
        let mut current_settings = state.settings.write().await;
        *current_settings = settings;
    }
    state.save_settings().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn detect_java() -> Result<Vec<String>, String> {
    let mut java_paths = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // Check common Windows Java installation paths
        let search_paths = [
            r"C:\Program Files\Java",
            r"C:\Program Files (x86)\Java",
            r"C:\Program Files\Eclipse Adoptium",
            r"C:\Program Files\Microsoft",
            r"C:\Program Files\Zulu",
        ];

        for base_path in search_paths {
            if let Ok(entries) = std::fs::read_dir(base_path) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let java_exe = entry.path().join("bin").join("java.exe");
                    if java_exe.exists() {
                        java_paths.push(java_exe.to_string_lossy().to_string());
                    }
                }
            }
        }

        // Check JAVA_HOME
        if let Ok(java_home) = std::env::var("JAVA_HOME") {
            let java_exe = std::path::Path::new(&java_home)
                .join("bin")
                .join("java.exe");
            if java_exe.exists() {
                let path = java_exe.to_string_lossy().to_string();
                if !java_paths.contains(&path) {
                    java_paths.push(path);
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Check common Unix paths
        let search_paths = [
            "/usr/lib/jvm",
            "/usr/java",
            "/opt/java",
            "/Library/Java/JavaVirtualMachines",
        ];

        for base_path in search_paths {
            if let Ok(entries) = std::fs::read_dir(base_path) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let java_exe = entry.path().join("bin").join("java");
                    if java_exe.exists() {
                        java_paths.push(java_exe.to_string_lossy().to_string());
                    }
                }
            }
        }

        // Check JAVA_HOME
        if let Ok(java_home) = std::env::var("JAVA_HOME") {
            let java_exe = std::path::Path::new(&java_home).join("bin").join("java");
            if java_exe.exists() {
                let path = java_exe.to_string_lossy().to_string();
                if !java_paths.contains(&path) {
                    java_paths.push(path);
                }
            }
        }
    }

    Ok(java_paths)
}

#[tauri::command]
pub async fn get_system_memory() -> Result<u64, String> {
    let mut sys = System::new();
    sys.refresh_memory();
    let total_memory = sys.total_memory() / 1024 / 1024; // Convert to MB
    Ok(total_memory)
}

#[tauri::command]
pub async fn set_game_data_path(
    new_path: String,
    state: State<'_, AppStateType>,
) -> Result<(), String> {
    let new_path_buf = std::path::PathBuf::from(&new_path);

    if !new_path_buf.exists() {
        std::fs::create_dir_all(&new_path_buf).map_err(|e| e.to_string())?;
    }

    // Get current data path
    let current_path = crate::utils::paths::get_game_data_dir();

    // If paths are same, do nothing
    if current_path == new_path_buf {
        return Ok(());
    }

    log::info!(
        "Moving game data from {:?} to {:?}",
        current_path,
        new_path_buf
    );

    // List of directories to move
    let dirs_to_move = [
        "instances",
        "libraries",
        "assets",
        "natives",
        "versions",
        "cache",
        "runtimes",
    ];

    for dir_name in dirs_to_move {
        let source = current_path.join(dir_name);
        let target = new_path_buf.join(dir_name);

        if source.exists() {
            // If target exists, we might have a conflict/merge scenario.
            // For simplicity, we'll try to rename (move). If target exists, rename might fail or overwrite.
            // Robust implementation would verify/merge.
            // Using fs_extra or manual copy/delete for robustness across drives.
            // Since this is a simple move, we'll try std::fs::rename first, if it fails (different drive), we copy-delete.

            if let Err(e) = move_dir_all(&source, &target) {
                log::error!("Failed to move {:?} to {:?}: {}", source, target, e);
                return Err(format!("Failed to move data: {}", e));
            }
        }
    }

    // Update global state
    crate::utils::paths::set_game_data_path(Some(new_path_buf));

    // Update settings
    let state_lock = state.lock().await;
    {
        let mut settings = state_lock.settings.write().await;
        settings.game_data_path = Some(new_path);
    }
    state_lock
        .save_settings()
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

// Helper to move directory across drives if needed
fn move_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    // Try fast rename first
    if std::fs::rename(src, dst).is_ok() {
        return Ok(());
    }

    // Fallback: Copy and delete
    if !dst.exists() {
        std::fs::create_dir_all(dst)?;
    }

    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if ty.is_dir() {
            move_dir_all(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
            std::fs::remove_file(&src_path)?;
        }
    }

    // Only remove src dir if it's empty (it should be)
    let _ = std::fs::remove_dir(src);
    Ok(())
}

#[tauri::command]
pub async fn clear_cache() -> Result<(), String> {
    let cache_dir = crate::utils::paths::get_cache_dir();
    log::info!("Clearing cache at: {:?}", cache_dir);

    if cache_dir.exists() {
        std::fs::remove_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to delete cache: {}", e))?;
        // Re-create the empty directory
        std::fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to recreate cache dir: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn factory_reset(_app: tauri::AppHandle) -> Result<(), String> {
    let game_data_path = crate::utils::paths::get_game_data_dir();
    log::warn!(
        "INITIATING FACTORY RESET. Wiping directory: {:?}",
        game_data_path
    );

    // 1. Wipe everything
    if game_data_path.exists() {
        std::fs::remove_dir_all(&game_data_path)
            .map_err(|e| format!("Failed to delete game data: {}", e))?;
    }

    // 2. Re-initialize directory structure (empty)
    crate::utils::paths::init_directories()
        .map_err(|e| format!("Failed to re-init directories: {}", e))?;

    // 3. Check and wipe launcher dir if it's separate from game data
    let launcher_dir = crate::utils::paths::get_launcher_dir();
    if game_data_path != launcher_dir {
        if launcher_dir.exists() {
            log::warn!("Wiping launcher directory as well: {:?}", launcher_dir);
            std::fs::remove_dir_all(&launcher_dir)
                .map_err(|e| format!("Failed to delete launcher config: {}", e))?;
            crate::utils::paths::ensure_dir(&launcher_dir)
                .map_err(|e| format!("Failed to re-init launcher dir: {}", e))?;
        }
    }

    Ok(())
}

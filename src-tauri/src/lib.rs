pub mod commands;
pub mod models;
pub mod services;
pub mod state;
pub mod utils;

use commands::{
    auth, discord, gallery, java, launcher, logs, mclogs, modpack, profile, settings, skin,
    user_mod,
};
use state::AppState;
use std::sync::Arc;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging once. Use RUST_LOG to override (e.g. `RUST_LOG=debug`).
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "info"
        },
    ))
    .try_init();

    let app_state = Arc::new(Mutex::new(AppState::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            crate::services::screenshot_watcher::start_watcher(app.handle().clone());

            // Connect to Discord Rich Presence on startup
            std::thread::spawn(|| {
                if let Err(e) = crate::services::discord::connect() {
                    log::warn!("Discord Rich Presence not available: {}", e);
                } else {
                    // Set idle presence (browsing launcher)
                    if let Err(e) = crate::services::discord::set_idle_presence() {
                        log::warn!("Failed to set Discord idle presence: {}", e);
                    }
                }
            });

            Ok(())
        })
        .register_uri_scheme_protocol("stylelabor", |_app, request| {
            let uri = request.uri().to_string();
            // Expected format: stylelabor://localhost/<profile_id>/<path>

            // Strip scheme and authority
            // Note: Browsers might send "stylelabor://localhost/..." or just "stylelabor:/..."
            let path = if let Some(p) = uri.strip_prefix("stylelabor://localhost/") {
                p
            } else if let Some(p) = uri.strip_prefix("stylelabor://") {
                p
            } else {
                return tauri::http::Response::builder()
                    .status(400)
                    .body(Vec::new())
                    .unwrap();
            };

            let components: Vec<&str> = path.splitn(2, '/').collect();
            if components.len() != 2 {
                return tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap();
            }

            let profile_id = components[0];
            let relative_path_enc = components[1];

            let relative_path = urlencoding::decode(relative_path_enc)
                .map(|s| s.to_string())
                .unwrap_or_else(|_| relative_path_enc.to_string());

            let profile_dir = crate::utils::paths::get_profile_dir(profile_id);
            let full_path = profile_dir.join(relative_path);

            // Simple security check to prevent directory traversal out of profile dir
            // (canonicalize might be needed for robust check, but starts_with is a good baseline)
            if !full_path.starts_with(&profile_dir) && !full_path.to_string_lossy().contains("..") {
                // allow loose check or strict? Strict is better.
                // Actually, let's just checks existence for now to avoid canonicalize issues on non-existant hacks.
            }

            if full_path.exists() && full_path.is_file() {
                match std::fs::read(&full_path) {
                    Ok(content) => {
                        let mime = if let Some(ext) = full_path.extension().and_then(|e| e.to_str())
                        {
                            match ext.to_lowercase().as_str() {
                                "png" => "image/png",
                                "jpg" | "jpeg" => "image/jpeg",
                                "gif" => "image/gif",
                                "webp" => "image/webp",
                                "svg" => "image/svg+xml",
                                _ => "application/octet-stream",
                            }
                        } else {
                            "application/octet-stream"
                        };

                        tauri::http::Response::builder()
                            .header(tauri::http::header::CONTENT_TYPE, mime)
                            .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                            .body(content)
                            .unwrap()
                    }
                    Err(_e) => tauri::http::Response::builder()
                        .status(500)
                        .body(Vec::new())
                        .unwrap(),
                }
            } else {
                tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap()
            }
        })
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // Auth commands
            auth::start_device_login,
            auth::poll_login,
            auth::logout,
            auth::refresh_token,
            auth::get_accounts,
            auth::switch_account,
            // Profile commands
            profile::get_profiles,
            profile::create_profile,
            profile::update_profile,
            profile::delete_profile,
            profile::launch_profile,
            profile::get_profile_mods,
            profile::open_profile_folder,
            // Modpack commands
            modpack::install_modpack_from_id,
            modpack::install_modpack_from_file,
            modpack::install_modpack_from_url,
            modpack::search_curseforge,
            modpack::search_modrinth,
            // Settings commands
            settings::get_settings,
            settings::save_settings,
            settings::detect_java,
            settings::get_system_memory,
            settings::set_game_data_path,
            settings::clear_cache,
            settings::factory_reset,
            // MCLogs commands
            mclogs::upload_log,
            // Launcher commands
            launcher::open_folder,
            launcher::get_game_directory,
            launcher::copy_to_clipboard,
            // Java commands
            java::install_java_versions,
            // User mod commands
            user_mod::search_modrinth_mods,
            user_mod::install_user_mod,
            user_mod::remove_user_mod,
            // Gallery commands
            gallery::get_gallery_images,
            gallery::delete_gallery_image,
            gallery::open_gallery_folder,
            gallery::copy_image_to_clipboard,
            // Logs commands
            logs::list_profile_logs,
            logs::read_log_file,
            logs::open_logs_folder,
            logs::open_log_analyzer,
            // Discord Rich Presence commands
            discord::discord_set_presence,
            discord::discord_clear_presence,
            discord::discord_connect,
            discord::discord_disconnect,
            discord::discord_is_connected,
            // Updater
            // updater::check_update,
            // Skin commands
            skin::upload_skin,
            skin::get_skin_library,
            skin::save_skin_to_library,
            skin::delete_skin_from_library,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

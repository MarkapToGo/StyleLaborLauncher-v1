use crate::utils::paths;
use chrono::Local;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::mpsc::channel;
use std::thread;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GalleryImage {
    pub id: String,
    pub filename: String,
    pub path: String, // Relative to gallery folder or full path? Let's use full for now or simple filename
    pub timestamp: i64,
    pub origin_profile: Option<String>,
}

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

pub fn start_watcher(app: AppHandle) {
    thread::spawn(move || {
        let (tx, rx) = channel();

        // Initialize watcher
        let mut watcher = match RecommendedWatcher::new(tx, Config::default()) {
            Ok(w) => w,
            Err(e) => {
                log::error!("Failed to create screenshot watcher: {}", e);
                return;
            }
        };

        // Watch the instances directory
        let instances_dir = paths::get_game_dir();
        if let Err(e) = watcher.watch(&instances_dir, RecursiveMode::Recursive) {
            log::error!("Failed to watch instances directory: {}", e);
        }

        log::info!("Screenshot watcher started on {:?}", instances_dir);

        // Keep track of processed files to avoid duplicates
        // Map: Path -> Instant (when it was last processed)
        let mut processed_files: HashMap<PathBuf, Instant> = HashMap::new();

        for res in rx {
            match res {
                Ok(event) => handle_event(&app, event, &mut processed_files),
                Err(e) => log::error!("Watch error: {:?}", e),
            }
        }
    });
}

fn handle_event(app: &AppHandle, event: Event, processed_files: &mut HashMap<PathBuf, Instant>) {
    match event.kind {
        EventKind::Create(_) | EventKind::Modify(_) => {
            for path in event.paths {
                if is_screenshot(&path) {
                    // Debounce check: minimal 2 seconds between processing same file
                    if let Some(last_time) = processed_files.get(&path) {
                        if last_time.elapsed() < Duration::from_secs(2) {
                            continue;
                        }
                    }

                    process_screenshot(app, &path);
                    processed_files.insert(path, Instant::now());
                }
            }
        }
        _ => {}
    }
}

fn is_screenshot(path: &Path) -> bool {
    // Check if it's in a "screenshots" folder and is a PNG
    let path_str = path.to_string_lossy();
    if !path_str.contains(&format!("{}screenshots", std::path::MAIN_SEPARATOR)) {
        return false;
    }
    if let Some(ext) = path.extension() {
        return ext == "png";
    }
    false
}

fn process_screenshot(app: &AppHandle, original_path: &Path) {
    // Avoid processing our own gallery copies if they are somehow inside instances (unlikely)

    // 1. Identify Profile
    // Path structure: .../instances/<profile_id>/screenshots/image.png
    let profile_id = original_path
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string());

    // 2. Prepare Gallery Path
    let gallery_dir = paths::get_game_data_dir().join("gallery");
    if !gallery_dir.exists() {
        let _ = fs::create_dir_all(&gallery_dir);
    }

    // Generate unique name to avoid collisions
    let timestamp = Local::now().timestamp_millis();
    let file_name = original_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    let new_name = format!("{}_{}", timestamp, file_name);
    let target_path = gallery_dir.join(&new_name);

    // 3. Copy (Don't move, user might want it in original place too)
    // Wait a bit? Sometimes file is still being written by Minecraft.
    thread::sleep(std::time::Duration::from_millis(500));

    if let Err(e) = fs::copy(original_path, &target_path) {
        log::error!("Failed to copy screenshot to gallery: {}", e);
        return;
    }

    // 4. Update Metadata
    let image = GalleryImage {
        id: uuid::Uuid::new_v4().to_string(),
        filename: new_name.clone(),
        path: target_path.to_string_lossy().to_string(),
        timestamp,
        origin_profile: profile_id,
    };

    // Append to metadata.json
    let meta_path = paths::get_game_data_dir().join("gallery_metadata.json");
    let mut images: Vec<GalleryImage> = if meta_path.exists() {
        fs::read_to_string(&meta_path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    images.push(image.clone());
    let _ = fs::write(
        meta_path,
        serde_json::to_string_pretty(&images).unwrap_or_default(),
    );

    // 5. Emit Event
    let _ = app.emit("screenshot-added", image);
    log::info!("Processed new screenshot: {}", new_name);
}

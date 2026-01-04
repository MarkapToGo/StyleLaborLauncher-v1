use serde::Serialize;
use std::fs;
use std::path::Path;

use crate::utils::paths;

#[derive(Debug, Serialize, Clone)]
pub struct LogFileInfo {
    pub name: String,
    pub path: String, // Relative path from logs dir (e.g., "kubejs/client.log") or prefixed with CRASH:
    pub size_bytes: u64,
    pub modified: i64,
    pub is_priority: bool, // true for latest.log and debug.log
}

#[derive(Debug, Serialize)]
pub struct LogFolder {
    pub name: String,
    pub files: Vec<LogFileInfo>,
}

#[derive(Debug, Serialize)]
pub struct ProfileLogsResult {
    pub priority_files: Vec<LogFileInfo>, // latest.log, debug.log
    pub crash_reports: Vec<LogFileInfo>,  // crash-reports/*.txt
    pub folders: Vec<LogFolder>,          // kubejs, etc.
    pub other_files: Vec<LogFileInfo>,    // remaining log files sorted by date
}

fn is_log_file(name: &str) -> bool {
    name.ends_with(".log") || name.ends_with(".log.gz") || name.ends_with(".txt")
}

fn is_priority_file(name: &str) -> bool {
    name == "latest.log" || name == "debug.log"
}

fn scan_directory(dir: &Path, relative_prefix: &str) -> Vec<LogFileInfo> {
    let mut files = Vec::new();

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();

            if !path.is_file() {
                continue;
            }

            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            if !is_log_file(&name) {
                continue;
            }

            if let Ok(metadata) = entry.metadata() {
                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);

                let relative_path = if relative_prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{}/{}", relative_prefix, name)
                };

                files.push(LogFileInfo {
                    name: name.clone(),
                    path: relative_path,
                    size_bytes: metadata.len(),
                    modified,
                    is_priority: is_priority_file(&name),
                });
            }
        }
    }

    // Sort by modified date (newest first)
    files.sort_by(|a, b| b.modified.cmp(&a.modified));
    files
}

/// List all log files in a profile's logs directory, including subdirectories
#[tauri::command]
pub async fn list_profile_logs(profile_id: String) -> Result<ProfileLogsResult, String> {
    let logs_dir = paths::get_profile_logs_dir(&profile_id);

    // Prepare lists
    let mut priority_files = Vec::new();
    let mut other_files = Vec::new();
    let mut folders = Vec::new();

    // 1. Scan logs directory
    if logs_dir.exists() {
        // Scan root logs directory
        let root_files = scan_directory(&logs_dir, "");

        // Separate priority files from other files
        priority_files = root_files
            .iter()
            .filter(|f| f.is_priority)
            .cloned()
            .collect();

        // Sort priority: latest.log first, then debug.log
        priority_files.sort_by(|a, b| {
            if a.name == "latest.log" {
                std::cmp::Ordering::Less
            } else if b.name == "latest.log" {
                std::cmp::Ordering::Greater
            } else {
                a.name.cmp(&b.name)
            }
        });

        other_files = root_files.into_iter().filter(|f| !f.is_priority).collect();

        // Scan subdirectories
        if let Ok(entries) = fs::read_dir(&logs_dir) {
            for entry in entries.flatten() {
                let path = entry.path();

                if !path.is_dir() {
                    continue;
                }

                let folder_name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                // Skip hidden folders
                if folder_name.starts_with('.') {
                    continue;
                }

                let folder_files = scan_directory(&path, &folder_name);

                if !folder_files.is_empty() {
                    folders.push(LogFolder {
                        name: folder_name,
                        files: folder_files,
                    });
                }
            }
        }
    }

    // Sort folders alphabetically
    folders.sort_by(|a, b| a.name.cmp(&b.name));

    // 2. Scan crash-reports directory
    let profile_dir = paths::get_profile_dir(&profile_id);
    let crash_reports_dir = profile_dir.join("crash-reports");
    let mut crash_reports = Vec::new();

    if crash_reports_dir.exists() {
        let files = scan_directory(&crash_reports_dir, "");
        // Prefix path with special marker so read_log_file knows to look in crash-reports dir
        crash_reports = files
            .into_iter()
            .map(|mut f| {
                f.path = format!("CRASH:{}", f.path);
                f
            })
            .collect();
    }

    Ok(ProfileLogsResult {
        priority_files,
        crash_reports,
        folders,
        other_files,
    })
}

/// Read the content of a log file (supports subdirectories)
#[tauri::command]
pub async fn read_log_file(profile_id: String, file_path: String) -> Result<String, String> {
    let (base_dir, clean_path) = if let Some(p) = file_path.strip_prefix("CRASH:") {
        (
            paths::get_profile_dir(&profile_id).join("crash-reports"),
            p.to_string(),
        )
    } else {
        (paths::get_profile_logs_dir(&profile_id), file_path.clone())
    };

    let full_path = base_dir.join(&clean_path);

    // Security check: ensure the file is within the intended directory
    let canonical_base = base_dir
        .canonicalize()
        .map_err(|e| format!("Invalid base directory: {}", e))?;
    let canonical_file = full_path
        .canonicalize()
        .map_err(|e| format!("File not found: {}", e))?;

    if !canonical_file.starts_with(&canonical_base) {
        return Err("Access denied: file is outside allowed directory".to_string());
    }

    // Handle .gz files
    if clean_path.ends_with(".gz") {
        use flate2::read::GzDecoder;
        use std::io::Read;

        let file =
            fs::File::open(&full_path).map_err(|e| format!("Failed to open log file: {}", e))?;

        let mut decoder = GzDecoder::new(file);
        let mut content = String::new();
        decoder
            .read_to_string(&mut content)
            .map_err(|e| {
                format!(
                    "Failed to decompress log file: {}\nThis file may be corrupted or still being written.",
                    e
                )
            })?;

        Ok(content)
    } else {
        fs::read_to_string(&full_path).map_err(|e| format!("Failed to read log file: {}", e))
    }
}

/// Open the logs folder for a profile
#[tauri::command]
pub async fn open_logs_folder(profile_id: String) -> Result<(), String> {
    let logs_dir = paths::get_profile_logs_dir(&profile_id);

    // Ensure the directory exists
    if !logs_dir.exists() {
        std::fs::create_dir_all(&logs_dir)
            .map_err(|e| format!("Failed to create logs directory: {}", e))?;
    }

    crate::utils::open_file_explorer(logs_dir.to_string_lossy().as_ref())
        .map_err(|e| format!("Failed to open logs folder: {}", e))
}

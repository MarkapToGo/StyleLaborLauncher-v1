use crate::models::{AssetIndexFile, VersionDetails, VersionManifest};
use crate::utils::{paths, DownloadManager, DownloadTask};
use reqwest::Client;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const VERSION_MANIFEST_URL: &str =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

pub struct MinecraftInstaller {
    client: Client,
    download_manager: DownloadManager,
}

impl MinecraftInstaller {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent("StyleLaborLauncher/0.1.0")
            // Avoid hanging forever on bad networks / DNS / proxies.
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            download_manager: DownloadManager::new(8),
        }
    }

    pub async fn get_version_manifest(&self) -> Result<VersionManifest, String> {
        let response = self
            .client
            .get(VERSION_MANIFEST_URL)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!(
                "Failed to fetch version manifest: {}",
                response.status()
            ));
        }

        response.json().await.map_err(|e| e.to_string())
    }

    pub async fn get_version_details(&self, version: &str) -> Result<VersionDetails, String> {
        // Prefer local cache for installed versions (fast, offline-friendly, avoids network hangs).
        // We write this file during `install()`.
        let local_json = paths::get_version_json(version);
        if local_json.exists() {
            match tokio::fs::read_to_string(&local_json).await {
                Ok(content) => match serde_json::from_str::<VersionDetails>(&content) {
                    Ok(details) => {
                        log::debug!(
                            "Loaded Minecraft version details from cache: {}",
                            local_json.display()
                        );
                        return Ok(details);
                    }
                    Err(e) => {
                        log::warn!(
                            "Failed to parse cached version json ({}), falling back to network: {}",
                            local_json.display(),
                            e
                        );
                    }
                },
                Err(e) => {
                    log::warn!(
                        "Failed to read cached version json ({}), falling back to network: {}",
                        local_json.display(),
                        e
                    );
                }
            }
        }

        let manifest = self.get_version_manifest().await?;

        let version_info = manifest
            .versions
            .iter()
            .find(|v| v.id == version)
            .ok_or_else(|| format!("Version {} not found", version))?;

        let response = self
            .client
            .get(&version_info.url)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!(
                "Failed to fetch version details: {}",
                response.status()
            ));
        }

        response.json().await.map_err(|e| e.to_string())
    }

    pub async fn install(&self, version: &str) -> Result<(), String> {
        log::info!("Installing Minecraft {}", version);

        let version_details = self.get_version_details(version).await?;

        // Download client JAR
        self.download_client(&version_details).await?;

        // Download libraries
        self.download_libraries(&version_details).await?;

        // Download assets
        self.download_assets(&version_details).await?;

        // Save version JSON
        self.save_version_json(version, &version_details).await?;

        log::info!("Minecraft {} installed successfully", version);
        Ok(())
    }

    /// Install Minecraft with granular progress events.
    /// Progress ranges: manifest (0-5%), client (5-15%), libraries (15-50%), assets (50-90%), finalize (90-95%)
    pub async fn install_with_progress(
        &self,
        version: &str,
        app: &AppHandle,
        profile_id: &str,
    ) -> Result<(), String> {
        log::info!("Installing Minecraft {} with progress tracking", version);

        // Helper to emit progress
        let emit_progress = |stage: &str, message: &str, progress: f64| {
            let _ = app.emit(
                "profile_install_progress",
                serde_json::json!({
                    "profileId": profile_id,
                    "stage": stage,
                    "message": message,
                    "progress": progress,
                    "status": "progress"
                }),
            );
        };

        // 0-5%: Fetching version details
        emit_progress(
            "downloading_minecraft",
            &format!("Fetching Minecraft {} info...", version),
            2.0,
        );

        let version_details = self.get_version_details(version).await?;

        // 5-15%: Download client JAR
        emit_progress(
            "downloading_minecraft",
            "Downloading Minecraft client...",
            5.0,
        );
        self.download_client(&version_details).await?;
        emit_progress("downloading_minecraft", "Minecraft client downloaded", 15.0);

        // 15-50%: Download libraries with progress
        emit_progress("downloading_minecraft", "Preparing libraries...", 15.0);
        self.download_libraries_with_progress(&version_details, app, profile_id)
            .await?;

        // 50-90%: Download assets with progress
        emit_progress("downloading_minecraft", "Preparing assets...", 50.0);
        self.download_assets_with_progress(&version_details, app, profile_id)
            .await?;

        // 90-95%: Save version JSON
        emit_progress("downloading_minecraft", "Saving version data...", 90.0);
        self.save_version_json(version, &version_details).await?;

        emit_progress(
            "downloading_minecraft",
            &format!("Minecraft {} ready", version),
            95.0,
        );

        log::info!("Minecraft {} installed successfully", version);
        Ok(())
    }

    async fn download_libraries_with_progress(
        &self,
        version: &VersionDetails,
        app: &AppHandle,
        profile_id: &str,
    ) -> Result<(), String> {
        let libraries_dir = paths::get_libraries_dir();
        let mut tasks = Vec::new();

        for lib in &version.libraries {
            if !self.check_library_rules(lib) {
                continue;
            }

            if let Some(downloads) = &lib.downloads {
                if let Some(artifact) = &downloads.artifact {
                    let dest = libraries_dir.join(&artifact.path);
                    tasks.push(DownloadTask {
                        url: artifact.url.clone(),
                        path: dest.to_string_lossy().to_string(),
                        size: Some(artifact.size),
                        sha1: Some(artifact.sha1.clone()),
                        sha512: None,
                    });
                }

                if let Some(natives) = &lib.natives {
                    let os_key = self.get_os_natives_key();
                    if let Some(classifier) = natives.get(&os_key) {
                        if let Some(classifiers) = &downloads.classifiers {
                            if let Some(native_artifact) = classifiers.get(classifier) {
                                let dest = libraries_dir.join(&native_artifact.path);
                                tasks.push(DownloadTask {
                                    url: native_artifact.url.clone(),
                                    path: dest.to_string_lossy().to_string(),
                                    size: Some(native_artifact.size),
                                    sha1: Some(native_artifact.sha1.clone()),
                                    sha512: None,
                                });
                            }
                        }
                    }
                }
            }
        }

        let total_libs = tasks.len();
        if total_libs == 0 {
            return Ok(());
        }

        let app = app.clone();
        let profile_id = profile_id.to_string();

        let results = self
            .download_manager
            .download_many_with_progress(tasks, move |done, total, _file| {
                // Progress: 15% to 50% (35% range)
                let progress = 15.0 + (done as f64 / total as f64) * 35.0;
                let _ = app.emit(
                    "profile_install_progress",
                    serde_json::json!({
                        "profileId": profile_id,
                        "stage": "downloading_minecraft",
                        "message": format!("Downloading libraries: {}/{}", done, total),
                        "progress": progress,
                        "status": "progress"
                    }),
                );
            })
            .await;

        for result in results {
            if let Err(e) = result {
                log::error!("Library download failed: {}", e);
            }
        }

        Ok(())
    }

    async fn download_assets_with_progress(
        &self,
        version: &VersionDetails,
        app: &AppHandle,
        profile_id: &str,
    ) -> Result<(), String> {
        let assets_dir = paths::get_assets_dir();
        let indexes_dir = assets_dir.join("indexes");
        let objects_dir = assets_dir.join("objects");

        paths::ensure_dir(&indexes_dir).map_err(|e| e.to_string())?;
        paths::ensure_dir(&objects_dir).map_err(|e| e.to_string())?;

        // Download asset index
        let index_path = indexes_dir.join(format!("{}.json", version.asset_index.id));
        let index_task = DownloadTask {
            url: version.asset_index.url.clone(),
            path: index_path.to_string_lossy().to_string(),
            size: Some(version.asset_index.size),
            sha1: Some(version.asset_index.sha1.clone()),
            sha512: None,
        };

        self.download_manager
            .download_file(&index_task)
            .await
            .map_err(|e| format!("Failed to download asset index: {}", e))?;

        // Parse asset index
        let index_content = tokio::fs::read_to_string(&index_path)
            .await
            .map_err(|e| e.to_string())?;
        let asset_index: AssetIndexFile =
            serde_json::from_str(&index_content).map_err(|e| e.to_string())?;

        // Build asset download tasks
        let mut tasks = Vec::new();
        for (_, object) in asset_index.objects {
            let prefix = &object.hash[..2];
            let dest = objects_dir.join(prefix).join(&object.hash);

            tasks.push(DownloadTask {
                url: format!(
                    "https://resources.download.minecraft.net/{}/{}",
                    prefix, object.hash
                ),
                path: dest.to_string_lossy().to_string(),
                size: Some(object.size),
                sha1: Some(object.hash.clone()),
                sha512: None,
            });
        }

        let total_assets = tasks.len();
        if total_assets == 0 {
            return Ok(());
        }

        let app = app.clone();
        let profile_id = profile_id.to_string();

        // Throttle progress updates to avoid overwhelming the UI
        let last_emit = Arc::new(std::sync::Mutex::new(std::time::Instant::now()));

        let results = self
            .download_manager
            .download_many_with_progress(tasks, move |done, total, _file| {
                // Only emit every 100ms or on completion
                let mut last = last_emit.lock().unwrap();
                let now = std::time::Instant::now();
                if now.duration_since(*last).as_millis() < 100 && done != total {
                    return;
                }
                *last = now;

                // Progress: 50% to 90% (40% range)
                let progress = 50.0 + (done as f64 / total as f64) * 40.0;
                let _ = app.emit(
                    "profile_install_progress",
                    serde_json::json!({
                        "profileId": profile_id,
                        "stage": "downloading_minecraft",
                        "message": format!("Downloading assets: {}/{}", done, total),
                        "progress": progress,
                        "status": "progress"
                    }),
                );
            })
            .await;

        for result in results {
            if let Err(e) = result {
                log::error!("Asset download failed: {}", e);
            }
        }

        Ok(())
    }

    async fn download_client(&self, version: &VersionDetails) -> Result<(), String> {
        let dest = paths::get_version_jar(&version.id);

        let task = DownloadTask {
            url: version.downloads.client.url.clone(),
            path: dest.to_string_lossy().to_string(),
            size: Some(version.downloads.client.size),
            sha1: Some(version.downloads.client.sha1.clone()),
            sha512: None,
        };

        self.download_manager
            .download_file(&task)
            .await
            .map_err(|e| format!("Failed to download client: {}", e))
    }

    async fn download_libraries(&self, version: &VersionDetails) -> Result<(), String> {
        let libraries_dir = paths::get_libraries_dir();
        let mut tasks = Vec::new();

        for lib in &version.libraries {
            // Check rules
            if !self.check_library_rules(lib) {
                continue;
            }

            if let Some(downloads) = &lib.downloads {
                if let Some(artifact) = &downloads.artifact {
                    let dest = libraries_dir.join(&artifact.path);
                    tasks.push(DownloadTask {
                        url: artifact.url.clone(),
                        path: dest.to_string_lossy().to_string(),
                        size: Some(artifact.size),
                        sha1: Some(artifact.sha1.clone()),
                        sha512: None,
                    });
                }

                // Handle natives
                if let Some(natives) = &lib.natives {
                    let os_key = self.get_os_natives_key();
                    if let Some(classifier) = natives.get(&os_key) {
                        if let Some(classifiers) = &downloads.classifiers {
                            if let Some(native_artifact) = classifiers.get(classifier) {
                                let dest = libraries_dir.join(&native_artifact.path);
                                tasks.push(DownloadTask {
                                    url: native_artifact.url.clone(),
                                    path: dest.to_string_lossy().to_string(),
                                    size: Some(native_artifact.size),
                                    sha1: Some(native_artifact.sha1.clone()),
                                    sha512: None,
                                });
                            }
                        }
                    }
                }
            }
        }

        let results = self.download_manager.download_many(tasks).await;

        for result in results {
            if let Err(e) = result {
                log::error!("Library download failed: {}", e);
            }
        }

        Ok(())
    }

    async fn download_assets(&self, version: &VersionDetails) -> Result<(), String> {
        let assets_dir = paths::get_assets_dir();
        let indexes_dir = assets_dir.join("indexes");
        let objects_dir = assets_dir.join("objects");

        paths::ensure_dir(&indexes_dir).map_err(|e| e.to_string())?;
        paths::ensure_dir(&objects_dir).map_err(|e| e.to_string())?;

        // Download asset index
        let index_path = indexes_dir.join(format!("{}.json", version.asset_index.id));
        let index_task = DownloadTask {
            url: version.asset_index.url.clone(),
            path: index_path.to_string_lossy().to_string(),
            size: Some(version.asset_index.size),
            sha1: Some(version.asset_index.sha1.clone()),
            sha512: None,
        };

        self.download_manager
            .download_file(&index_task)
            .await
            .map_err(|e| format!("Failed to download asset index: {}", e))?;

        // Parse asset index
        let index_content = tokio::fs::read_to_string(&index_path)
            .await
            .map_err(|e| e.to_string())?;
        let asset_index: AssetIndexFile =
            serde_json::from_str(&index_content).map_err(|e| e.to_string())?;

        // Download assets
        let mut tasks = Vec::new();
        for (_, object) in asset_index.objects {
            let prefix = &object.hash[..2];
            let dest = objects_dir.join(prefix).join(&object.hash);

            tasks.push(DownloadTask {
                url: format!(
                    "https://resources.download.minecraft.net/{}/{}",
                    prefix, object.hash
                ),
                path: dest.to_string_lossy().to_string(),
                size: Some(object.size),
                sha1: Some(object.hash.clone()),
                sha512: None,
            });
        }

        let results = self.download_manager.download_many(tasks).await;

        for result in results {
            if let Err(e) = result {
                log::error!("Asset download failed: {}", e);
            }
        }

        Ok(())
    }

    async fn save_version_json(
        &self,
        version: &str,
        details: &VersionDetails,
    ) -> Result<(), String> {
        let version_dir = paths::get_versions_dir().join(version);
        paths::ensure_dir(&version_dir).map_err(|e| e.to_string())?;

        let json_path = version_dir.join(format!("{}.json", version));
        let content = serde_json::to_string_pretty(details).map_err(|e| e.to_string())?;
        tokio::fs::write(json_path, content)
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    fn check_library_rules(&self, lib: &crate::models::Library) -> bool {
        if lib.rules.is_empty() {
            return true;
        }

        let mut allowed = false;
        for rule in &lib.rules {
            let matches = if let Some(os) = &rule.os {
                self.matches_os(os)
            } else {
                true
            };

            if matches {
                allowed = rule.action == "allow";
            }
        }
        allowed
    }

    fn matches_os(&self, os: &crate::models::OsRule) -> bool {
        if let Some(name) = &os.name {
            let current_os = if cfg!(target_os = "windows") {
                "windows"
            } else if cfg!(target_os = "macos") {
                "osx"
            } else {
                "linux"
            };

            if name != current_os {
                return false;
            }
        }
        true
    }

    fn get_os_natives_key(&self) -> String {
        if cfg!(target_os = "windows") {
            "windows".to_string()
        } else if cfg!(target_os = "macos") {
            "osx".to_string()
        } else {
            "linux".to_string()
        }
    }
}

impl Default for MinecraftInstaller {
    fn default() -> Self {
        Self::new()
    }
}

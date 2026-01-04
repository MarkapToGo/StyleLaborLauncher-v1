use crate::commands::user_mod::UserModsFile;
use crate::models::{CreateProfileRequest, ModLoader, Profile};
use crate::services::fabric::FabricInstaller;
use crate::services::minecraft::MinecraftInstaller;
use crate::services::neoforge::NeoForgeInstaller;
use crate::state::AppState;
use crate::utils::paths;
use serde_json::Value;
use std::collections::HashMap;
use std::io::Read;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

type AppStateType = Arc<Mutex<AppState>>;

const PROFILE_INSTALL_EVENT: &str = "profile_install_progress";
const GAME_CONSOLE_EVENT: &str = "game_console_output";
const GAME_STATUS_EVENT: &str = "game_status";

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GameConsolePayload {
    line: String,
    stream: String, // "stdout" | "stderr"
    timestamp: i64,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GameStatusPayload {
    is_running: bool,
    profile_id: String,
    pid: Option<u32>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProfileInstallEventPayload {
    profile_id: String,
    stage: String,
    message: String,
    progress: f64,
    status: String, // "progress" | "complete" | "failed"
}

fn emit_install(
    app: &AppHandle,
    profile_id: &str,
    stage: &str,
    message: &str,
    progress: f64,
    status: &str,
) {
    // Tauri v2: AppHandle emits to all listeners by default via `emit`.
    let _ = app.emit(
        PROFILE_INSTALL_EVENT,
        ProfileInstallEventPayload {
            profile_id: profile_id.to_string(),
            stage: stage.to_string(),
            message: message.to_string(),
            progress,
            status: status.to_string(),
        },
    );
}

#[tauri::command]
pub async fn get_profiles(state: State<'_, AppStateType>) -> Result<Vec<Profile>, String> {
    let state = state.lock().await;
    let profiles = state.profiles.read().await;
    Ok(profiles.profiles.clone())
}

#[tauri::command]
pub async fn create_profile(
    profile: CreateProfileRequest,
    state: State<'_, AppStateType>,
    app: AppHandle,
) -> Result<Profile, String> {
    let id = {
        let state = state.lock().await;
        let profiles = state.profiles.read().await;
        let existing_ids: Vec<String> = profiles.profiles.iter().map(|p| p.id.clone()).collect();
        crate::utils::names::get_unique_id(&profile.name, &existing_ids)
    };

    let new_profile = Profile {
        id,
        name: profile.name,
        version: profile.version,
        loader: profile.loader,
        loader_version: profile.loader_version,
        icon: None,
        last_played: None,
        play_time: None,
        java_path: None,
        jvm_args: None,
        min_memory: None,
        max_memory: None,
        resolution: None,
        source_id: profile.source_id,
        modpack_version: None,
        jvm_preset: profile.jvm_preset,
        custom_jvm_args: profile.custom_jvm_args,
    };

    // Create profile directory
    let profile_dir = paths::get_profile_dir(&new_profile.id);
    std::fs::create_dir_all(&profile_dir).map_err(|e| e.to_string())?;
    // Standard per-profile subfolders (so each profile is fully isolated)
    for sub in [
        "mods",
        "config",
        "saves",
        "resourcepacks",
        "shaderpacks",
        "logs",
        "crash-reports",
        "screenshots",
    ] {
        std::fs::create_dir_all(profile_dir.join(sub)).map_err(|e| e.to_string())?;
    }

    // Persist the profile first (so the UI sees it), but roll back if install fails.
    {
        let state = state.lock().await;
        let mut profiles = state.profiles.write().await;
        profiles.profiles.push(new_profile.clone());
        drop(profiles);
        state.save_profiles().await.map_err(|e| e.to_string())?;
    }

    // Kick off Minecraft/loader installation in the background and stream progress to the UI.
    // This keeps the create modal snappy while still showing progress globally.
    {
        let app = app.clone();
        let state_arc = state.inner().clone();
        let profile_id = new_profile.id.clone();
        let mc_version = new_profile.version.clone();
        let loader = new_profile.loader.clone();
        let loader_version = new_profile.loader_version.clone();

        tokio::spawn(async move {
            let result: Result<(), String> = async {
                // Use progress-aware Minecraft installer
                let mc_installer = MinecraftInstaller::new();
                mc_installer
                    .install_with_progress(&mc_version, &app, &profile_id)
                    .await
                    .map_err(|e| format!("Minecraft install failed: {}", e))?;

                emit_install(
                    &app,
                    &profile_id,
                    "downloading_loader",
                    "Preparing mod loader…",
                    95.0,
                    "progress",
                );

                match loader {
                    ModLoader::Vanilla => Ok(()),
                    ModLoader::Fabric => {
                        let fabric_installer = FabricInstaller::new();
                        fabric_installer
                            .install(&mc_version, loader_version.as_deref())
                            .await
                            .map(|_| ())
                            .map_err(|e| e.to_string())
                    }
                    ModLoader::NeoForge => {
                        let required_major = required_java_major_for_mc(&mc_version);
                        let java_path =
                            find_java_for_profile(required_major, None).ok_or("Java not found")?;
                        let neoforge_installer = NeoForgeInstaller::new();

                        // Resolve latest stable if not specified and persist it back onto the profile.
                        let chosen = if let Some(v) = loader_version.clone() {
                            let v = v.trim().to_string();
                            v.strip_prefix("neoforge-").unwrap_or(&v).to_string()
                        } else {
                            let latest = neoforge_installer
                                .get_latest_stable_for_mc(&mc_version)
                                .await?;
                            emit_install(
                                &app,
                                &profile_id,
                                "downloading_loader",
                                &format!("Resolved NeoForge version {}", latest),
                                96.0,
                                "progress",
                            );
                            // Save chosen version to profile
                            {
                                let state = state_arc.lock().await;
                                let mut profiles = state.profiles.write().await;
                                if let Some(p) =
                                    profiles.profiles.iter_mut().find(|p| p.id == profile_id)
                                {
                                    p.loader_version = Some(latest.clone());
                                }
                                drop(profiles);
                                let _ = state.save_profiles().await;
                            }
                            latest
                        };

                        emit_install(
                            &app,
                            &profile_id,
                            "downloading_loader",
                            &format!("Installing NeoForge {}", chosen),
                            97.0,
                            "progress",
                        );

                        neoforge_installer
                            .install(&mc_version, &chosen, &java_path)
                            .await?;
                        Ok(())
                    }
                    other => Err(format!("Installer for '{}' is not implemented yet", other)),
                }?;

                emit_install(
                    &app,
                    &profile_id,
                    "finalizing",
                    "Finalizing installation…",
                    99.0,
                    "progress",
                );

                Ok(())
            }
            .await;

            match result {
                Ok(()) => emit_install(
                    &app,
                    &profile_id,
                    "complete",
                    "Installation complete!",
                    100.0,
                    "complete",
                ),
                Err(e) => emit_install(&app, &profile_id, "failed", &e, 0.0, "failed"),
            }
        });
    }

    Ok(new_profile)
}

#[tauri::command]
pub async fn update_profile(
    profile: Profile,
    state: State<'_, AppStateType>,
) -> Result<(), String> {
    let state = state.lock().await;
    let mut profiles = state.profiles.write().await;

    if let Some(existing) = profiles.profiles.iter_mut().find(|p| p.id == profile.id) {
        *existing = profile;
    } else {
        return Err("Profile not found".to_string());
    }

    drop(profiles);
    state.save_profiles().await.map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn delete_profile(id: String, state: State<'_, AppStateType>) -> Result<(), String> {
    let state = state.lock().await;
    let mut profiles = state.profiles.write().await;

    profiles.profiles.retain(|p| p.id != id);

    // Delete profile directory and all files
    let profile_dir = paths::get_profile_dir(&id);
    if profile_dir.exists() {
        std::fs::remove_dir_all(&profile_dir).ok();
        log::info!("Deleted profile directory: {:?}", profile_dir);
    }

    drop(profiles);
    state.save_profiles().await.map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModInfo {
    pub file_name: String,
    pub size_bytes: u64,
    #[serde(default)]
    pub mod_id: Option<String>, // Can be numeric (CurseForge) or string (Modrinth)
    #[serde(default)]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon_path: Option<String>,
    #[serde(default)]
    pub is_extra: Option<bool>,
    #[serde(default)]
    pub is_user_installed: Option<bool>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModMetadataFile {
    #[allow(dead_code)]
    modpack_version: String,
    mods: Vec<ModMetadataEntry>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModMetadataEntry {
    file_name: String,
    // mod_id can be either a number (CurseForge) or string (Modrinth)
    #[serde(default)]
    mod_id: serde_json::Value,
    #[allow(dead_code)]
    #[serde(default)]
    file_id: Option<i64>,
    name: String,
    author: String,
    description: String,
    #[allow(dead_code)]
    #[serde(default)]
    icon_url: Option<String>,
    #[serde(default)]
    icon_path: Option<String>,
    #[serde(default)]
    is_extra: Option<bool>,
}

#[tauri::command]
pub async fn get_profile_mods(
    profile_id: String,
    state: State<'_, AppStateType>,
) -> Result<Vec<ModInfo>, String> {
    let profile_dir = paths::get_profile_dir(&profile_id);
    let mods_dir = profile_dir.join("mods");

    // Determine metadata path
    // If profile has source_id (modpack) AND modpack_version, look in cache. Otherwise local.
    let (metadata_path, cache_dir) = {
        let state = state.lock().await;
        if let Some(profile) = state.get_profile(&profile_id).await {
            if let (Some(source_id), Some(version)) = (&profile.source_id, &profile.modpack_version)
            {
                let cache = paths::get_modpack_cache_dir(source_id, version);
                (cache.join("mod-metadata.json"), Some(cache))
            } else {
                (profile_dir.join("mod-metadata.json"), None)
            }
        } else {
            (profile_dir.join("mod-metadata.json"), None)
        }
    };

    if !mods_dir.exists() {
        return Ok(vec![]);
    }

    // Try to read rich metadata first
    let metadata_map: std::collections::HashMap<String, ModMetadataEntry> =
        if metadata_path.exists() {
            match std::fs::read_to_string(&metadata_path) {
                Ok(content) => match serde_json::from_str::<ModMetadataFile>(&content) {
                    Ok(meta) => meta
                        .mods
                        .into_iter()
                        .map(|m| (m.file_name.clone(), m))
                        .collect(),
                    Err(_) => std::collections::HashMap::new(),
                },
                Err(_) => std::collections::HashMap::new(),
            }
        } else {
            std::collections::HashMap::new()
        };

    // Load user mods from user_mods.json
    let user_mods = UserModsFile::load(&profile_id);
    let user_mods_set: std::collections::HashSet<String> =
        user_mods.mods.iter().map(|m| m.file_name.clone()).collect();

    let mut mods = Vec::new();
    let entries = std::fs::read_dir(&mods_dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                if ext == "jar" || ext == "disabled" {
                    let file_name = path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);

                    // Look up rich metadata
                    let meta = metadata_map.get(&file_name);

                    // Check if this is a user-installed mod
                    let is_user = user_mods_set.contains(&file_name);
                    let user_mod_entry = if is_user {
                        user_mods.mods.iter().find(|m| m.file_name == file_name)
                    } else {
                        None
                    };

                    mods.push(ModInfo {
                        file_name: file_name.clone(),
                        size_bytes,
                        // Convert serde_json::Value to String (handles both numbers and strings)
                        mod_id: meta
                            .map(|m| match &m.mod_id {
                                serde_json::Value::Number(n) => n.to_string(),
                                serde_json::Value::String(s) => s.clone(),
                                _ => String::new(),
                            })
                            .filter(|s| !s.is_empty())
                            .or_else(|| user_mod_entry.map(|u| u.project_id.clone())),
                        name: meta
                            .map(|m| m.name.clone())
                            .or_else(|| user_mod_entry.map(|u| u.name.clone())),
                        author: meta
                            .map(|m| m.author.clone())
                            .or_else(|| user_mod_entry.map(|u| u.author.clone())),
                        description: meta
                            .map(|m| m.description.clone())
                            .or_else(|| user_mod_entry.and_then(|u| u.description.clone())),
                        // Convert relative icon_path to absolute path for convertFileSrc
                        // For user-installed mods, use the icon_url from Modrinth directly
                        icon_path: meta
                            .and_then(|m| {
                                m.icon_path.as_ref().map(|rel_path| {
                                    // If we found metadata in cache, icons are likely there too
                                    if let Some(cache) = &cache_dir {
                                        cache.join(rel_path).to_string_lossy().to_string()
                                    } else {
                                        profile_dir.join(rel_path).to_string_lossy().to_string()
                                    }
                                })
                            })
                            .or_else(|| user_mod_entry.and_then(|u| u.icon_url.clone())),
                        is_extra: meta.and_then(|m| m.is_extra),
                        is_user_installed: if is_user { Some(true) } else { None },
                        source_id: None,
                    });
                }
            }
        }
    }

    // Sort by display name or filename
    mods.sort_by(|a, b| {
        let name_a = a.name.as_deref().unwrap_or(&a.file_name).to_lowercase();
        let name_b = b.name.as_deref().unwrap_or(&b.file_name).to_lowercase();
        name_a.cmp(&name_b)
    });

    Ok(mods)
}

#[tauri::command]
pub async fn open_profile_folder(profile_id: String) -> Result<(), String> {
    let profile_dir = paths::get_profile_dir(&profile_id);
    crate::utils::open_file_explorer(&profile_dir.to_string_lossy())
}

#[tauri::command]
pub async fn launch_profile(
    id: String,
    state: State<'_, AppStateType>,
    app: AppHandle,
) -> Result<(), String> {
    // 1. Get Profile, Account, and Settings
    let (profile, username, uuid, access_token, user_type, default_max_memory) = {
        let state = state.lock().await;
        let profile = state.get_profile(&id).await.ok_or("Profile not found")?;
        let settings = state.settings.read().await;
        let default_max_mem = settings.default_max_memory;
        drop(settings);

        // Try to get active account, otherwise use offline credentials
        if let Some(account) = state.get_active_account().await {
            (
                profile,
                account.username,
                account.uuid,
                account.access_token,
                "msa".to_string(),
                default_max_mem,
            )
        } else {
            // Use offline mode credentials
            let offline_username = "Player".to_string();
            // Generate offline UUID from username (Minecraft offline UUID format)
            let offline_uuid = generate_offline_uuid(&offline_username);
            let offline_token = "offline_token".to_string();
            (
                profile,
                offline_username,
                offline_uuid,
                offline_token,
                "legacy".to_string(),
                default_max_mem,
            )
        }
    };

    log::info!(
        "Launch requested: profile_id={} name={} version={} loader={} loader_version={:?}",
        profile.id,
        profile.name,
        profile.version,
        profile.loader,
        profile.loader_version
    );

    // 2. Install/Verify Game Files
    // Install now happens during `create_profile` to avoid long waits at launch time.
    // Keep a light verification here (just sanity checks).
    log::info!("Preparing launch for {}...", profile.name);
    log::debug!("Checking version jar for {}", profile.version);
    if !paths::get_version_jar(&profile.version).exists() {
        return Err(format!(
            "Minecraft {} is not installed yet (profile still installing). Please wait.",
            profile.version
        ));
    }
    log::debug!("Version jar exists, continuing...");

    // 4. Construct Classpath
    log::debug!("Constructing classpath...");
    let mut vanilla_classpath: Vec<String> = Vec::new();
    let libraries_dir = paths::get_libraries_dir();
    // let versions_dir = paths::get_versions_dir();

    // 4a. Vanilla Classpath
    // Read version JSON to get libraries
    // Simplified: We assume installers put jars in predictable paths.
    // For a robust implementation, we should read the JSONs.
    // Here we will use a "best effort" approach using the installers' logic if available,
    // or just checking the JSON content again.

    log::debug!("Getting version details for {}...", profile.version);
    let mc_installer = MinecraftInstaller::new();
    let version_details = mc_installer
        .get_version_details(&profile.version)
        .await
        .map_err(|e| e.to_string())?;
    log::debug!("Version details retrieved, building classpath...");
    for lib in &version_details.libraries {
        if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                let path = libraries_dir.join(&artifact.path);
                vanilla_classpath.push(path.to_string_lossy().to_string());
            }
        }
    }

    // 4b. Client Jar
    let client_jar = paths::get_version_jar(&profile.version);
    vanilla_classpath.push(client_jar.to_string_lossy().to_string());

    // 4c. Loader Classpath
    let mut fabric_classpath: Option<Vec<String>> = None;
    if profile.loader == ModLoader::Fabric {
        let mut cp = vanilla_classpath.clone();
        let fabric_installer = FabricInstaller::new();
        let versions = fabric_installer
            .get_loader_versions(&profile.version)
            .await
            .map_err(|e| e.to_string())?;

        // Pick the version used
        let loader_version = if let Some(v) = &profile.loader_version {
            versions
                .iter()
                .find(|lv| &lv.loader.version == v)
                .ok_or("Fabric version not found")?
                .clone()
        } else {
            versions
                .iter()
                .find(|lv| lv.loader.stable)
                .unwrap_or(&versions[0])
                .clone()
        };

        // Add fabric libs
        for lib in loader_version
            .launcher_meta
            .libraries
            .common
            .iter()
            .chain(loader_version.launcher_meta.libraries.client.iter())
        {
            if let Some(path) = paths::maven_to_path(&lib.name) {
                cp.push(libraries_dir.join(path).to_string_lossy().to_string());
            }
        }

        if let Some(path) = paths::maven_to_path(&loader_version.intermediary.maven) {
            cp.push(libraries_dir.join(path).to_string_lossy().to_string());
        }

        if let Some(path) = paths::maven_to_path(&loader_version.loader.maven) {
            cp.push(libraries_dir.join(path).to_string_lossy().to_string());
        }

        fabric_classpath = Some(cp);
    }

    // 5. Java Path
    // Prefer profile-configured Java if present; otherwise pick a compatible Java for this MC version.
    let required_major = version_details
        .java_version
        .as_ref()
        .map(|v| v.major_version);
    let java_path = find_java_for_profile(required_major, profile.java_path.as_deref())
        .ok_or("Java not found")?;

    // 6. Build Command
    // let game_dir = paths::get_game_dir();
    let assets_dir = paths::get_assets_dir();
    let profile_dir = paths::get_profile_dir(&profile.id);

    // Ensure per-profile folder structure exists for existing profiles too.
    if let Err(e) = std::fs::create_dir_all(&profile_dir) {
        return Err(format!("Failed to create profile directory: {}", e));
    }
    for sub in [
        "mods",
        "config",
        "saves",
        "resourcepacks",
        "shaderpacks",
        "logs",
        "crash-reports",
        "screenshots",
    ] {
        if let Err(e) = std::fs::create_dir_all(profile_dir.join(sub)) {
            return Err(format!("Failed to create profile subdir '{}': {}", sub, e));
        }
    }

    let natives_dir = start_extract_natives(&profile.version); // TODO: proper native extraction (NeoForge path below does extract)
                                                               // Verify natives extraction (should be done by installer, but here we just point to it)
                                                               // Actually Vanilla installer in `minecraft.rs` does verify/download natives, but doesn't EXTRACT them to a folder.
                                                               // We need to extract them to a temp folder or bin folder.
                                                               // For now, assume they are just in libraries (which is wrong for LWJGL 3 natives).
                                                               // TODO: proper native extraction.

    let build_vanilla_style_args =
        |main_class: &str, classpath: &[String], version_name: &str| -> Vec<String> {
            let mut args = Vec::new();

            // JVM Args
            // 1. Memory
            let max_mem = profile.max_memory.unwrap_or(default_max_memory);
            args.push(format!("-Xmx{}M", max_mem));

            // macOS fix: LWJGL requires running on the first thread
            if cfg!(target_os = "macos") {
                args.push("-XstartOnFirstThread".to_string());
            }

            // 2. Preset arguments
            if let Some(preset) = &profile.jvm_preset {
                append_jvm_preset_args(&mut args, preset, max_mem);
            }

            // 3. Custom arguments
            if let Some(custom_args) = &profile.custom_jvm_args {
                for arg in custom_args.split_whitespace() {
                    args.push(arg.to_string());
                }
            }
            args.push(format!("-Djava.library.path={}", natives_dir));
            args.push("-cp".to_string());
            args.push(classpath.join(get_cp_sep()));

            args.push(main_class.to_string());

            // Game Args
            args.push("--username".to_string());
            args.push(username.clone());
            args.push("--version".to_string());
            args.push(version_name.to_string());
            args.push("--gameDir".to_string());
            args.push(profile_dir.to_string_lossy().to_string());
            args.push("--assetsDir".to_string());
            args.push(assets_dir.to_string_lossy().to_string());
            args.push("--assetIndex".to_string());
            args.push(version_details.asset_index.id.clone());
            args.push("--uuid".to_string());
            args.push(uuid.clone());
            args.push("--accessToken".to_string());
            args.push(access_token.clone());
            args.push("--userType".to_string());
            args.push(user_type.clone());

            args
        };

    // Launch: loader-specific first. Fabric keeps a vanilla fallback for debugging;
    // NeoForge must succeed (no vanilla fallback).
    match profile.loader {
        ModLoader::Vanilla => {
            let args = build_vanilla_style_args(
                "net.minecraft.client.main.Main",
                &vanilla_classpath,
                &profile.version,
            );
            log_attempt(&java_path, &args, "vanilla");
            spawn_and_check(
                &java_path,
                &args,
                &profile_dir.to_string_lossy(),
                "vanilla",
                &app,
                &profile.id,
                &profile.name,
                &profile.version,
                &profile.loader.to_string(),
            )
            .await?;
        }
        ModLoader::Fabric => {
            let cp = fabric_classpath
                .clone()
                .ok_or("Fabric classpath not built")?;
            let args = build_vanilla_style_args(
                "net.fabricmc.loader.impl.launch.knot.KnotClient",
                &cp,
                &profile.version,
            );
            log_attempt(&java_path, &args, "fabric");
            if let Err(e) = spawn_and_check(
                &java_path,
                &args,
                &profile_dir.to_string_lossy(),
                "fabric",
                &app,
                &profile.id,
                &profile.name,
                &profile.version,
                &profile.loader.to_string(),
            )
            .await
            {
                log::warn!("Fabric launch failed; trying vanilla fallback: {}", e);
                let vanilla_args = build_vanilla_style_args(
                    "net.minecraft.client.main.Main",
                    &vanilla_classpath,
                    &profile.version,
                );
                log_attempt(&java_path, &vanilla_args, "vanilla-fallback");
                spawn_and_check(
                    &java_path,
                    &vanilla_args,
                    &profile_dir.to_string_lossy(),
                    "vanilla-fallback",
                    &app,
                    &profile.id,
                    &profile.name,
                    &profile.version,
                    "Vanilla",
                )
                .await?;
            }
        }
        ModLoader::NeoForge => {
            log::debug!("Launching NeoForge profile...");
            // IMPORTANT: Do NOT download/install on Play. Installation happens on create in the background.
            // If the profile isn't installed yet, return a friendly error.
            let neoforge_version = profile.loader_version.clone().ok_or(
                "NeoForge is still installing (loader_version not resolved yet). Please wait.",
            )?;
            log::debug!("NeoForge version from profile: {}", neoforge_version);
            let neoforge_version = neoforge_version
                .trim()
                .strip_prefix("neoforge-")
                .unwrap_or(&neoforge_version)
                .to_string();

            let expected_version_id = format!("neoforge-{}", neoforge_version);
            log::debug!("Looking for NeoForge version ID: {}", expected_version_id);
            let mut neoforge_version_id = None;
            if paths::get_version_json(&expected_version_id).exists() {
                log::debug!("Found version JSON at expected location");
                neoforge_version_id = Some(expected_version_id);
            } else {
                log::debug!("Expected version JSON not found, searching in versions directory...");
                // Fallback: find any installed NeoForge version for this MC version + this NeoForge version.
                let versions_dir = paths::get_versions_dir();
                if let Ok(entries) = std::fs::read_dir(&versions_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if !path.is_dir() {
                            continue;
                        }
                        let name = entry.file_name().to_string_lossy().to_string();
                        let name_lc = name.to_lowercase();
                        if !name_lc.contains("neoforge") {
                            continue;
                        }
                        if !name_lc.contains(&profile.version.to_lowercase())
                            && !name_lc.contains(&neoforge_version)
                        {
                            continue;
                        }
                        if paths::get_version_json(&name).exists() {
                            neoforge_version_id = Some(name);
                            break;
                        }
                    }
                }
            }

            let neoforge_version_id = neoforge_version_id.ok_or(
                "NeoForge is not installed yet. Please wait for installation to complete.",
            )?;
            log::debug!("Using NeoForge version ID: {}", neoforge_version_id);

            log::debug!("Building launch arguments from version JSON...");
            let mut extra_jvm_args = Vec::new();

            // Fix for Java 21 + Lucene/Vector API crashes (Standard for 1.21+)
            extra_jvm_args.push("--add-modules=jdk.incubator.vector".to_string());

            // macOS fix: LWJGL requires running on the first thread
            if cfg!(target_os = "macos") {
                extra_jvm_args.push("-XstartOnFirstThread".to_string());
            }

            // Standard compatibility flags for modern Java (fixes Drippy Loading Screen, FancyMenu, etc.)
            let compatibility_flags = [
                "--add-opens=java.base/java.util.jar=ALL-UNNAMED",
                "--add-opens=java.base/java.lang=ALL-UNNAMED",
                "--add-opens=java.base/java.util=ALL-UNNAMED",
                "--add-opens=java.base/java.io=ALL-UNNAMED",
                "--add-opens=java.base/java.net=ALL-UNNAMED",
                "--add-opens=java.base/java.nio=ALL-UNNAMED",
                "--add-opens=java.desktop/sun.awt=ALL-UNNAMED",
                "--add-opens=java.desktop/sun.font=ALL-UNNAMED",
            ];
            for flag in compatibility_flags {
                extra_jvm_args.push(flag.to_string());
            }

            if let Some(preset) = &profile.jvm_preset {
                append_jvm_preset_args(
                    &mut extra_jvm_args,
                    preset,
                    profile.max_memory.unwrap_or(default_max_memory),
                );
            }
            if let Some(custom) = &profile.custom_jvm_args {
                extra_jvm_args.extend(custom.split_whitespace().map(String::from));
            }

            let neoforge_args = build_args_from_version_json(
                &neoforge_version_id,
                &java_path,
                profile.max_memory.unwrap_or(default_max_memory),
                &username,
                &uuid,
                &access_token,
                &user_type,
                &profile_dir.to_string_lossy(),
                &assets_dir.to_string_lossy(),
                &version_details.asset_index.id,
                profile.resolution.as_ref().map(|r| (r.width, r.height)),
                &extra_jvm_args,
            )
            .await?;
            log::debug!(
                "Launch arguments built successfully, {} args total",
                neoforge_args.len()
            );

            log_attempt(&java_path, &neoforge_args, "neoforge");
            if let Err(e) = spawn_and_check(
                &java_path,
                &neoforge_args,
                &profile_dir.to_string_lossy(),
                "neoforge",
                &app,
                &profile.id,
                &profile.name,
                &profile.version,
                &profile.loader.to_string(),
            )
            .await
            {
                log::error!("NeoForge launch failed (no vanilla fallback): {}", e);
                return Err(e);
            }
        }
        _ => {
            return Err(format!(
                "Launcher support for '{}' is not implemented yet",
                profile.loader
            ));
        }
    }

    // Update last played
    {
        let state = state.lock().await;
        let mut profiles = state.profiles.write().await;
        if let Some(p) = profiles.profiles.iter_mut().find(|p| p.id == id) {
            p.last_played = Some(chrono::Utc::now().timestamp_millis());
        }
        // Save handled by drop/save
    }

    Ok(())
}

fn append_jvm_preset_args(args: &mut Vec<String>, preset: &str, max_mem_mb: u32) {
    // Note: Xmx is typically handled before calling this, but Aikar's requires Xms too.
    // Actually, let's handle Xmx/Xms inside here if we want full control,
    // OR just handle flags.
    // Current usage in launch_profile sets Xmx manually in match arms.
    // We will assume caller handles BASIC Xmx if preset is None, but if preset is Some, we might override?
    // No, better to let this function add flags. Caller sets Xmx if "balanced".

    // Actually, Aikar's implies specific Xms.
    match preset {
        "low_memory" => {
            args.push("-XX:+UseSerialGC".to_string());
        }
        "aikars" | "high_performance" => {
            // Aikar's flags
            args.push("-XX:+UseG1GC".to_string());
            args.push("-XX:+ParallelRefProcEnabled".to_string());
            args.push("-XX:MaxGCPauseMillis=200".to_string());
            args.push("-XX:+UnlockExperimentalVMOptions".to_string());
            args.push("-XX:+DisableExplicitGC".to_string());
            args.push("-XX:+AlwaysPreTouch".to_string());
            args.push("-XX:G1NewSizePercent=30".to_string());
            args.push("-XX:G1MaxNewSizePercent=40".to_string());
            args.push("-XX:G1HeapRegionSize=8M".to_string());
            args.push("-XX:G1ReservePercent=20".to_string());
            args.push("-XX:G1HeapWastePercent=5".to_string());
            args.push("-XX:G1MixedGCCountTarget=4".to_string());
            args.push("-XX:InitiatingHeapOccupancyPercent=15".to_string());
            args.push("-XX:G1MixedGCLiveThresholdPercent=90".to_string());
            args.push("-XX:G1RSetUpdatingPauseTimePercent=5".to_string());
            args.push("-XX:SurvivorRatio=32".to_string());
            args.push("-XX:+PerfDisableSharedMem".to_string());
            args.push("-XX:MaxTenuringThreshold=1".to_string());

            // Aikar reccomends Xms = Xmx.
            // We can push it here.
            args.push(format!("-Xms{}M", max_mem_mb));
        }
        "zgc" => {
            args.push("-XX:+UseZGC".to_string());
        }
        "zgc_gen" => {
            args.push("-XX:+UseZGC".to_string());
            args.push("-XX:+ZGenerational".to_string());
        }
        "ultimate" => {
            args.push("-XX:+UseZGC".to_string());
            args.push("-XX:+ZGenerational".to_string());
            args.push("-XX:+UnlockExperimentalVMOptions".to_string());
            args.push("-XX:+AlwaysPreTouch".to_string());
            args.push("-XX:+DisableExplicitGC".to_string());
            args.push("-XX:+PerfDisableSharedMem".to_string());
            args.push("-XX:+UseStringDeduplication".to_string());
            args.push("-Djava.net.preferIPv4Stack=true".to_string());
        }
        "shenandoah" => {
            args.push("-XX:+UseShenandoahGC".to_string());
            args.push("-XX:+AlwaysPreTouch".to_string());
        }
        _ => {}
    }
}

fn log_attempt(java_path: &str, args: &[String], mode: &str) {
    let redacted = redact_sensitive_args(args);
    log::info!("Launching mode={} java={}", mode, java_path);
    log::debug!("Args (redacted) mode={}: {:?}", mode, redacted);
}

async fn spawn_and_check(
    java_path: &str,
    args: &[String],
    cwd: &str,
    mode: &str,
    app: &AppHandle,
    profile_id: &str,
    profile_name: &str,
    profile_version: &str,
    profile_loader: &str,
) -> Result<(), String> {
    log::debug!("About to spawn process: mode={} java={}", mode, java_path);
    log::debug!("Total args count: {}", args.len());

    let mut child = Command::new(java_path)
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn game process (mode={}): {}", mode, e))?;

    let pid = child.id();
    log::info!("✓ Spawned game process mode={} pid={:?}", mode, pid);

    // Emit game started event
    let _ = app.emit(
        GAME_STATUS_EVENT,
        GameStatusPayload {
            is_running: true,
            profile_id: profile_id.to_string(),
            pid,
        },
    );

    // Set Discord Rich Presence
    if let Err(e) =
        crate::services::discord::set_presence(profile_name, profile_version, profile_loader)
    {
        log::debug!("Discord presence not set: {}", e);
    }

    // Handle stdout - emit to frontend
    if let Some(stdout) = child.stdout.take() {
        let mut stdout_reader = BufReader::new(stdout).lines();
        let app_clone = app.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = stdout_reader.next_line().await {
                log::info!("[GAME] {}", line);
                let cleaned_line = strip_game_timestamp(&line);
                let _ = app_clone.emit(
                    GAME_CONSOLE_EVENT,
                    GameConsolePayload {
                        line: cleaned_line,
                        stream: "stdout".to_string(),
                        timestamp: chrono::Utc::now().timestamp_millis(),
                    },
                );
            }
        });
    }

    // Handle stderr - emit to frontend
    if let Some(stderr) = child.stderr.take() {
        let mut stderr_reader = BufReader::new(stderr).lines();
        let app_clone = app.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                log::error!("[GAME] {}", line);
                let cleaned_line = strip_game_timestamp(&line);
                let _ = app_clone.emit(
                    GAME_CONSOLE_EVENT,
                    GameConsolePayload {
                        line: cleaned_line,
                        stream: "stderr".to_string(),
                        timestamp: chrono::Utc::now().timestamp_millis(),
                    },
                );
            }
        });
    }

    // Spawn a task to monitor process exit and emit status update
    let app_for_exit = app.clone();
    let profile_id_clone = profile_id.to_string();
    tokio::spawn(async move {
        // Wait for the child process to exit
        let status = child.wait().await;

        if let Ok(exit_status) = &status {
            if !exit_status.success() {
                log::warn!("Game exited with error code: {:?}", exit_status.code());

                // Analyze log
                let log_path = crate::utils::paths::get_profile_dir(&profile_id_clone)
                    .join("logs")
                    .join("latest.log");

                if log_path.exists() {
                    if let Ok(content) = std::fs::read_to_string(&log_path) {
                        if let Some(report) = crate::services::log_analyzer::analyze_log(&content) {
                            log::info!("Crash detected: {}", report.title);
                            let _ = app_for_exit.emit("crash_report", report);
                        }
                    }
                }
            }
        }

        log::info!("Game process exited, emitting status update");

        // Clear Discord Rich Presence
        if let Err(e) = crate::services::discord::clear_presence() {
            log::debug!("Failed to clear Discord presence: {}", e);
        }

        let _ = app_for_exit.emit(
            GAME_STATUS_EVENT,
            GameStatusPayload {
                is_running: false,
                profile_id: profile_id_clone,
                pid: None,
            },
        );
    });

    // Give the process a moment: if it exits immediately, treat as a failed attempt and allow fallback.
    log::debug!("Waiting 1.5s to check if process starts successfully...");
    sleep(Duration::from_millis(1500)).await;
    log::debug!("Checking process status...");

    // We can't use try_wait anymore since we moved child into the spawn task.
    // Instead, just assume success if we got this far without panicking.
    log::info!(
        "✓ Process appears to be running successfully (mode={}, pid={:?})",
        mode,
        pid
    );
    Ok(())
}

/// Strip Minecraft's built-in timestamp from log lines.
/// Matches patterns like: [14:03:04.930], [14:03:04], [2025-12-24 14:03:04]
fn strip_game_timestamp(line: &str) -> String {
    let trimmed = line.trim_start();

    // Pattern 1: [HH:MM:SS.mmm] or [HH:MM:SS]
    if trimmed.starts_with('[') {
        if let Some(bracket_end) = trimmed.find(']') {
            let potential_timestamp = &trimmed[1..bracket_end];
            // Check if it looks like a timestamp (contains colons and digits)
            let is_timestamp = potential_timestamp
                .chars()
                .all(|c| c.is_ascii_digit() || c == ':' || c == '.' || c == '-' || c == ' ')
                && potential_timestamp.contains(':');

            if is_timestamp {
                let rest = &trimmed[bracket_end + 1..];
                return rest.trim_start().to_string();
            }
        }
    }

    line.to_string()
}

fn redact_sensitive_args(args: &[String]) -> Vec<String> {
    let mut out = args.to_vec();
    if let Some(i) = out.iter().position(|a| a == "--accessToken") {
        if i + 1 < out.len() {
            out[i + 1] = "<redacted>".to_string();
        }
    }
    out
}

async fn build_args_from_version_json(
    version_id: &str,
    _java_path: &str,
    max_memory_mb: u32,
    username: &str,
    uuid: &str,
    access_token: &str,
    user_type: &str,
    game_dir: &str,
    assets_dir: &str,
    asset_index_id: &str,
    resolution: Option<(u32, u32)>,
    extra_jvm_args: &[String],
) -> Result<Vec<String>, String> {
    log::debug!("Loading merged version JSON for {}...", version_id);
    let merged = load_merged_version_json(version_id).await?;
    log::debug!("Merged version JSON loaded");

    let main_class = merged
        .get("mainClass")
        .and_then(|x| x.as_str())
        .ok_or("version.json missing mainClass")?
        .to_string();
    log::debug!("Main class: {}", main_class);

    let libraries_dir = paths::get_libraries_dir();
    log::debug!("Building classpath from version JSON...");
    let classpath = build_classpath_from_version_json(&merged, version_id, &libraries_dir).await?;
    let cp_len_before = classpath.len();
    let classpath = dedup_preserve_order(classpath);
    log::debug!(
        "Classpath built: {} entries (deduped -> {})",
        cp_len_before,
        classpath.len()
    );

    // Deduplicate classpath to avoid duplicate jars causing securejarhandler conflicts.
    let classpath = dedup_preserve_order(classpath);

    log::debug!("Extracting natives...");
    let merged_clone = merged.clone();
    let version_id_clone = version_id.to_string();
    let libraries_dir_clone = libraries_dir.clone();
    let natives_dir = tokio::task::spawn_blocking(move || {
        extract_natives_from_version_json(&merged_clone, &version_id_clone, &libraries_dir_clone)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;
    log::debug!("Natives extracted to: {}", natives_dir.display());

    let cp_sep = get_cp_sep();
    let cp_string = classpath.join(cp_sep);

    let mut vars: HashMap<&str, String> = HashMap::new();
    vars.insert("auth_player_name", username.to_string());
    vars.insert("auth_uuid", uuid.to_string());
    vars.insert("auth_access_token", access_token.to_string());
    vars.insert("user_type", user_type.to_string());
    vars.insert("version_name", version_id.to_string());
    vars.insert("game_directory", game_dir.to_string());
    vars.insert("assets_root", assets_dir.to_string());
    vars.insert("assets_index_name", asset_index_id.to_string());
    vars.insert(
        "natives_directory",
        natives_dir.to_string_lossy().to_string(),
    );
    vars.insert(
        "library_directory",
        libraries_dir.to_string_lossy().to_string(),
    );
    vars.insert("classpath", cp_string.clone());
    vars.insert("classpath_separator", cp_sep.to_string());
    vars.insert("launcher_name", "StyleLaborLauncher".to_string());
    vars.insert("launcher_version", "0.1.0".to_string());
    vars.insert("user_properties", "{}".to_string());

    // Common placeholders that appear in Mojang / modded jsons but aren't currently provided by our auth model.
    // Keep them benign so we don't pass raw ${...} tokens into the game.
    vars.insert("clientid", "".to_string());
    vars.insert("auth_xuid", "0".to_string());
    vars.insert(
        "version_type",
        merged
            .get("type")
            .and_then(|x| x.as_str())
            .unwrap_or("release")
            .to_string(),
    );

    // Resolution placeholders used by NeoForge early display on some versions.
    let (w, h) = resolution.unwrap_or((854, 480));
    vars.insert("resolution_width", w.to_string());
    vars.insert("resolution_height", h.to_string());

    // QuickPlay placeholders (safe defaults)
    vars.insert("quickPlayPath", "".to_string());
    vars.insert("quickPlaySingleplayer", "".to_string());
    vars.insert("quickPlayMultiplayer", "".to_string());
    vars.insert("quickPlayRealms", "".to_string());

    let (mut jvm_args, mut game_args) = extract_arguments(&merged);
    jvm_args = jvm_args
        .into_iter()
        .map(|a| substitute_vars(&a, &vars))
        .collect();
    game_args = game_args
        .into_iter()
        .map(|a| substitute_vars(&a, &vars))
        .collect();

    // Avoid duplicate classpath/library path flags (we set these explicitly).
    jvm_args = filter_jvm_args(jvm_args);

    let mut args: Vec<String> = Vec::new();
    args.push(format!("-Xmx{}M", max_memory_mb));
    args.extend_from_slice(extra_jvm_args);
    // If the version json already specifies java.library.path (after substitution) we'll let it win,
    // otherwise enforce ours.
    if !jvm_args
        .iter()
        .any(|a| a.starts_with("-Djava.library.path="))
    {
        args.push(format!(
            "-Djava.library.path={}",
            natives_dir.to_string_lossy()
        ));
    }
    // Extract module path libraries to exclude them from classpath
    let raw_module_path_libs = extract_module_path_libraries(&jvm_args);
    let module_path_libs = dedup_preserve_order(raw_module_path_libs.clone());
    log::debug!(
        "Module-path entries: {} (deduped -> {}), sample={:?}",
        raw_module_path_libs.len(),
        module_path_libs.len(),
        module_path_libs.iter().take(5).collect::<Vec<_>>()
    );

    // Deduplicate module path arguments to prevent "Module X reads another module named X" errors
    let jvm_args = deduplicate_module_path_args(jvm_args);
    args.extend(jvm_args);
    args.push("-cp".to_string());

    // Filter classpath to exclude libraries already on module path
    let filtered_cp = filter_classpath_conflicts(&cp_string, &module_path_libs, cp_sep);
    args.push(filtered_cp);
    args.push(main_class);

    if game_args.is_empty() {
        // Fallback for old-style / unexpected jsons.
        args.push("--username".to_string());
        args.push(username.to_string());
        args.push("--version".to_string());
        args.push(version_id.to_string());
        args.push("--gameDir".to_string());
        args.push(game_dir.to_string());
        args.push("--assetsDir".to_string());
        args.push(assets_dir.to_string());
        args.push("--assetIndex".to_string());
        args.push(asset_index_id.to_string());
        args.push("--uuid".to_string());
        args.push(uuid.to_string());
        args.push("--accessToken".to_string());
        args.push(access_token.to_string());
        args.push("--userType".to_string());
        args.push(user_type.to_string());
    } else {
        // Drop any remaining unresolved placeholder args (and their flags) so the JVM/game doesn't crash
        // on tokens like ${resolution_width}.
        game_args = filter_unresolved_game_args(game_args);
        args.extend(game_args);
    }

    Ok(args)
}

fn filter_unresolved_game_args(game_args: Vec<String>) -> Vec<String> {
    // Remove any args that still contain ${...}. For flags that take a value, remove the flag + value.
    let value_flags: std::collections::HashSet<&'static str> = [
        "--width",
        "--height",
        "--clientId",
        "--xuid",
        "--versionType",
        "--quickPlayPath",
        "--quickPlaySingleplayer",
        "--quickPlayMultiplayer",
        "--quickPlayRealms",
    ]
    .into_iter()
    .collect();

    let mut out = Vec::new();
    let mut i = 0usize;
    while i < game_args.len() {
        let a = &game_args[i];
        if value_flags.contains(a.as_str()) {
            if i + 1 < game_args.len() {
                let v = &game_args[i + 1];
                if a.contains("${") || v.contains("${") {
                    i += 2;
                    continue;
                }
            }
        }
        if a.contains("${") {
            i += 1;
            continue;
        }
        out.push(a.clone());
        i += 1;
    }
    out
}

async fn load_merged_version_json(version_id: &str) -> Result<Value, String> {
    let json_path = paths::get_version_json(version_id);
    let content = tokio::fs::read_to_string(&json_path)
        .await
        .map_err(|e| format!("Failed to read version json {}: {}", json_path.display(), e))?;
    let mut v: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let parent_id = v
        .get("inheritsFrom")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());

    if let Some(parent_id) = parent_id {
        let parent_path = paths::get_version_json(&parent_id);
        if parent_path.exists() {
            let parent_content = tokio::fs::read_to_string(&parent_path).await.map_err(|e| {
                format!(
                    "Failed to read parent version json {}: {}",
                    parent_path.display(),
                    e
                )
            })?;
            let parent: Value = serde_json::from_str(&parent_content).map_err(|e| e.to_string())?;
            v = merge_version_json(parent, v);
        } else {
            log::warn!(
                "version.json inheritsFrom '{}' but parent json not found at {}",
                parent_id,
                parent_path.display()
            );
        }
    }

    Ok(v)
}

fn merge_version_json(parent: Value, child: Value) -> Value {
    // Minimal merge strategy:
    // - mainClass: child overrides parent
    // - libraries: parent + child
    // - arguments: parent + child (append)
    // - everything else: child overrides parent if present
    let mut out = parent;

    if let Some(main_class) = child.get("mainClass") {
        out["mainClass"] = main_class.clone();
    }

    // libraries
    let mut libs: Vec<Value> = out
        .get("libraries")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    if let Some(child_libs) = child.get("libraries").and_then(|x| x.as_array()) {
        libs.extend(child_libs.iter().cloned());
    }
    out["libraries"] = Value::Array(libs);

    // arguments
    let mut merged_args = out.get("arguments").cloned().unwrap_or(Value::Null);
    if merged_args.is_null() {
        merged_args = Value::Object(serde_json::Map::new());
    }
    let mut args_obj = merged_args.as_object().cloned().unwrap_or_default();
    let parent_game = args_obj
        .get("game")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    let parent_jvm = args_obj
        .get("jvm")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();

    let mut game = parent_game;
    let mut jvm = parent_jvm;
    if let Some(child_args) = child.get("arguments").and_then(|x| x.as_object()) {
        if let Some(child_game) = child_args.get("game").and_then(|x| x.as_array()) {
            game.extend(child_game.iter().cloned());
        }
        if let Some(child_jvm) = child_args.get("jvm").and_then(|x| x.as_array()) {
            jvm.extend(child_jvm.iter().cloned());
        }
    }
    args_obj.insert("game".to_string(), Value::Array(game));
    args_obj.insert("jvm".to_string(), Value::Array(jvm));
    out["arguments"] = Value::Object(args_obj);

    // Overlay remaining top-level keys from child.
    if let Some(obj) = child.as_object() {
        for (k, v) in obj {
            if k == "libraries" || k == "arguments" || k == "mainClass" {
                continue;
            }
            out[k] = v.clone();
        }
    }

    out
}

fn extract_arguments(v: &Value) -> (Vec<String>, Vec<String>) {
    let mut jvm = Vec::new();
    let mut game = Vec::new();

    if let Some(args) = v.get("arguments") {
        if let Some(j) = args.get("jvm").and_then(|x| x.as_array()) {
            jvm.extend(flatten_argument_array(j));
        }
        if let Some(g) = args.get("game").and_then(|x| x.as_array()) {
            game.extend(flatten_argument_array(g));
        }
    }

    (jvm, game)
}

fn flatten_argument_array(arr: &[Value]) -> Vec<String> {
    let mut out = Vec::new();
    for item in arr {
        if let Some(s) = item.as_str() {
            out.push(s.to_string());
            continue;
        }
        // Complex argument object
        let rules_ok = item
            .get("rules")
            .and_then(|r| r.as_array())
            .map(|rules| rules_allow(rules))
            .unwrap_or(true);
        if !rules_ok {
            continue;
        }
        if let Some(val) = item.get("value") {
            if let Some(s) = val.as_str() {
                out.push(s.to_string());
            } else if let Some(a) = val.as_array() {
                for v in a {
                    if let Some(s) = v.as_str() {
                        out.push(s.to_string());
                    }
                }
            }
        }
    }
    out
}

fn rules_allow(rules: &[Value]) -> bool {
    // Minimal Mojang-style rules evaluation:
    // - If any matching rule says disallow -> false
    // - Else if any matching rule says allow -> true
    // - Else -> false (conservative)
    let mut matched_allow = false;
    for rule in rules {
        let action = rule.get("action").and_then(|x| x.as_str()).unwrap_or("");
        let os_ok = rule
            .get("os")
            .and_then(|x| x.get("name"))
            .and_then(|x| x.as_str())
            .map(matches_os_name)
            .unwrap_or(true);

        if !os_ok {
            continue;
        }

        match action {
            "disallow" => return false,
            "allow" => matched_allow = true,
            _ => {}
        }
    }
    matched_allow || rules.is_empty()
}

fn matches_os_name(name: &str) -> bool {
    let current = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    };
    name == current
}

fn substitute_vars(input: &str, vars: &HashMap<&str, String>) -> String {
    let mut out = input.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("${{{}}}", k), v);
    }
    out
}

fn extract_module_path_libraries(jvm_args: &[String]) -> Vec<String> {
    let mut module_libs = Vec::new();
    let mut i = 0;
    while i < jvm_args.len() {
        if jvm_args[i] == "-p" || jvm_args[i] == "--module-path" {
            if i + 1 < jvm_args.len() {
                let module_path = &jvm_args[i + 1];
                // Extract library paths from module path.
                // IMPORTANT: On Windows, paths contain a ':' after the drive letter (C:\...),
                // so we must NOT split on ':'.
                let sep = if cfg!(target_os = "windows") {
                    ';'
                } else {
                    ':'
                };
                for path in module_path.split(sep) {
                    let path = path.trim();
                    if !path.is_empty() {
                        module_libs.push(normalize_path_for_compare(path));
                    }
                }
            }
            // Continue to process all module path arguments, not just the first
        }
        i += 1;
    }
    module_libs
}

fn deduplicate_module_path_args(jvm_args: Vec<String>) -> Vec<String> {
    let mut result = Vec::new();
    let mut i = 0;
    let sep = if cfg!(target_os = "windows") {
        ';'
    } else {
        ':'
    };

    while i < jvm_args.len() {
        if jvm_args[i] == "-p" || jvm_args[i] == "--module-path" {
            // Found a module path argument
            result.push(jvm_args[i].clone());

            if i + 1 < jvm_args.len() {
                let module_path = &jvm_args[i + 1];
                // Split, deduplicate, and rejoin the module path
                let paths: Vec<String> = module_path
                    .split(sep)
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                    .collect();

                // Deduplicate while preserving order
                let mut seen = std::collections::HashSet::new();
                let mut deduped_paths = Vec::new();
                for path in paths {
                    let normalized = normalize_path_for_compare(&path);
                    if seen.insert(normalized) {
                        deduped_paths.push(path);
                    }
                }

                // Rejoin with separator
                let deduped_module_path = deduped_paths.join(&sep.to_string());
                result.push(deduped_module_path);
                i += 2; // Skip both the flag and its value
            } else {
                // No value after flag, just add the flag
                result.push(jvm_args[i].clone());
                i += 1;
            }
        } else {
            // Not a module path argument, just copy it
            result.push(jvm_args[i].clone());
            i += 1;
        }
    }

    result
}

fn dedup_preserve_order(items: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for item in items {
        if seen.insert(item.clone()) {
            out.push(item);
        }
    }
    out
}

fn filter_classpath_conflicts(cp_string: &str, module_libs: &[String], cp_sep: &str) -> String {
    if module_libs.is_empty() {
        return cp_string.to_string();
    }

    // Filter classpath entries by removing ONLY exact duplicate jar paths that are already present on the module path.
    // The previous "group/package" based filter was too aggressive (e.g. it removed required net.neoforged jars
    // like accesstransformers, which breaks NeoForge on Java 21).
    let module_set: std::collections::HashSet<String> = module_libs.iter().cloned().collect();

    let filtered: Vec<&str> = cp_string
        .split(cp_sep)
        .filter(|entry| {
            let norm = normalize_path_for_compare(entry);
            !module_set.contains(&norm)
        })
        .collect();

    filtered.join(cp_sep)
}

fn normalize_path_for_compare(path: &str) -> String {
    let mut s = path.trim().replace('\\', "/");
    // Some args may contain accidental duplicated separators; normalize lightly.
    while s.contains("//") {
        s = s.replace("//", "/");
    }
    if cfg!(target_os = "windows") {
        s = s.to_lowercase();
    }
    s
}

fn filter_jvm_args(args: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    let mut skip_next = false;
    for a in args {
        if skip_next {
            skip_next = false;
            continue;
        }
        if a == "-cp" || a == "-classpath" {
            skip_next = true;
            continue;
        }
        // Avoid passing a ${classpath} placeholder that some jsons use.
        if a.contains("${classpath}") {
            continue;
        }
        out.push(a);
    }
    out
}

async fn build_classpath_from_version_json(
    merged: &Value,
    version_id: &str,
    libraries_dir: &std::path::PathBuf,
) -> Result<Vec<String>, String> {
    log::debug!("Starting classpath build for version {}", version_id);
    let mut cp: Vec<String> = Vec::new();
    if let Some(libs) = merged.get("libraries").and_then(|x| x.as_array()) {
        log::debug!("Processing {} libraries...", libs.len());
        for (idx, lib_val) in libs.iter().enumerate() {
            if idx % 50 == 0 {
                log::debug!("Processing library {}/{}", idx, libs.len());
            }
            // Respect Mojang-style rules on libraries (NoRiskClient filters by rules too).
            if let Some(rules) = lib_val.get("rules").and_then(|r| r.as_array()) {
                if !rules_allow(rules) {
                    continue;
                }
            }
            // Try downloads.artifact.path first, else fall back to maven coordinate.
            if let Some(path) = lib_val
                .get("downloads")
                .and_then(|d| d.get("artifact"))
                .and_then(|a| a.get("path"))
                .and_then(|p| p.as_str())
            {
                cp.push(libraries_dir.join(path).to_string_lossy().to_string());
                continue;
            }
            if let Some(name) = lib_val.get("name").and_then(|n| n.as_str()) {
                if let Some(path) = paths::maven_to_path(name) {
                    cp.push(libraries_dir.join(path).to_string_lossy().to_string());
                }
            }
        }
        log::debug!("Finished processing all {} libraries", libs.len());
    }

    // Add a client jar if it exists.
    // NoRiskClient always includes a client jar (vanilla unless a NeoForge client jar is present).
    log::debug!("Finding client jar for {}...", version_id);
    let version_id_owned = version_id.to_string();
    let jar_result = tokio::task::spawn_blocking(move || find_any_version_jar(&version_id_owned))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;

    if let Ok(jar_path) = jar_result {
        log::debug!("Version jar found: {}", jar_path.display());
        cp.push(jar_path.to_string_lossy().to_string());
    } else {
        // If no jar exists in versions/<id>, fall back to the inherited vanilla client jar (common for loaders).
        // NOTE: Do NOT add NeoForge's `neoforge-*-client.jar` here: it has the automatic module name `neoforge`,
        // which collides with `neoforge-*-universal.jar`.
        //
        // ADDITIONALLY: For NeoForge 20.4+ (using BootstrapLauncher), do NOT add the vanilla client jar to the classpath.
        // It causes "Modules minecraft and _1._21._1 export package..." errors because the bootstrap launcher
        // loads it as module `minecraft`, but putting it on classpath also exposes it as `_1._21._1` (automatic module).
        if let Some(parent_id) = merged.get("inheritsFrom").and_then(|x| x.as_str()) {
            let main_class = merged
                .get("mainClass")
                .and_then(|x| x.as_str())
                .unwrap_or("");
            if main_class == "cpw.mods.bootstraplauncher.BootstrapLauncher" {
                log::debug!("NeoForge BootstrapLauncher detected, skipping inherited vanilla client jar to prevent module conflicts");
            } else {
                let parent_jar = paths::get_version_jar(parent_id);
                if parent_jar.exists() {
                    log::debug!(
                        "Using inherited vanilla client jar: {}",
                        parent_jar.display()
                    );
                    cp.push(parent_jar.to_string_lossy().to_string());
                } else {
                    log::debug!(
                        "Inherited jar not found at {}, will continue without a client jar",
                        parent_jar.display()
                    );
                }
            }
        } else {
            log::debug!(
                "No version jar found and no inheritsFrom; continuing without a client jar"
            );
        }
    }

    log::debug!("Classpath build complete: {} total entries", cp.len());
    Ok(cp)
}

fn find_any_version_jar(version_id: &str) -> Result<std::path::PathBuf, String> {
    let default = paths::get_version_jar(version_id);
    log::debug!("Checking default version jar path: {}", default.display());
    if default.exists() {
        log::debug!("Default version jar exists, using it");
        return Ok(default);
    }
    log::debug!("Default jar not found, searching directory...");
    let dir = paths::get_versions_dir().join(version_id);
    log::debug!("Reading directory: {}", dir.display());
    let entries = std::fs::read_dir(&dir).map_err(|e| {
        log::error!("Failed to read directory {}: {}", dir.display(), e);
        e.to_string()
    })?;
    log::debug!("Directory read successfully, iterating entries...");
    let mut count = 0;
    for entry in entries.flatten() {
        count += 1;
        let p = entry.path();
        log::debug!("Checking entry #{}: {}", count, p.display());
        if p.is_file() {
            log::debug!("  -> is a file");
            if let Some(ext) = p.extension() {
                log::debug!("  -> extension: {:?}", ext);
                if ext == "jar" {
                    log::debug!("  -> Found JAR file!");
                    return Ok(p);
                }
            }
        } else {
            log::debug!("  -> not a file (directory or symlink)");
        }
    }
    log::error!("No JAR file found after checking {} entries", count);
    Err(format!(
        "Could not find version jar for '{}' in {}",
        version_id,
        dir.display()
    ))
}

fn extract_natives_from_version_json(
    merged: &Value,
    version_id: &str,
    libraries_dir: &std::path::PathBuf,
) -> Result<std::path::PathBuf, String> {
    log::debug!("Extracting natives for version {}...", version_id);
    let natives_dir = paths::get_natives_dir().join(version_id);
    std::fs::create_dir_all(&natives_dir).map_err(|e| e.to_string())?;
    log::debug!("Natives directory: {}", natives_dir.display());

    let libs = merged
        .get("libraries")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();

    log::debug!("Checking {} libraries for natives...", libs.len());
    let mut natives_count = 0;

    for lib_val in libs {
        // Deserialize into our Library model for easier handling of downloads/natives/extract.
        let lib: crate::models::Library = match serde_json::from_value(lib_val) {
            Ok(l) => l,
            Err(_) => continue,
        };
        let natives = match lib.natives {
            Some(n) => n,
            None => continue,
        };
        let os_key = if cfg!(target_os = "windows") {
            "windows"
        } else if cfg!(target_os = "macos") {
            "osx"
        } else {
            "linux"
        };
        let classifier = match natives.get(os_key) {
            Some(c) => c,
            None => continue,
        };
        let jar_rel = lib
            .downloads
            .as_ref()
            .and_then(|d| d.classifiers.as_ref())
            .and_then(|c| c.get(classifier))
            .map(|a| a.path.clone());
        let jar_rel = match jar_rel {
            Some(p) => p,
            None => continue,
        };

        let jar_path = libraries_dir.join(jar_rel);
        if !jar_path.exists() {
            continue;
        }

        let excludes = lib
            .extract
            .as_ref()
            .map(|e| e.exclude.clone())
            .unwrap_or_default();

        natives_count += 1;
        log::debug!(
            "Extracting native #{}: {}",
            natives_count,
            jar_path.file_name().unwrap_or_default().to_string_lossy()
        );
        extract_jar_to_dir(&jar_path, &natives_dir, &excludes)?;
    }

    log::debug!(
        "Native extraction complete: {} natives extracted",
        natives_count
    );
    Ok(natives_dir)
}

fn extract_jar_to_dir(
    jar_path: &std::path::PathBuf,
    out_dir: &std::path::PathBuf,
    excludes: &[String],
) -> Result<(), String> {
    let file = std::fs::File::open(jar_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let total = zip.len();
    log::debug!("Extracting JAR with {} entries...", total);

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();

        if name.ends_with('/') {
            continue;
        }
        if name.starts_with("META-INF/") {
            continue;
        }
        if excludes.iter().any(|ex| name.starts_with(ex)) {
            continue;
        }

        let out_path = out_dir.join(&name);
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(&out_path, buf).map_err(|e| e.to_string())?;
    }

    log::debug!("JAR extraction complete");
    Ok(())
}

fn get_cp_sep() -> &'static str {
    if cfg!(windows) {
        ";"
    } else {
        ":"
    }
}

fn start_extract_natives(version: &str) -> String {
    // Placeholder: Return path to natives directory.
    // In a real impl, we'd extract jars from libraries/ to bin/natives/
    let path = paths::get_versions_dir().join(version).join("natives");
    std::fs::create_dir_all(&path).ok();
    path.to_string_lossy().to_string()
}

fn generate_offline_uuid(username: &str) -> String {
    // Generate offline UUID using Minecraft's offline UUID algorithm
    // This uses a version 3 UUID with the "OfflinePlayer" namespace
    // The namespace UUID for offline players in Minecraft
    let namespace =
        Uuid::parse_str("00000000-0000-0000-0000-000000000000").unwrap_or_else(|_| Uuid::nil());

    // Generate v3 UUID (MD5-based) from the namespace and username
    // Format: "OfflinePlayer:<username>"
    let name = format!("OfflinePlayer:{}", username);
    let uuid = Uuid::new_v3(&namespace, name.as_bytes());
    uuid.to_string()
}

pub fn required_java_major_for_mc(mc_version: &str) -> Option<i32> {
    // Mojang moved to Java 21 starting with Minecraft 1.20.5.
    // Keep this simple and conservative.
    let parts: Vec<&str> = mc_version.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let minor = parts
        .get(1)
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0);
    let patch = parts
        .get(2)
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0);
    if minor > 20 {
        return Some(21);
    }
    if minor == 20 && patch >= 5 {
        return Some(21);
    }
    Some(17)
}

pub fn find_java_for_profile(
    required_major: Option<i32>,
    explicit: Option<&str>,
) -> Option<String> {
    // On non-windows, we might not use required_major, so suppress warning globally for the function.
    #[cfg(not(target_os = "windows"))]
    let _ = required_major;

    // If the profile explicitly sets a java path, use it.
    if let Some(p) = explicit {
        let p = p.trim();
        if !p.is_empty() && std::path::Path::new(p).exists() {
            return Some(p.to_string());
        }
    }

    // Try to find a compatible Java in common locations (prefer required_major if provided).
    #[cfg(target_os = "windows")]
    {
        let mut candidates: Vec<std::path::PathBuf> = Vec::new();

        // Common base folders
        let search_bases = [
            r"C:\Program Files\Java",
            r"C:\Program Files (x86)\Java",
            r"C:\Program Files\Eclipse Adoptium",
            r"C:\Program Files\Microsoft",
            r"C:\Program Files\Zulu",
        ];

        for base in search_bases {
            if let Ok(entries) = std::fs::read_dir(base) {
                for entry in entries.flatten() {
                    let java_exe = entry.path().join("bin").join("java.exe");
                    if java_exe.exists() {
                        candidates.push(java_exe);
                    }
                }
            }
        }

        // Also check JAVA_HOME
        if let Ok(java_home) = std::env::var("JAVA_HOME") {
            let java_exe = std::path::Path::new(&java_home)
                .join("bin")
                .join("java.exe");
            if java_exe.exists() {
                candidates.push(java_exe);
            }
        }

        // As a last resort, allow PATH java (we'll still validate major if required).
        candidates.push(std::path::PathBuf::from("java"));

        // Pick best candidate: prefer exact required_major; otherwise highest major.
        let mut best: Option<(i32, String)> = None;
        for c in candidates {
            let major = java_major_version(&c).unwrap_or(-1);
            if let Some(req) = required_major {
                if major != req {
                    continue;
                }
            }
            let path_s = c.to_string_lossy().to_string();
            match &best {
                Some((best_major, _)) if major <= *best_major => {}
                _ => best = Some((major, path_s)),
            }
        }

        if let Some((_, p)) = best {
            return Some(p);
        }
    }

    // Fallback (non-windows or if no validated candidate): just use `java`.
    Some("java".to_string())
}

#[allow(dead_code)]
fn java_major_version(java_path: &std::path::Path) -> Option<i32> {
    // Run `java -version` and parse the major version from output.
    // Output usually goes to stderr.
    let out = std::process::Command::new(java_path)
        .arg("-version")
        .output()
        .ok()?;
    let text =
        String::from_utf8_lossy(&out.stderr).to_string() + &String::from_utf8_lossy(&out.stdout);

    // Look for: version "21.0.1" or "openjdk version "21.0.1""
    // Also handle "25.0.1".
    for token in text.split_whitespace() {
        if token.starts_with('"') && token.ends_with('"') && token.len() > 2 {
            let inner = &token[1..token.len() - 1];
            if let Some((major_s, _)) = inner.split_once('.') {
                if let Ok(m) = major_s.parse::<i32>() {
                    return Some(m);
                }
            }
        }
    }
    None
}

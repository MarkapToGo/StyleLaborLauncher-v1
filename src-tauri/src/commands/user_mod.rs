use crate::services::modrinth::{ModrinthApi, ModrinthSearchResult};
use crate::state::AppState;
use crate::utils::paths;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

type AppStateType = Arc<Mutex<AppState>>;

/// User-installed mod entry (stored in user_mods.json per profile)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserModEntry {
    pub project_id: String,
    pub version_id: String,
    pub file_name: String,
    pub name: String,
    pub author: String,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub installed_at: i64,
}

/// Container for user_mods.json
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserModsFile {
    pub mods: Vec<UserModEntry>,
}

impl UserModsFile {
    pub fn load(profile_id: &str) -> Self {
        let new_path = paths::get_profile_metadata_dir(profile_id).join("user_mods.json");

        // Try to load from new location first
        if new_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&new_path) {
                if let Ok(file) = serde_json::from_str(&content) {
                    return file;
                }
            }
        }

        // Fallback: check legacy location
        let legacy_path = paths::get_profile_dir(profile_id).join("user_mods.json");
        if legacy_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&legacy_path) {
                if let Ok(file) = serde_json::from_str::<Self>(&content) {
                    // Migrate to new location!
                    log::info!(
                        "Migrating user_mods.json for profile {} to metadata directory",
                        profile_id
                    );
                    if let Ok(parent) = new_path.parent().ok_or("No parent") {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    if let Ok(_) = std::fs::write(&new_path, &content) {
                        let _ = std::fs::remove_file(legacy_path);
                    }
                    return file;
                }
            }
        }

        Self::default()
    }

    pub fn save(&self, profile_id: &str) -> Result<()> {
        let dir = paths::get_profile_metadata_dir(profile_id);
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("user_mods.json");

        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }
}

/// Search for mods on Modrinth filtered by version and loader
#[tauri::command]
pub async fn search_modrinth_mods(
    query: String,
    profile_id: String,
    project_type: Option<String>,
    offset: Option<u32>,
    state: State<'_, AppStateType>,
) -> Result<Vec<ModrinthSearchResult>, String> {
    // Get profile to determine MC version and loader
    let (mc_version, loader) = {
        let state = state.lock().await;
        let profile = state
            .get_profile(&profile_id)
            .await
            .ok_or("Profile not found")?;

        let loader_str = match profile.loader {
            crate::models::ModLoader::Fabric => "fabric",
            crate::models::ModLoader::Forge => "forge",
            crate::models::ModLoader::NeoForge => "neoforge",
            crate::models::ModLoader::Quilt => "quilt",
            crate::models::ModLoader::Vanilla => "vanilla",
        };

        (profile.version.clone(), loader_str.to_string())
    };

    let project_type_str = project_type.as_deref().unwrap_or("mod");

    log::info!(
        "Searching Modrinth for '{}' (MC: {}, Loader: {}, type: {}, offset: {:?})",
        query,
        mc_version,
        loader,
        project_type_str,
        offset
    );

    ModrinthApi::search_mods(
        &query,
        &mc_version,
        &loader,
        Some(project_type_str),
        Some(20),
        offset,
    )
    .await
    .map_err(|e| e.to_string())
}

/// Install a mod from Modrinth to a profile
#[tauri::command]
pub async fn install_user_mod(
    profile_id: String,
    project_id: String,
    project_type: Option<String>,
    state: State<'_, AppStateType>,
) -> Result<UserModEntry, String> {
    // Get profile to determine MC version and loader
    let (mc_version, loader) = {
        let state = state.lock().await;
        let profile = state
            .get_profile(&profile_id)
            .await
            .ok_or("Profile not found")?;

        let loader_str = match profile.loader {
            crate::models::ModLoader::Fabric => "fabric",
            crate::models::ModLoader::Forge => "forge",
            crate::models::ModLoader::NeoForge => "neoforge",
            crate::models::ModLoader::Quilt => "quilt",
            crate::models::ModLoader::Vanilla => "vanilla",
        };

        (profile.version.clone(), loader_str.to_string())
    };

    let type_str = project_type.as_deref().unwrap_or("mod");

    log::info!(
        "Installing {} {} for profile {} (MC: {}, Loader: {})",
        type_str,
        project_id,
        profile_id,
        mc_version,
        loader
    );

    // Get the latest version - only pass loader for mods (resourcepacks/shaders don't have loaders)
    let loader_param = if type_str == "mod" {
        Some(loader.as_str())
    } else {
        None
    };
    let version = ModrinthApi::get_version(&project_id, &mc_version, loader_param)
        .await
        .map_err(|e| format!("Failed to get version: {}", e))?
        .ok_or("No compatible version found for this item")?;

    // Find the primary file
    let file = version
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| version.files.first())
        .ok_or("No files found for this mod version")?;

    // Download the file
    let mods_dir = paths::get_profile_dir(&profile_id).join("mods");
    std::fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;
    let dest_path = mods_dir.join(&file.filename);

    log::info!("Downloading {} to {:?}", file.url, dest_path);

    let client = reqwest::Client::new();
    let resp = client
        .get(&file.url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&dest_path, &bytes).map_err(|e| e.to_string())?;

    // We need to get more info about the project (title, author, icon)
    // For now, we'll make a separate API call
    let project_info = get_project_info(&project_id).await.unwrap_or_default();

    // Create user mod entry
    let entry = UserModEntry {
        project_id: project_id.clone(),
        version_id: version.id.clone(),
        file_name: file.filename.clone(),
        name: project_info.0,
        author: project_info.1,
        description: project_info.2,
        icon_url: project_info.3,
        installed_at: chrono::Utc::now().timestamp(),
    };

    // Save to user_mods.json
    let mut user_mods = UserModsFile::load(&profile_id);
    // Remove existing entry for same project if present (update)
    user_mods.mods.retain(|m| m.project_id != project_id);
    user_mods.mods.push(entry.clone());
    user_mods.save(&profile_id).map_err(|e| e.to_string())?;

    log::info!("Successfully installed mod: {}", entry.name);

    Ok(entry)
}

/// Remove a user-installed mod from a profile
#[tauri::command]
pub async fn remove_user_mod(profile_id: String, file_name: String) -> Result<(), String> {
    log::info!(
        "Removing user mod {} from profile {}",
        file_name,
        profile_id
    );

    // Delete the file
    let mod_path = paths::get_profile_dir(&profile_id)
        .join("mods")
        .join(&file_name);

    if mod_path.exists() {
        std::fs::remove_file(&mod_path).map_err(|e| e.to_string())?;
    }

    // Remove from user_mods.json
    let mut user_mods = UserModsFile::load(&profile_id);
    user_mods.mods.retain(|m| m.file_name != file_name);
    user_mods.save(&profile_id).map_err(|e| e.to_string())?;

    log::info!("Successfully removed mod: {}", file_name);

    Ok(())
}

/// Helper: Reinstall all user mods after a modpack update
pub async fn reinstall_user_mods(profile_id: &str, mc_version: &str, loader: &str) -> Result<()> {
    let user_mods = UserModsFile::load(profile_id);

    if user_mods.mods.is_empty() {
        log::info!("No user mods to reinstall for profile {}", profile_id);
        return Ok(());
    }

    log::info!(
        "Reinstalling {} user mods for profile {}",
        user_mods.mods.len(),
        profile_id
    );

    let mods_dir = paths::get_profile_dir(profile_id).join("mods");
    std::fs::create_dir_all(&mods_dir)?;

    let client = reqwest::Client::new();
    let mut new_entries = Vec::new();

    for mod_entry in user_mods.mods {
        log::info!("Reinstalling user mod: {}", mod_entry.name);

        // Try to get the compatible version for the (possibly updated) MC version/loader
        match ModrinthApi::get_version(&mod_entry.project_id, mc_version, Some(loader)).await {
            Ok(Some(version)) => {
                if let Some(file) = version
                    .files
                    .iter()
                    .find(|f| f.primary)
                    .or_else(|| version.files.first())
                {
                    let dest_path = mods_dir.join(&file.filename);

                    match client.get(&file.url).send().await {
                        Ok(resp) => {
                            if let Ok(bytes) = resp.bytes().await {
                                if std::fs::write(&dest_path, &bytes).is_ok() {
                                    // Update entry with new filename/version
                                    new_entries.push(UserModEntry {
                                        project_id: mod_entry.project_id,
                                        version_id: version.id.clone(),
                                        file_name: file.filename.clone(),
                                        name: mod_entry.name,
                                        author: mod_entry.author,
                                        description: mod_entry.description,
                                        icon_url: mod_entry.icon_url,
                                        installed_at: mod_entry.installed_at,
                                    });
                                    log::info!("Successfully reinstalled: {}", file.filename);
                                    continue;
                                }
                            }
                        }
                        Err(e) => {
                            log::warn!("Failed to download mod {}: {}", mod_entry.name, e);
                        }
                    }
                }
            }
            Ok(None) => {
                log::warn!(
                    "No compatible version found for {} (MC: {}, Loader: {})",
                    mod_entry.name,
                    mc_version,
                    loader
                );
            }
            Err(e) => {
                log::warn!("Failed to get version for {}: {}", mod_entry.name, e);
            }
        }

        // If we get here, reinstall failed - still keep the entry so user knows
        log::warn!("Could not reinstall mod: {}", mod_entry.name);
    }

    // Save updated user_mods.json
    let updated = UserModsFile { mods: new_entries };
    updated.save(profile_id)?;

    Ok(())
}

/// Helper: Get project info (title, author, description, icon_url) from Modrinth
async fn get_project_info(
    project_id: &str,
) -> Option<(String, String, Option<String>, Option<String>)> {
    #[derive(Deserialize)]
    struct ProjectInfo {
        title: String,
        description: Option<String>,
        #[serde(default)]
        team: Option<String>,
        icon_url: Option<String>,
    }

    let client = reqwest::Client::new();
    let url = format!("https://api.modrinth.com/v2/project/{}", project_id);

    let resp = client
        .get(&url)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    let info: ProjectInfo = resp.json().await.ok()?;

    // Get team members to find author
    let author = if let Some(team_id) = &info.team {
        get_team_owner(team_id)
            .await
            .unwrap_or_else(|| "Unknown".to_string())
    } else {
        "Unknown".to_string()
    };

    Some((info.title, author, info.description, info.icon_url))
}

async fn get_team_owner(team_id: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct TeamMember {
        user: TeamUser,
        role: String,
    }

    #[derive(Deserialize)]
    struct TeamUser {
        username: String,
    }

    let client = reqwest::Client::new();
    let url = format!("https://api.modrinth.com/v2/team/{}/members", team_id);

    let resp = client
        .get(&url)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    let members: Vec<TeamMember> = resp.json().await.ok()?;

    // Find owner or first member
    members
        .iter()
        .find(|m| m.role.to_lowercase() == "owner")
        .or_else(|| members.first())
        .map(|m| m.user.username.clone())
}

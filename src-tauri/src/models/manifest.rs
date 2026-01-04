use super::ModLoader;
use serde::{Deserialize, Serialize};

// CurseForge manifest.json structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeManifest {
    pub minecraft: CurseForgeMinecraftInfo,
    pub manifest_type: String,
    pub manifest_version: i32,
    pub name: String,
    pub version: String,
    pub author: String,
    pub files: Vec<CurseForgeFile>,
    pub overrides: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeMinecraftInfo {
    pub version: String,
    pub mod_loaders: Vec<CurseForgeModLoader>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeModLoader {
    pub id: String,
    pub primary: bool,
}

impl CurseForgeModLoader {
    pub fn to_mod_loader(&self) -> (ModLoader, String) {
        let id = self.id.to_lowercase();
        if id.starts_with("fabric-") {
            (ModLoader::Fabric, id.replace("fabric-", ""))
        } else if id.starts_with("forge-") {
            (ModLoader::Forge, id.replace("forge-", ""))
        } else if id.starts_with("neoforge-") {
            (ModLoader::NeoForge, id.replace("neoforge-", ""))
        } else if id.starts_with("quilt-") {
            (ModLoader::Quilt, id.replace("quilt-", ""))
        } else {
            (ModLoader::Vanilla, String::new())
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeFile {
    pub project_id: u64,
    pub file_id: u64,
    pub required: bool,
}

// Modrinth modrinth.index.json structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthManifest {
    pub format_version: i32,
    pub game: String,
    pub version_id: String,
    pub name: String,
    pub summary: Option<String>,
    pub files: Vec<ModrinthFile>,
    pub dependencies: ModrinthDependencies,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthFile {
    pub path: String,
    pub hashes: ModrinthHashes,
    #[serde(default)]
    pub env: Option<ModrinthEnv>,
    pub downloads: Vec<String>,
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthHashes {
    pub sha1: String,
    pub sha512: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthEnv {
    pub client: Option<String>,
    pub server: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct ModrinthDependencies {
    pub minecraft: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fabric_loader: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forge: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub neoforge: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quilt_loader: Option<String>,
}

impl ModrinthDependencies {
    pub fn get_loader(&self) -> (ModLoader, Option<String>) {
        if let Some(version) = &self.fabric_loader {
            return (ModLoader::Fabric, Some(version.clone()));
        }
        if let Some(version) = &self.forge {
            return (ModLoader::Forge, Some(version.clone()));
        }
        if let Some(version) = &self.neoforge {
            return (ModLoader::NeoForge, Some(version.clone()));
        }
        if let Some(version) = &self.quilt_loader {
            return (ModLoader::Quilt, Some(version.clone()));
        }
        (ModLoader::Vanilla, None)
    }
}

// Generic modpack info for search results
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub mc_version: String,
    pub loader: ModLoader,
    pub loader_version: String,
    pub source: ModpackSource,
    pub source_id: Option<String>,
    #[serde(default)]
    pub categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ModpackSource {
    CurseForge,
    Modrinth,
    Local,
}

// Server Modpack Plan (JSON from Backend)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerModpackPlan {
    pub name: String,
    pub version: String,
    pub minecraft_version: String,
    pub mod_loader: CurseForgeModLoader, // Reuse CF loader struct for convenience if it matches
    pub files: Option<Vec<ServerModFile>>, // Made optional because explicit bundle replaces it
    pub overrides_url: Option<String>,
    pub is_bundle: Option<bool>,
    pub bundle_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerModFile {
    pub project_id: u64,
    pub file_id: u64,
    pub download_url: String,
    pub file_name: Option<String>,
}

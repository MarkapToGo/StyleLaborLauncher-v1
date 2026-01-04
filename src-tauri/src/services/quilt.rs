use crate::utils::{paths, DownloadManager, DownloadTask};
use reqwest::Client;
use serde::{Deserialize, Serialize};

const QUILT_META_URL: &str = "https://meta.quiltmc.org/v3";

pub struct QuiltInstaller {
    client: Client,
    download_manager: DownloadManager,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuiltLoaderVersion {
    pub loader: QuiltLoaderInfo,
    pub hashed: Option<HashedInfo>,
    pub intermediary: Option<IntermediaryInfo>,
    pub launcher_meta: QuiltLauncherMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuiltLoaderInfo {
    pub separator: String,
    pub build: u32,
    pub maven: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HashedInfo {
    pub maven: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntermediaryInfo {
    pub maven: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuiltLauncherMeta {
    pub version: u32,
    pub min_java_version: Option<u32>,
    pub libraries: QuiltLibraries,
    pub main_class: QuiltMainClass,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuiltLibraries {
    pub client: Vec<QuiltLibrary>,
    pub common: Vec<QuiltLibrary>,
    pub server: Vec<QuiltLibrary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuiltLibrary {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum QuiltMainClass {
    Simple(String),
    Complex { client: String, server: String },
}

impl QuiltMainClass {
    pub fn client(&self) -> &str {
        match self {
            QuiltMainClass::Simple(s) => s,
            QuiltMainClass::Complex { client, .. } => client,
        }
    }
}

impl QuiltInstaller {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent("StyleLaborLauncher/0.1.0")
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            download_manager: DownloadManager::new(8),
        }
    }

    pub async fn get_loader_versions(
        &self,
        mc_version: &str,
    ) -> Result<Vec<QuiltLoaderVersion>, String> {
        let url = format!("{}/versions/loader/{}", QUILT_META_URL, mc_version);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!("Quilt meta error: {}", response.status()));
        }

        response.json().await.map_err(|e| e.to_string())
    }

    pub async fn install(
        &self,
        mc_version: &str,
        loader_version: Option<&str>,
    ) -> Result<String, String> {
        // Get loader versions
        let versions = self.get_loader_versions(mc_version).await?;

        if versions.is_empty() {
            return Err(format!(
                "No Quilt loader found for Minecraft {}",
                mc_version
            ));
        }

        // Use specified version or latest
        let version = if let Some(v) = loader_version {
            versions
                .iter()
                .find(|lv| lv.loader.version == v)
                .ok_or_else(|| format!("Quilt loader {} not found", v))?
        } else {
            versions.first().ok_or("No Quilt loader available")?
        };

        log::info!(
            "Installing Quilt {} for MC {}",
            version.loader.version,
            mc_version
        );

        // Download libraries
        let mut tasks = Vec::new();
        let libraries_dir = paths::get_libraries_dir();

        for lib in version
            .launcher_meta
            .libraries
            .common
            .iter()
            .chain(version.launcher_meta.libraries.client.iter())
        {
            if let Some(path) = paths::maven_to_path(&lib.name) {
                let dest = libraries_dir.join(&path);
                tasks.push(DownloadTask {
                    url: format!("{}{}", lib.url, path),
                    path: dest.to_string_lossy().to_string(),
                    size: lib.size,
                    sha1: lib.sha1.clone(),
                    sha512: None,
                });
            }
        }

        // Download hashed/intermediary
        if let Some(hashed) = &version.hashed {
            if let Some(path) = paths::maven_to_path(&hashed.maven) {
                let dest = libraries_dir.join(&path);
                tasks.push(DownloadTask {
                    url: format!("https://maven.quiltmc.org/repository/release/{}", path),
                    path: dest.to_string_lossy().to_string(),
                    size: None,
                    sha1: None,
                    sha512: None,
                });
            }
        }

        // Download loader
        if let Some(path) = paths::maven_to_path(&version.loader.maven) {
            let dest = libraries_dir.join(&path);
            tasks.push(DownloadTask {
                url: format!("https://maven.quiltmc.org/repository/release/{}", path),
                path: dest.to_string_lossy().to_string(),
                size: None,
                sha1: None,
                sha512: None,
            });
        }

        // Execute downloads
        let results = self.download_manager.download_many(tasks).await;

        for result in results {
            if let Err(e) = result {
                log::error!("Download failed: {}", e);
                return Err(format!("Failed to download Quilt library: {}", e));
            }
        }

        Ok(version.loader.version.clone())
    }
}

impl Default for QuiltInstaller {
    fn default() -> Self {
        Self::new()
    }
}

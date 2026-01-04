use crate::utils::{paths, DownloadManager, DownloadTask};
use reqwest::Client;
use serde::{Deserialize, Serialize};

const FABRIC_META_URL: &str = "https://meta.fabricmc.net/v2";

pub struct FabricInstaller {
    client: Client,
    download_manager: DownloadManager,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricLoaderVersion {
    pub loader: LoaderInfo,
    pub intermediary: IntermediaryInfo,
    #[serde(rename = "launcherMeta")]
    pub launcher_meta: LauncherMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoaderInfo {
    pub separator: String,
    pub build: u32,
    pub maven: String,
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntermediaryInfo {
    pub maven: String,
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherMeta {
    pub version: u32,
    #[serde(default)]
    pub min_java_version: Option<u32>,
    pub libraries: LibrariesSection,
    pub main_class: MainClass,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibrariesSection {
    pub client: Vec<FabricLibrary>,
    pub common: Vec<FabricLibrary>,
    pub server: Vec<FabricLibrary>,
    #[serde(default)]
    pub development: Vec<FabricLibrary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricLibrary {
    pub name: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub md5: Option<String>,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub sha512: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MainClass {
    Simple(String),
    Complex { client: String, server: String },
}

impl MainClass {
    pub fn client(&self) -> &str {
        match self {
            MainClass::Simple(s) => s,
            MainClass::Complex { client, .. } => client,
        }
    }
}

impl FabricInstaller {
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
    ) -> Result<Vec<FabricLoaderVersion>, String> {
        let url = format!("{}/versions/loader/{}", FABRIC_META_URL, mc_version);
        log::debug!("Fetching Fabric loader versions from: {}", url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Fabric Meta API: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            log::error!("Fabric Meta API error: {} - {}", status, body);
            return Err(format!(
                "Fabric meta error for MC {}: {} (is this a valid Minecraft version?)",
                mc_version, status
            ));
        }

        // Get response body as text for better error handling
        let body = response
            .text()
            .await
            .map_err(|e| format!("Failed to read Fabric API response: {}", e))?;

        // Try to parse JSON
        serde_json::from_str(&body).map_err(|e| {
            log::error!(
                "Failed to parse Fabric API response: {} - Body: {:.200}...",
                e,
                body
            );
            format!("Failed to parse Fabric API response: {}", e)
        })
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
                "No Fabric loader found for Minecraft {}",
                mc_version
            ));
        }

        // Use specified version or latest stable
        let version = if let Some(v) = loader_version {
            versions
                .iter()
                .find(|lv| lv.loader.version == v)
                .ok_or_else(|| format!("Fabric loader {} not found", v))?
        } else {
            versions
                .iter()
                .find(|lv| lv.loader.stable)
                .or(versions.first())
                .ok_or("No Fabric loader available")?
        };

        log::info!(
            "Installing Fabric {} for MC {}",
            version.loader.version,
            mc_version
        );

        // Download libraries
        let mut tasks = Vec::new();
        let libraries_dir = paths::get_libraries_dir();

        // Add common and client libraries
        for lib in version
            .launcher_meta
            .libraries
            .common
            .iter()
            .chain(version.launcher_meta.libraries.client.iter())
        {
            // Skip libraries without URLs (usually already bundled in the JAR)
            if lib.url.is_none() {
                continue;
            }

            if let Some(path) = paths::maven_to_path(&lib.name) {
                let dest = libraries_dir.join(&path);
                let base_url = lib.url.as_ref().unwrap();
                tasks.push(DownloadTask {
                    url: format!("{}{}", base_url, path),
                    path: dest.to_string_lossy().to_string(),
                    size: lib.size,
                    sha1: lib.sha1.clone(),
                    sha512: None,
                });
            }
        }

        // Download intermediary
        if let Some(path) = paths::maven_to_path(&version.intermediary.maven) {
            let dest = libraries_dir.join(&path);
            tasks.push(DownloadTask {
                url: format!("https://maven.fabricmc.net/{}", path),
                path: dest.to_string_lossy().to_string(),
                size: None,
                sha1: None,
                sha512: None,
            });
        }

        // Download loader
        if let Some(path) = paths::maven_to_path(&version.loader.maven) {
            let dest = libraries_dir.join(&path);
            tasks.push(DownloadTask {
                url: format!("https://maven.fabricmc.net/{}", path),
                path: dest.to_string_lossy().to_string(),
                size: None,
                sha1: None,
                sha512: None,
            });
        }

        // Execute downloads
        let results = self.download_manager.download_many(tasks).await;

        // Check for errors
        for result in results {
            if let Err(e) = result {
                log::error!("Download failed: {}", e);
                return Err(format!("Failed to download Fabric library: {}", e));
            }
        }

        Ok(version.loader.version.clone())
    }

    pub fn get_main_class(&self, loader_version: &FabricLoaderVersion) -> String {
        loader_version.launcher_meta.main_class.client().to_string()
    }
}

impl Default for FabricInstaller {
    fn default() -> Self {
        Self::new()
    }
}

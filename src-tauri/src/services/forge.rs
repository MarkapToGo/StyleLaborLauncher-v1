use crate::utils::DownloadManager;
use reqwest::Client;

/// Forge installer - handles downloading and installing Forge
/// Note: Forge installation is more complex than Fabric/Quilt and may require
/// running Java processors for some versions.
#[allow(dead_code)]
pub struct ForgeInstaller {
    client: Client,
    download_manager: DownloadManager,
}

impl ForgeInstaller {
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

    pub async fn install(&self, mc_version: &str, forge_version: &str) -> Result<String, String> {
        log::info!("Installing Forge {} for MC {}", forge_version, mc_version);

        // Forge installation is complex:
        // 1. Download installer JAR from Maven
        // 2. Extract version.json and install_profile.json
        // 3. Download all libraries
        // 4. Run processors (requires Java)

        // For older Forge versions (< 1.13), it's simpler:
        // Just download the universal JAR and libraries

        // For now, return a placeholder
        Err(
            "Forge installation not yet implemented. Forge requires running Java processors."
                .to_string(),
        )
    }

    pub async fn get_installer_url(&self, mc_version: &str, forge_version: &str) -> String {
        format!(
            "https://maven.minecraftforge.net/net/minecraftforge/forge/{mc_version}-{forge_version}/forge-{mc_version}-{forge_version}-installer.jar",
            mc_version = mc_version,
            forge_version = forge_version
        )
    }
}

impl Default for ForgeInstaller {
    fn default() -> Self {
        Self::new()
    }
}

use reqwest::Client;
use serde::{Deserialize, Serialize};

const CURSEFORGE_API_BASE: &str = "http://localhost:3000/api";

pub struct CurseForgeClient {
    client: Client,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct SearchResponse {
    data: Vec<CurseForgeProject>,
    pagination: Option<Pagination>, // Backend might not return pagination
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct Pagination {
    index: u32,
    page_size: u32,
    result_count: u32,
    total_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeProject {
    pub id: u64,
    pub name: String,
    pub slug: String,
    pub summary: String,
    pub status: u32,
    pub primary_category_id: u32,
    pub categories: Vec<Category>,
    pub authors: Vec<Author>,
    pub logo: Option<Logo>,
    pub main_file_id: Option<u64>,
    pub date_created: String,
    pub date_modified: String,
    pub date_released: String,
    pub allow_mod_distribution: Option<bool>,
    pub game_popularity_rank: u32,
    pub latest_files: Vec<CurseForgeFileInfo>,
    pub latest_files_indexes: Vec<FileIndex>,
    pub download_count: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: u32,
    pub name: String,
    pub slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Author {
    pub id: u32,
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Logo {
    pub id: u32,
    pub mod_id: u64,
    pub title: String,
    pub description: String,
    pub thumbnail_url: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeFileInfo {
    pub id: u64,
    pub game_id: u32,
    pub mod_id: u64,
    pub is_available: bool,
    pub display_name: String,
    pub file_name: String,
    pub release_type: u32,
    pub file_status: u32,
    pub hashes: Vec<FileHash>,
    pub file_date: String,
    pub file_length: u64,
    pub download_count: u64,
    pub download_url: Option<String>,
    pub game_versions: Vec<String>,
    pub sortable_game_versions: Vec<SortableGameVersion>,
    pub dependencies: Vec<Dependency>,
    pub is_server_pack: Option<bool>,
    pub file_fingerprint: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileHash {
    pub value: String,
    pub algo: u32, // 1 = SHA1, 2 = MD5
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortableGameVersion {
    pub game_version_name: String,
    pub game_version_padded: String,
    pub game_version: String,
    pub game_version_release_date: String,
    pub game_version_type_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    pub mod_id: u64,
    pub relation_type: u32, // 1 = embedded, 2 = optional, 3 = required
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIndex {
    pub game_version: String,
    pub file_id: u64,
    pub filename: String,
    pub release_type: u32,
    pub game_version_type_id: Option<u32>,
    pub mod_loader: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct FileResponse {
    data: CurseForgeFileInfo,
}

#[derive(Debug, Deserialize)]
struct FilesResponse {
    data: Vec<CurseForgeFileInfo>,
}

#[derive(Debug, Deserialize)]
struct DownloadUrlResponse {
    data: String,
}

impl CurseForgeClient {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent("StyleLaborLauncher/0.1.0")
            .build()
            .expect("Failed to create HTTP client");

        Self { client }
    }

    pub async fn search_modpacks(
        &self,
        _query: &str, // Ignored by backend allowlist
        _page: u32,   // Ignored by backend allowlist currently
    ) -> Result<Vec<CurseForgeProject>, String> {
        let url = format!("{}/modpacks", CURSEFORGE_API_BASE);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!("Backend API error: {}", response.status()));
        }

        // Backend returns Vec<CurseForgeProject> directly, OR wrapped?
        // My backend: `res.json(modsResponse.data.data)` -> Returns Array of Objects.
        // Rust expects `SearchResponse`? No, I should deserialize directly to Vec if backend returns Vec.
        // BUT my backend mocks CF structure? No.
        // Backend: `res.json(modsResponse.data.data)`. This is `Vec<CurseForgeProject>`.
        // The existing code expected `SearchResponse { data: ..., pagination ... }`.

        let projects: Vec<CurseForgeProject> = response.json().await.map_err(|e| e.to_string())?;
        Ok(projects)
    }

    pub async fn get_file(&self, mod_id: u64, file_id: u64) -> Result<CurseForgeFileInfo, String> {
        let url = format!(
            "{}/modpacks/{}/files/{}",
            CURSEFORGE_API_BASE, mod_id, file_id
        );

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!("Backend API error: {}", response.status()));
        }

        let file_result: FileResponse = response.json().await.map_err(|e| e.to_string())?;
        Ok(file_result.data)
    }

    pub async fn get_files(&self, file_ids: Vec<u64>) -> Result<Vec<CurseForgeFileInfo>, String> {
        let url = format!("{}/modpacks/files", CURSEFORGE_API_BASE);

        #[derive(Serialize)]
        struct FileIdsBody {
            #[serde(rename = "fileIds")]
            file_ids: Vec<u64>,
        }

        let response = self
            .client
            .post(&url)
            .json(&FileIdsBody { file_ids })
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!("Backend API error: {}", response.status()));
        }

        let files_result: FilesResponse = response.json().await.map_err(|e| e.to_string())?;
        Ok(files_result.data)
    }

    pub async fn get_download_url(&self, mod_id: u64, file_id: u64) -> Result<String, String> {
        // First try to get from file info using get_file which hits backend
        let file = self.get_file(mod_id, file_id).await?;

        if let Some(url) = file.download_url {
            return Ok(url);
        }

        // If download_url is null (shouldn't be with backend rewrite), try the endpoint
        let url = format!(
            "{}/modpacks/{}/files/{}/download-url",
            CURSEFORGE_API_BASE, mod_id, file_id
        );

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!("Backend API error: {}", response.status()));
        }

        let url_result: DownloadUrlResponse = response.json().await.map_err(|e| e.to_string())?;
        Ok(url_result.data)
    }
}

impl Default for CurseForgeClient {
    fn default() -> Self {
        Self::new()
    }
}

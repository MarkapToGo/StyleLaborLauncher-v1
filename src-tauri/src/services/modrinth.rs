use anyhow::Result;
use serde::{Deserialize, Serialize};

const MODRINTH_API_BASE: &str = "https://api.modrinth.com/v2";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthSearchResult {
    pub project_id: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub author: String,
    pub slug: String,
    pub downloads: u64,
    pub follows: u64,
}

#[derive(Debug, Clone, Deserialize)]
struct SearchResponse {
    hits: Vec<SearchHit>,
}

#[derive(Debug, Clone, Deserialize)]
struct SearchHit {
    project_id: String,
    title: String,
    description: String,
    icon_url: Option<String>,
    author: String,
    slug: String,
    downloads: u64,
    follows: u64,
}

#[derive(Debug, Deserialize)]
pub struct ModrinthVersion {
    pub id: String,
    pub files: Vec<ModrinthFile>,
    pub version_number: String,
    pub dependencies: Option<Vec<ModrinthDependency>>,
}

#[derive(Debug, Deserialize)]
pub struct ModrinthFile {
    pub url: String,
    pub filename: String,
    pub primary: bool,
}

#[derive(Debug, Deserialize)]
pub struct ModrinthDependency {
    pub version_id: Option<String>,
    pub project_id: Option<String>,
    pub dependency_type: String, // "required", "optional", "incompatible"
}

pub struct ModrinthApi;

impl ModrinthApi {
    pub async fn search_mods(
        query: &str,
        mc_version: &str,
        loader: &str,
        project_type: Option<&str>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<ModrinthSearchResult>> {
        let client = reqwest::Client::new();

        // facets=[["dependencies:fabric"], ["versions:1.20.1"]]
        // Modrinth uses a specific facet syntax.
        // loaders: "categories:fabric"
        // versions: "versions:1.20.1"

        let version_facet = format!("versions:{}", mc_version);
        let project_type_str = project_type.unwrap_or("mod");

        // Only filter by loader for mods - resourcepacks and shaders don't have loaders
        let facets = if project_type_str == "mod" {
            let loader_facet = format!("categories:{}", loader.to_lowercase());
            format!(
                "[[\"{}\"],[\"{}\"],[\"project_type:{}\"]]",
                loader_facet, version_facet, project_type_str
            )
        } else {
            format!(
                "[[\"{}\"],[\"project_type:{}\"]]",
                version_facet, project_type_str
            )
        };

        let limit_str = limit.unwrap_or(20).to_string();
        let offset_str = offset.unwrap_or(0).to_string();

        let url = format!("{}/search", MODRINTH_API_BASE);
        let resp = client
            .get(&url)
            .query(&[
                ("query", query),
                ("facets", &facets.as_str()),
                ("limit", &limit_str.as_str()),
                ("offset", &offset_str.as_str()),
                ("index", "downloads"),
            ])
            .send()
            .await?
            .error_for_status()?;

        let search_resp: SearchResponse = resp.json().await?;

        let results = search_resp
            .hits
            .into_iter()
            .map(|hit| ModrinthSearchResult {
                project_id: hit.project_id,
                title: hit.title,
                description: hit.description,
                icon_url: hit.icon_url,
                author: hit.author,
                slug: hit.slug,
                downloads: hit.downloads,
                follows: hit.follows,
            })
            .collect();

        Ok(results)
    }

    pub async fn get_version(
        project_id: &str,
        mc_version: &str,
        loader: Option<&str>,
    ) -> Result<Option<ModrinthVersion>> {
        let client = reqwest::Client::new();
        let url = format!("{}/project/{}/version", MODRINTH_API_BASE, project_id);

        // Build query - only include loaders if provided (mods have loaders, resourcepacks/shaders don't)
        let game_versions = format!("[\"{}\"]", mc_version);

        let resp = if let Some(loader_str) = loader {
            let loaders = format!("[\"{}\"]", loader_str.to_lowercase());
            client
                .get(&url)
                .query(&[("loaders", loaders), ("game_versions", game_versions)])
                .send()
                .await?
        } else {
            client
                .get(&url)
                .query(&[("game_versions", game_versions)])
                .send()
                .await?
        };

        let resp = resp.error_for_status()?;
        let versions: Vec<ModrinthVersion> = resp.json().await?;

        // Sort by something? Modrinth usually returns latest first but let's be safe if we care.
        // For now, take the first one (latest).
        Ok(versions.into_iter().next())
    }

    pub async fn get_version_from_id(version_id: &str) -> Result<ModrinthVersion> {
        let client = reqwest::Client::new();
        let url = format!("{}/version/{}", MODRINTH_API_BASE, version_id);

        let resp = client.get(&url).send().await?.error_for_status()?;

        let version: ModrinthVersion = resp.json().await?;
        Ok(version)
    }
}

use crate::utils::{paths, DownloadManager, DownloadTask};
use reqwest::Client;
use serde_json::Value;
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::PathBuf;
use tokio::process::Command;
use uuid::Uuid;

/// NeoForge installer - similar to Forge but uses NeoForge Maven
pub struct NeoForgeInstaller {
    client: Client,
    download_manager: DownloadManager,
}

impl NeoForgeInstaller {
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

    /// Resolve the latest stable NeoForge version for a given Minecraft version (e.g. 1.21.1 -> 21.1.*).
    pub async fn get_latest_stable_for_mc(&self, mc_version: &str) -> Result<String, String> {
        let prefix = mc_to_neoforge_prefix(mc_version)?;
        // NeoForge maven metadata (some setups use /releases, some don't).
        let metadata_urls = [
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
            "https://maven.neoforged.net/net/neoforged/neoforge/maven-metadata.xml",
        ];

        let mut last_err: Option<String> = None;
        let mut text: Option<String> = None;
        for url in metadata_urls {
            match self
                .client
                .get(url)
                .send()
                .await
                .and_then(|r| r.error_for_status())
            {
                Ok(resp) => match resp.text().await {
                    Ok(t) => {
                        text = Some(t);
                        last_err = None;
                        break;
                    }
                    Err(e) => {
                        last_err = Some(format!("Failed to read NeoForge maven metadata: {}", e))
                    }
                },
                Err(e) => {
                    last_err = Some(format!("Failed to fetch NeoForge maven metadata: {}", e))
                }
            }
        }

        let text = text.ok_or_else(|| {
            last_err.unwrap_or_else(|| "Failed to fetch NeoForge maven metadata".to_string())
        })?;

        let mut versions = extract_versions_from_maven_metadata(&text);
        versions.retain(|v| v.starts_with(&(prefix.clone() + ".")) || v == &prefix);
        versions.retain(|v| is_stable_version(v));

        if versions.is_empty() {
            return Err(format!(
                "No stable NeoForge versions found for Minecraft {} (expected prefix {})",
                mc_version, prefix
            ));
        }

        versions.sort_by(|a, b| compare_version_desc(a, b));
        Ok(versions[0].clone())
    }

    pub async fn install(
        &self,
        mc_version: &str,
        neoforge_version: &str,
        java_path: &str,
    ) -> Result<String, String> {
        log::info!(
            "Installing NeoForge {} for MC {}",
            neoforge_version,
            mc_version
        );

        // NeoForge installation:
        // 1) Download installer JAR from NeoForge Maven (store under libraries/ like standard launchers)
        // 2) Extract embedded `maven/` artifacts into libraries/ (matches NoRiskClient + avoids missing jars)
        // 3) Run `--installClient` into our launcher dir (acts like `.minecraft`)
        // 4) Determine installed version id from install_profile.json
        // 5) Ensure all libraries referenced by the installed version json exist (download missing ones)

        let launcher_dir = paths::get_launcher_dir();
        paths::ensure_dir(&launcher_dir).map_err(|e| e.to_string())?;
        paths::ensure_dir(&paths::get_versions_dir()).map_err(|e| e.to_string())?;
        paths::ensure_dir(&paths::get_libraries_dir()).map_err(|e| e.to_string())?;
        ensure_launcher_profiles_json(&launcher_dir).map_err(|e| e.to_string())?;

        // Store installer in libraries/ like Maven-based layout:
        // libraries/net/neoforged/neoforge/<ver>/neoforge-<ver>-installer.jar
        let libraries_dir = paths::get_libraries_dir();
        let maven_rel = neoforge_installer_maven_path(neoforge_version);
        let installer_path = libraries_dir.join(&maven_rel);

        if installer_path.exists() {
            log::info!(
                "NeoForge installer already present: {}",
                installer_path.display()
            );
        } else {
            let mut last_err: Option<String> = None;
            for url in self.get_installer_url_candidates(neoforge_version).await {
                let task = DownloadTask {
                    url: url.clone(),
                    path: installer_path.to_string_lossy().to_string(),
                    size: None,
                    sha1: None,
                    sha512: None,
                };

                log::info!("Downloading NeoForge installer: {}", url);
                match self.download_manager.download_file(&task).await {
                    Ok(()) => {
                        last_err = None;
                        break;
                    }
                    Err(e) => {
                        last_err = Some(e.to_string());
                        log::warn!("NeoForge installer download failed for {}: {}", url, e);
                    }
                }
            }

            if let Some(e) = last_err {
                return Err(format!("Failed to download NeoForge installer: {}", e));
            }
        }

        // Extract embedded Maven artifacts (NoRiskClient does this; it helps avoid missing client jars).
        if let Err(e) = extract_maven_folder_from_installer(&installer_path, &libraries_dir) {
            log::warn!("Failed to extract NeoForge embedded maven folder: {}", e);
        }

        // Determine expected version id from the installer jar (best-effort).
        let expected_version_id = read_installed_version_id_from_installer(&installer_path)
            .unwrap_or_else(|| format!("{}-neoforge-{}", mc_version, neoforge_version));

        log::info!(
            "Running NeoForge installer (java={}): expected_version_id={}",
            java_path,
            expected_version_id
        );

        let output = Command::new(java_path)
            .arg("-jar")
            .arg(&installer_path)
            // NeoForge installer expects: `--installClient <dir>` (no separate minecraftDir flag)
            .arg("--installClient")
            .arg(&launcher_dir)
            .current_dir(&launcher_dir)
            .output()
            .await
            .map_err(|e| format!("Failed to run NeoForge installer: {}", e))?;

        if !output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::error!("NeoForge installer failed (status={}):", output.status);
            if !stdout.trim().is_empty() {
                log::error!("[NeoForge installer stdout]\n{}", stdout);
            }
            if !stderr.trim().is_empty() {
                log::error!("[NeoForge installer stderr]\n{}", stderr);
            }
            return Err(format!(
                "NeoForge installer failed with status {}",
                output.status
            ));
        }

        // Prefer the expected version id if it exists; otherwise scan for the installed version.
        let versions_dir = paths::get_versions_dir();
        let expected_json = paths::get_version_json(&expected_version_id);
        if expected_json.exists() {
            log::info!("NeoForge installed: version_id={}", expected_version_id);
            // Ensure libraries exist for this installed version.
            self.ensure_libraries_for_installed_version(&expected_version_id)
                .await?;
            return Ok(expected_version_id);
        }

        if let Some(found) =
            find_installed_neoforge_version_id(&versions_dir, mc_version, neoforge_version)
        {
            log::info!("NeoForge installed: version_id={}", found);
            // Ensure libraries exist for this installed version.
            self.ensure_libraries_for_installed_version(&found).await?;
            return Ok(found);
        }

        Err("NeoForge install completed but installed version json was not found".to_string())
    }

    pub async fn get_installer_url_candidates(&self, neoforge_version: &str) -> Vec<String> {
        // NeoForge version format is like "21.1.77" for MC 1.21.1
        // NoRiskClient uses the non-/releases form; support both.
        vec![
            format!(
                "https://maven.neoforged.net/releases/net/neoforged/neoforge/{version}/neoforge-{version}-installer.jar",
                version = neoforge_version
            ),
            format!(
                "https://maven.neoforged.net/net/neoforged/neoforge/{version}/neoforge-{version}-installer.jar",
                version = neoforge_version
            ),
        ]
    }

    async fn ensure_libraries_for_installed_version(&self, version_id: &str) -> Result<(), String> {
        let libraries_dir = paths::get_libraries_dir();
        paths::ensure_dir(&libraries_dir).map_err(|e| e.to_string())?;

        let libs = load_libraries_with_inheritance(version_id).await?;
        let mut tasks: Vec<DownloadTask> = Vec::new();
        let mut seen_dest: HashSet<String> = HashSet::new();

        for lib_val in libs {
            if !library_rules_allow(&lib_val) {
                continue;
            }

            // 1) downloads.artifact (preferred modern format)
            if let Some(artifact) = lib_val
                .get("downloads")
                .and_then(|d| d.get("artifact"))
                .and_then(|a| a.as_object())
            {
                if let (Some(path), Some(url)) = (
                    artifact.get("path").and_then(|p| p.as_str()),
                    artifact.get("url").and_then(|u| u.as_str()),
                ) {
                    let dest = libraries_dir.join(path);
                    if !dest.exists() {
                        let dest_s = dest.to_string_lossy().to_string();
                        if seen_dest.insert(dest_s.clone()) {
                            tasks.push(DownloadTask {
                                url: url.to_string(),
                                path: dest_s,
                                size: artifact.get("size").and_then(|s| s.as_u64()),
                                sha1: artifact
                                    .get("sha1")
                                    .and_then(|s| s.as_str())
                                    .map(|s| s.to_string()),
                                sha512: None,
                            });
                        }
                    }
                }
            } else if let Some(name) = lib_val.get("name").and_then(|n| n.as_str()) {
                // 2) Maven coordinate fallback using library.url (Forge/NeoForge often use this)
                if let Some(rel) = paths::maven_to_path(name) {
                    let base = lib_val
                        .get("url")
                        .and_then(|u| u.as_str())
                        .unwrap_or("https://libraries.minecraft.net/");
                    let url = join_base_and_rel_url(base, &rel);
                    let dest = libraries_dir.join(&rel);
                    if !dest.exists() {
                        let dest_s = dest.to_string_lossy().to_string();
                        if seen_dest.insert(dest_s.clone()) {
                            tasks.push(DownloadTask {
                                url,
                                path: dest_s,
                                size: None,
                                sha1: None,
                                sha512: None,
                            });
                        }
                    }
                }
            }

            // 3) Natives (only current OS classifier)
            let natives_classifier = lib_val
                .get("natives")
                .and_then(|n| n.get(current_os_key()))
                .and_then(|c| c.as_str());

            if let Some(classifier_key) = natives_classifier {
                // Prefer downloads.classifiers if present
                if let Some(classifiers) = lib_val
                    .get("downloads")
                    .and_then(|d| d.get("classifiers"))
                    .and_then(|c| c.as_object())
                {
                    if let Some(native_obj) =
                        classifiers.get(classifier_key).and_then(|x| x.as_object())
                    {
                        if let (Some(path), Some(url)) = (
                            native_obj.get("path").and_then(|p| p.as_str()),
                            native_obj.get("url").and_then(|u| u.as_str()),
                        ) {
                            let dest = libraries_dir.join(path);
                            if !dest.exists() {
                                let dest_s = dest.to_string_lossy().to_string();
                                if seen_dest.insert(dest_s.clone()) {
                                    tasks.push(DownloadTask {
                                        url: url.to_string(),
                                        path: dest_s,
                                        size: native_obj.get("size").and_then(|s| s.as_u64()),
                                        sha1: native_obj
                                            .get("sha1")
                                            .and_then(|s| s.as_str())
                                            .map(|s| s.to_string()),
                                        sha512: None,
                                    });
                                }
                            }
                        }
                    }
                } else if let Some(name) = lib_val.get("name").and_then(|n| n.as_str()) {
                    // Maven coordinate fallback for natives
                    if let Some(coord) = append_classifier_to_maven_coord(name, classifier_key) {
                        if let Some(rel) = paths::maven_to_path(&coord) {
                            let base = lib_val
                                .get("url")
                                .and_then(|u| u.as_str())
                                .unwrap_or("https://libraries.minecraft.net/");
                            let url = join_base_and_rel_url(base, &rel);
                            let dest = libraries_dir.join(&rel);
                            if !dest.exists() {
                                let dest_s = dest.to_string_lossy().to_string();
                                if seen_dest.insert(dest_s.clone()) {
                                    tasks.push(DownloadTask {
                                        url,
                                        path: dest_s,
                                        size: None,
                                        sha1: None,
                                        sha512: None,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        if tasks.is_empty() {
            log::info!("NeoForge libraries already present for {}", version_id);
            return Ok(());
        }

        log::info!(
            "Ensuring NeoForge libraries: {} downloads needed for version_id={}",
            tasks.len(),
            version_id
        );
        let results = self.download_manager.download_many(tasks).await;
        let mut errors: Vec<String> = Vec::new();
        for r in results {
            if let Err(e) = r {
                errors.push(e.to_string());
            }
        }
        if !errors.is_empty() {
            log::error!(
                "NeoForge library download had {} failures (showing first 5): {:?}",
                errors.len(),
                errors.iter().take(5).collect::<Vec<_>>()
            );
            return Err("Some NeoForge libraries failed to download".to_string());
        }

        Ok(())
    }
}

impl Default for NeoForgeInstaller {
    fn default() -> Self {
        Self::new()
    }
}

fn mc_to_neoforge_prefix(mc_version: &str) -> Result<String, String> {
    // NeoForge uses <mc_minor>.<mc_patch>.* (e.g. MC 1.21.1 => 21.1.*)
    let parts: Vec<&str> = mc_version.split('.').collect();
    if parts.len() < 3 {
        return Err(format!(
            "Invalid Minecraft version '{}'; expected like 1.21.1",
            mc_version
        ));
    }
    let minor = parts[1];
    let patch = parts[2];
    Ok(format!("{}.{}", minor, patch))
}

fn extract_versions_from_maven_metadata(xml: &str) -> Vec<String> {
    // Simple parser for <version>...</version> nodes.
    let mut out = Vec::new();
    let mut rest = xml;
    let open = "<version>";
    let close = "</version>";
    while let Some(s) = rest.find(open) {
        let after = &rest[(s + open.len())..];
        if let Some(e) = after.find(close) {
            let v = after[..e].trim();
            if !v.is_empty() {
                out.push(v.to_string());
            }
            rest = &after[(e + close.len())..];
        } else {
            break;
        }
    }
    out
}

fn is_stable_version(v: &str) -> bool {
    let lc = v.to_lowercase();
    !(lc.contains("alpha") || lc.contains("beta") || lc.contains("rc") || lc.contains("snapshot"))
}

fn compare_version_desc(a: &str, b: &str) -> std::cmp::Ordering {
    // Descending numeric compare of dot-separated segments.
    let pa = a
        .split('.')
        .map(|s| s.parse::<i64>().unwrap_or(-1))
        .collect::<Vec<_>>();
    let pb = b
        .split('.')
        .map(|s| s.parse::<i64>().unwrap_or(-1))
        .collect::<Vec<_>>();

    let n = pa.len().max(pb.len());
    for i in 0..n {
        let va = *pa.get(i).unwrap_or(&-1);
        let vb = *pb.get(i).unwrap_or(&-1);
        if va != vb {
            return vb.cmp(&va); // reverse for desc
        }
    }
    std::cmp::Ordering::Equal
}

fn ensure_launcher_profiles_json(launcher_dir: &PathBuf) -> Result<(), std::io::Error> {
    let path = paths::get_launcher_profiles_file();
    if path.exists() {
        return Ok(());
    }

    // Minimal Minecraft launcher_profiles.json so Forge/NeoForge installers can run in a custom directory.
    // The installers typically just check that this file exists and is parseable.
    let now = chrono::Utc::now().to_rfc3339();
    let client_token = Uuid::new_v4().to_string();

    let content = serde_json::json!({
        "profiles": {
            "StyleLaborLauncher": {
                "name": "StyleLaborLauncher",
                "type": "custom",
                "created": now,
                "lastUsed": now,
                "lastVersionId": "latest-release"
            }
        },
        "selectedProfile": "StyleLaborLauncher",
        "clientToken": client_token,
        "authenticationDatabase": {},
        "selectedUser": {}
    });

    // Ensure directory exists (should, but keep it robust)
    std::fs::create_dir_all(launcher_dir)?;
    std::fs::write(
        path,
        serde_json::to_string_pretty(&content).unwrap_or_default(),
    )?;
    Ok(())
}

fn read_installed_version_id_from_installer(installer_path: &PathBuf) -> Option<String> {
    let file = std::fs::File::open(installer_path).ok()?;
    let mut zip = zip::ZipArchive::new(file).ok()?;
    let mut entry = zip.by_name("install_profile.json").ok()?;

    let mut contents = String::new();
    entry.read_to_string(&mut contents).ok()?;
    let v: Value = serde_json::from_str(&contents).ok()?;

    // Common keys used by Forge/NeoForge installers across versions.
    if let Some(s) = v.get("version").and_then(|x| x.as_str()) {
        return Some(s.to_string());
    }
    if let Some(s) = v
        .get("install")
        .and_then(|x| x.get("profileName"))
        .and_then(|x| x.as_str())
    {
        return Some(s.to_string());
    }
    if let Some(s) = v.get("profileName").and_then(|x| x.as_str()) {
        return Some(s.to_string());
    }

    None
}

fn find_installed_neoforge_version_id(
    versions_dir: &PathBuf,
    mc_version: &str,
    neoforge_version: &str,
) -> Option<String> {
    let entries = std::fs::read_dir(versions_dir).ok()?;

    // Pick the most recently modified candidate directory that looks like NeoForge.
    let mut best: Option<(std::time::SystemTime, String)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let name_lc = name.to_lowercase();

        let looks_like = name_lc.contains("neoforge")
            && (name_lc.contains(&mc_version.to_lowercase()) || name_lc.contains(neoforge_version));
        if !looks_like {
            continue;
        }

        let json_path = paths::get_version_json(&name);
        if !json_path.exists() {
            continue;
        }

        let modified = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

        match &best {
            Some((best_time, _)) if modified <= *best_time => {}
            _ => best = Some((modified, name)),
        }
    }

    best.map(|(_, name)| name)
}

fn neoforge_installer_maven_path(neoforge_version: &str) -> String {
    format!(
        "net/neoforged/neoforge/{}/neoforge-{}-installer.jar",
        neoforge_version, neoforge_version
    )
}

fn join_base_and_rel_url(base: &str, rel: &str) -> String {
    if base.ends_with('/') {
        format!("{}{}", base, rel)
    } else {
        format!("{}/{}", base, rel)
    }
}

fn current_os_key() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

fn library_rules_allow(lib_val: &Value) -> bool {
    let rules = match lib_val.get("rules").and_then(|r| r.as_array()) {
        Some(r) => r,
        None => return true,
    };
    rules_allow(rules)
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
            .map(|n| n == current_os_key())
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

fn append_classifier_to_maven_coord(name: &str, classifier: &str) -> Option<String> {
    // Supports group:artifact:version[:classifier][:ext] and/or @ext
    let (coord, ext_at) = name
        .rsplit_once('@')
        .map(|(c, e)| (c, Some(e)))
        .unwrap_or((name, None));

    let parts: Vec<&str> = coord.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let group = parts[0];
    let artifact = parts[1];
    let version = parts[2];

    // Keep explicit extension if provided via @ext or parts[4]
    let ext = ext_at.or_else(|| parts.get(4).copied());

    let mut out = format!("{}:{}:{}:{}", group, artifact, version, classifier);
    if let Some(ext) = ext {
        out.push('@');
        out.push_str(ext);
    }
    Some(out)
}

fn extract_maven_folder_from_installer(
    installer_path: &PathBuf,
    libraries_dir: &PathBuf,
) -> Result<(), String> {
    let file = std::fs::File::open(installer_path)
        .map_err(|e| format!("Failed to open installer jar: {}", e))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| format!("Failed to read installer as zip: {}", e))?;

    let mut extracted = 0usize;
    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;

        if entry.is_dir() {
            continue;
        }

        let enclosed = match entry.enclosed_name() {
            Some(p) => p.to_owned(),
            None => continue,
        };
        let name = enclosed.to_string_lossy().replace('\\', "/");
        if !name.starts_with("maven/") {
            continue;
        }
        let rel = enclosed
            .strip_prefix("maven")
            .map_err(|e| format!("Invalid maven path in installer: {}", e))?;
        let target_path = libraries_dir.join(rel);
        if target_path.exists() {
            continue;
        }
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = std::fs::File::create(&target_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        out.flush().ok();
        extracted += 1;
    }

    if extracted > 0 {
        log::info!(
            "Extracted {} embedded NeoForge maven artifacts into {}",
            extracted,
            libraries_dir.display()
        );
    }
    Ok(())
}

async fn load_libraries_with_inheritance(version_id: &str) -> Result<Vec<Value>, String> {
    let mut visited: HashSet<String> = HashSet::new();
    let mut out: Vec<Value> = Vec::new();
    let mut current = Some(version_id.to_string());

    while let Some(id) = current {
        if !visited.insert(id.clone()) {
            break;
        }
        let json_path = paths::get_version_json(&id);
        let content = tokio::fs::read_to_string(&json_path)
            .await
            .map_err(|e| format!("Failed to read version json {}: {}", json_path.display(), e))?;
        let v: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

        if let Some(libs) = v.get("libraries").and_then(|x| x.as_array()) {
            out.extend(libs.iter().cloned());
        }

        current = v
            .get("inheritsFrom")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
    }

    Ok(out)
}

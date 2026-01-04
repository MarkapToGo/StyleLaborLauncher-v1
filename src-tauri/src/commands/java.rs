use crate::utils::paths::get_game_dir;
use reqwest::Client;
use std::fs;
use std::io::Cursor;
use tauri::command;

// Hardcoded URLs for Windows x64
const JAVA_8_URL: &str = "https://api.adoptium.net/v3/binary/latest/8/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk";
const JAVA_11_URL: &str = "https://api.adoptium.net/v3/binary/latest/11/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk";
const JAVA_17_URL: &str = "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk";
const JAVA_21_URL: &str = "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk";
const JAVA_25_URL: &str = "https://api.adoptium.net/v3/binary/latest/25/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk";

#[command]
pub async fn install_java_versions() -> Result<String, String> {
    let client = Client::new();
    let versions = [
        ("8", JAVA_8_URL),
        ("11", JAVA_11_URL),
        ("17", JAVA_17_URL),
        ("21", JAVA_21_URL),
        ("25", JAVA_25_URL),
    ];

    let base_path = get_game_dir().join("runtimes").join("java");
    if !base_path.exists() {
        fs::create_dir_all(&base_path).map_err(|e| e.to_string())?;
    }

    let mut installed_versions = Vec::new();

    for (version, url) in versions {
        let version_path = base_path.join(version);
        if version_path.exists() {
            // Already installed (naive check: folder exists)
            // We could check for validity, but for now skip to save time/bandwidth
            installed_versions.push(version.to_string());
            continue;
        }

        // Download
        let response = client.get(url).send().await.map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "Failed to download Java {}: Status {}",
                version,
                response.status()
            ));
        }

        let bytes = response.bytes().await.map_err(|e| e.to_string())?;

        // Extract using zip crate
        let reader = Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;

        // We want to extract to `runtimes/java/<version>/`
        // The zip usually contains a top-level folder (e.g. "jdk-17.0.x...").
        // We want to strip that top level folder or just extract everything into `version_path`

        // Let's create the target directory
        fs::create_dir_all(&version_path).map_err(|e| e.to_string())?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let outpath = match file.enclosed_name() {
                Some(path) => path.to_owned(),
                None => continue,
            };

            // Strip the top-level directory component if present, so we get a clean structure inside `version` folder?
            // Actually, keeping the folder structure is fine, usually it's `jdk-17/.../bin/java.exe`.
            // But user might prefer `runtimes/java/17/bin/java.exe`.
            // Let's try to strip the first component.

            let mut components = outpath.components();
            components.next(); // Skip root folder in zip
            let relative_path = components.as_path();

            if relative_path.as_os_str().is_empty() {
                continue; // It was just the root folder
            }

            let full_outpath = version_path.join(relative_path);

            if (*file.name()).ends_with('/') {
                fs::create_dir_all(&full_outpath).map_err(|e| e.to_string())?;
            } else {
                if let Some(p) = full_outpath.parent() {
                    if !p.exists() {
                        fs::create_dir_all(p).map_err(|e| e.to_string())?;
                    }
                }
                let mut outfile = fs::File::create(&full_outpath).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            }
        }
        installed_versions.push(version.to_string());
    }

    Ok(format!(
        "Installed Java versions: {}",
        installed_versions.join(", ")
    ))
}

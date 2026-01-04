use crate::utils::paths;
use anyhow::{anyhow, Result};
use reqwest::Client;
use std::path::PathBuf;
use tokio::fs;
use tokio::io::AsyncWriteExt;

/// Service to download and manage Java/JDK installations
pub struct JavaInstaller {
    client: Client,
}

impl JavaInstaller {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    /// Get the path to an installed Java version, or download it if not present
    pub async fn ensure_java(&self, major_version: i32) -> Result<String> {
        // Check if already installed in our managed directory
        let java_dir = paths::get_java_dir(major_version);
        let java_exe = Self::get_java_executable(&java_dir);

        if java_exe.exists() {
            log::info!("Java {} already installed at {:?}", major_version, java_exe);
            return Ok(java_exe.to_string_lossy().to_string());
        }

        // Also check system-wide installation
        if let Some(system_java) = self.find_system_java(major_version) {
            log::info!("Found system Java {} at {}", major_version, system_java);
            return Ok(system_java);
        }

        // Need to download
        log::info!("Java {} not found, downloading...", major_version);
        self.download_java(major_version).await?;

        if java_exe.exists() {
            Ok(java_exe.to_string_lossy().to_string())
        } else {
            Err(anyhow!(
                "Java installation failed - executable not found after download"
            ))
        }
    }

    /// Download Java from Adoptium (Eclipse Temurin)
    async fn download_java(&self, major_version: i32) -> Result<()> {
        let java_dir = paths::get_java_dir(major_version);
        fs::create_dir_all(&java_dir).await?;

        // Determine platform
        let (os, arch, ext) = Self::get_platform_info();

        // Adoptium API URL
        let url = format!(
            "https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}/jdk/hotspot/normal/eclipse",
            major_version, os, arch
        );

        log::info!("Downloading Java {} from Adoptium: {}", major_version, url);

        let response = self.client.get(&url).send().await?.error_for_status()?;

        let total_size = response.content_length().unwrap_or(0);
        log::info!("Download size: {} MB", total_size / 1024 / 1024);

        // Download to temp file
        let temp_file = java_dir.join(format!("java-{}.{}", major_version, ext));
        let bytes = response.bytes().await?;

        let mut file = fs::File::create(&temp_file).await?;
        file.write_all(&bytes).await?;
        file.flush().await?;
        drop(file);

        log::info!("Downloaded to {:?}, extracting...", temp_file);

        // Extract
        self.extract_java(&temp_file, &java_dir, ext).await?;

        // Clean up temp file
        let _ = fs::remove_file(&temp_file).await;

        log::info!("Java {} installed successfully", major_version);
        Ok(())
    }

    /// Extract the downloaded archive
    async fn extract_java(&self, archive: &PathBuf, dest: &PathBuf, ext: &str) -> Result<()> {
        let archive = archive.clone();
        let dest = dest.clone();
        let ext = ext.to_string();

        tokio::task::spawn_blocking(move || {
            if ext == "zip" {
                // Windows ZIP extraction
                let file = std::fs::File::open(&archive)?;
                let mut zip = zip::ZipArchive::new(file)?;

                // Find the root folder name in the archive (e.g., "jdk-21.0.1+12")
                let root_folder = zip
                    .file_names()
                    .next()
                    .and_then(|n| n.split('/').next())
                    .map(|s| s.to_string());

                zip.extract(&dest)?;

                // Move contents from nested folder to dest
                if let Some(root) = root_folder {
                    Self::flatten_nested_dir(&dest, &root)?;
                }
            } else {
                // tar.gz for Linux/Mac
                use flate2::read::GzDecoder;
                use tar::Archive;
                
                let file = std::fs::File::open(&archive)?;
                let gz = GzDecoder::new(file);
                let mut tar = Archive::new(gz);
                tar.unpack(&dest)?;
                
                // Find and flatten nested JDK directory
                if let Ok(entries) = std::fs::read_dir(&dest) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if entry.path().is_dir() && name.starts_with("jdk") {
                            Self::flatten_nested_dir(&dest, &name)?;
                            break;
                        }
                    }
                }
            }
            Ok::<(), anyhow::Error>(())
        })
        .await??;

        Ok(())
    }
    
    /// Move contents from a nested directory up one level
    fn flatten_nested_dir(dest: &PathBuf, nested_name: &str) -> Result<()> {
        let nested = dest.join(nested_name);
        if nested.exists() && nested.is_dir() {
            for entry in std::fs::read_dir(&nested)? {
                let entry = entry?;
                let target = dest.join(entry.file_name());
                if !target.exists() {
                    std::fs::rename(entry.path(), target)?;
                }
            }
            let _ = std::fs::remove_dir_all(&nested);
        }
        Ok(())
    }

    /// Get the java executable path for a given java directory
    fn get_java_executable(java_dir: &PathBuf) -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            java_dir.join("bin").join("java.exe")
        }
        #[cfg(not(target_os = "windows"))]
        {
            java_dir.join("bin").join("java")
        }
    }

    /// Get platform info for Adoptium API
    fn get_platform_info() -> (&'static str, &'static str, &'static str) {
        #[cfg(target_os = "windows")]
        {
            #[cfg(target_arch = "x86_64")]
            {
                ("windows", "x64", "zip")
            }
            #[cfg(target_arch = "aarch64")]
            {
                ("windows", "aarch64", "zip")
            }
            #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
            {
                ("windows", "x64", "zip")
            }
        }
        #[cfg(target_os = "macos")]
        {
            #[cfg(target_arch = "x86_64")]
            {
                ("mac", "x64", "tar.gz")
            }
            #[cfg(target_arch = "aarch64")]
            {
                ("mac", "aarch64", "tar.gz")
            }
            #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
            {
                ("mac", "x64", "tar.gz")
            }
        }
        #[cfg(target_os = "linux")]
        {
            #[cfg(target_arch = "x86_64")]
            {
                ("linux", "x64", "tar.gz")
            }
            #[cfg(target_arch = "aarch64")]
            {
                ("linux", "aarch64", "tar.gz")
            }
            #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
            {
                ("linux", "x64", "tar.gz")
            }
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            ("linux", "x64", "tar.gz")
        }
    }

    /// Try to find a system-installed Java of the required version
    fn find_system_java(&self, required_major: i32) -> Option<String> {
        #[cfg(target_os = "windows")]
        {
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
                            if let Some(major) = Self::get_java_version(&java_exe) {
                                if major == required_major {
                                    return Some(java_exe.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                }
            }

            // Check JAVA_HOME
            if let Ok(java_home) = std::env::var("JAVA_HOME") {
                let java_exe = std::path::Path::new(&java_home)
                    .join("bin")
                    .join("java.exe");
                if java_exe.exists() {
                    if let Some(major) = Self::get_java_version(&java_exe) {
                        if major == required_major {
                            return Some(java_exe.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            // Check common locations on Unix
            let search_paths = ["/usr/lib/jvm", "/usr/local/java", "/opt/java"];

            for base in search_paths {
                if let Ok(entries) = std::fs::read_dir(base) {
                    for entry in entries.flatten() {
                        let java_exe = entry.path().join("bin").join("java");
                        if java_exe.exists() {
                            if let Some(major) = Self::get_java_version(&java_exe) {
                                if major == required_major {
                                    return Some(java_exe.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                }
            }

            // Check JAVA_HOME
            if let Ok(java_home) = std::env::var("JAVA_HOME") {
                let java_exe = std::path::Path::new(&java_home).join("bin").join("java");
                if java_exe.exists() {
                    if let Some(major) = Self::get_java_version(&java_exe) {
                        if major == required_major {
                            return Some(java_exe.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }

        None
    }

    /// Get the major version of a Java executable
    fn get_java_version(java_path: &std::path::Path) -> Option<i32> {
        let out = std::process::Command::new(java_path)
            .arg("-version")
            .output()
            .ok()?;

        let text = String::from_utf8_lossy(&out.stderr).to_string()
            + &String::from_utf8_lossy(&out.stdout);

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
}

use crate::utils::paths::get_launcher_dir;
use reqwest::multipart;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct SkinFile {
    pub filename: String,
    pub path: String,
}

#[tauri::command]
pub async fn upload_skin(token: String, path: String, variant: String) -> Result<(), String> {
    // 1. Read file content
    let file_content = fs::read(&path).map_err(|e| format!("Failed to read skin file: {}", e))?;

    // 2. Create multipart form
    let part = multipart::Part::bytes(file_content)
        .file_name("skin.png")
        .mime_str("image/png")
        .map_err(|e| e.to_string())?;

    let form = multipart::Form::new()
        .part("file", part)
        .text("variant", variant); // "classic" or "slim"

    // 3. Upload to Mojang
    let client = reqwest::Client::new();
    let res = client
        .post("https://api.minecraftservices.com/minecraft/profile/skins")
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Mojang API Error: {}", text));
    }

    Ok(())
}

#[tauri::command]
pub fn get_skin_library() -> Result<Vec<SkinFile>, String> {
    let skins_dir = get_launcher_dir().join("skins");

    if !skins_dir.exists() {
        fs::create_dir_all(&skins_dir).map_err(|e| e.to_string())?;
        return Ok(vec![]);
    }

    let mut skins = Vec::new();

    if let Ok(entries) = fs::read_dir(skins_dir) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_file() {
                    if let Some(ext) = path.extension() {
                        if ext == "png" {
                            if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                                skins.push(SkinFile {
                                    filename: filename.to_string(),
                                    path: path.to_string_lossy().to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(skins)
}

#[tauri::command]
pub fn save_skin_to_library(path: String) -> Result<SkinFile, String> {
    let skins_dir = get_launcher_dir().join("skins");
    if !skins_dir.exists() {
        fs::create_dir_all(&skins_dir).map_err(|e| e.to_string())?;
    }

    let src_path = PathBuf::from(&path);
    let filename = src_path
        .file_name()
        .ok_or("Invalid filename")?
        .to_str()
        .ok_or("Invalid filename string")?;

    // Ensure unique name
    let mut dest_path = skins_dir.join(filename);
    let mut counter = 1;
    let stem = src_path.file_stem().unwrap().to_str().unwrap();

    while dest_path.exists() {
        dest_path = skins_dir.join(format!("{}_{}.png", stem, counter));
        counter += 1;
    }

    fs::copy(&src_path, &dest_path).map_err(|e| format!("Failed to copy skin: {}", e))?;

    Ok(SkinFile {
        filename: dest_path.file_name().unwrap().to_str().unwrap().to_string(),
        path: dest_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn delete_skin_from_library(filename: String) -> Result<(), String> {
    let skins_dir = get_launcher_dir().join("skins");
    let path = skins_dir.join(filename);

    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }

    Ok(())
}
